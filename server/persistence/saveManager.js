'use strict';
// Save/Load manager for player persistence

const PlayerData = require('../database/models/PlayerData');
const { isDbConnected } = require('../database/connection');

// Track active save operations to prevent race conditions.
// Values are Promises (not booleans) so loadPlayerData can await them before reading,
// preventing the refresh race where a disconnect-save and reconnect-load overlap.
const activeSaves = new Map();

// Track last save times to implement throttling
const lastSaveTimes = new Map();
const SAVE_THROTTLE_MS = 5000; // Minimum 5 seconds between saves per player

/**
 * Load player data from database and apply to player entity
 * @param {Object} player - Player entity
 * @param {String} userId - User ID from auth provider
 * @param {String} authProvider - 'discord' or 'raid'
 * @returns {Promise<Boolean>} True if loaded successfully
 */
async function loadPlayerData(player, userId, authProvider) {
    if (!isDbConnected()) {
        console.log('SaveManager: Database not connected, skipping load');
        return false;
    }

    // If a save is in progress for this player (e.g. a disconnect-save racing with a
    // refresh reconnect), wait for it to finish before reading so we get fresh data.
    const saveKey = `${authProvider}:${userId}`;
    const pendingSave = activeSaves.get(saveKey);
    if (pendingSave) {
        console.log(`SaveManager: Waiting for in-progress save before loading ${saveKey}`);
        await pendingSave;
    }

    try {
        const playerData = await PlayerData.findOne({ userId, authProvider });
        
        if (!playerData) {
            console.log(`SaveManager: No saved data found for ${userId} (${authProvider})`);
            return false;
        }

        // Apply saved data to player entity
        const savedState = playerData.toPlayerState();
        
        player.tier = savedState.tier;
        player.gold = savedState.gold;
        player.skillPoints = savedState.skillPoints;
        player.health = savedState.health;
        player.maxHealth = savedState.maxHealth;
        player.attackPower = savedState.attackPower;
        player.skillTree = savedState.skillTree;
        player.companions = savedState.companions;
        player.pvpKills = savedState.pvpKills;
        player.pvpDeaths = savedState.pvpDeaths;
        player.monstersDefeated = savedState.monstersDefeated;
        player.currentMonsterLevel = savedState.currentMonsterLevel;

        console.log(`SaveManager: Loaded data for ${playerData.username} - Monster Level ${player.currentMonsterLevel}, Monsters Defeated ${player.monstersDefeated}, Gold ${player.gold}`);
        return true;
    } catch (error) {
        console.error('SaveManager: Error loading player data:', error);
        return false;
    }
}

/**
 * Save player data to database
 * @param {Object} player - Player entity
 * @param {String} userId - User ID from auth provider
 * @param {String} authProvider - 'discord' or 'raid'
 * @param {Boolean} force - Force save even if throttled
 * @returns {Promise<Boolean>} True if saved successfully
 */
async function savePlayerData(player, userId, authProvider, force = false) {
    if (!isDbConnected()) {
        console.log('SaveManager: Database not connected, skipping save');
        return false;
    }

    const saveKey = `${authProvider}:${userId}`;

    // Check if save is already in progress
    if (activeSaves.has(saveKey)) {
        console.log(`SaveManager: Save already in progress for ${saveKey}`);
        return false;
    }

    // Check throttling (unless forced)
    if (!force) {
        const lastSave = lastSaveTimes.get(saveKey);
        if (lastSave && (Date.now() - lastSave) < SAVE_THROTTLE_MS) {
            console.log(`SaveManager: Save throttled for ${saveKey}`);
            return false;
        }
    }

    // Store the save Promise so loadPlayerData can await it if a load races in.
    const savePromise = (async () => {
        try {
            // Find or create — first save for a new player must not be silently dropped.
            let playerData = await PlayerData.findOne({ userId, authProvider });
            if (!playerData) {
                // Create a minimal document; username defaults to userId until the auth
                // layer updates it via findOrCreate on the next login.
                playerData = new PlayerData({ userId, authProvider, username: userId });
            }

            // Update player data from entity
            playerData.updateFromPlayer(player);
            
            // Validate data before saving
            if (!validatePlayerData(playerData)) {
                console.error('SaveManager: Invalid player data, save aborted');
                return false;
            }

            await playerData.save();
            
            lastSaveTimes.set(saveKey, Date.now());
            console.log(`SaveManager: Saved data for ${playerData.username} - Tier ${player.tier}, Gold ${player.gold}`);
            return true;
        } catch (error) {
            console.error('SaveManager: Error saving player data:', error);
            return false;
        } finally {
            activeSaves.delete(saveKey);
        }
    })();

    activeSaves.set(saveKey, savePromise);
    return savePromise;
}

/**
 * Validate player data before saving
 * @param {Object} playerData - PlayerData document
 * @returns {Boolean} True if valid
 */
function validatePlayerData(playerData) {
    // Basic validation
    if (playerData.tier < 0 || playerData.tier > 100) {
        console.error('SaveManager: Invalid tier:', playerData.tier);
        return false;
    }
    
    if (playerData.gold < 0) {
        console.error('SaveManager: Invalid gold:', playerData.gold);
        return false;
    }
    
    if (playerData.health < 0 || playerData.health > playerData.maxHealth) {
        console.error('SaveManager: Invalid health:', playerData.health, '/', playerData.maxHealth);
        return false;
    }
    
    return true;
}

/**
 * Auto-save manager for periodic saves
 */
class AutoSaveManager {
    constructor() {
        this.interval = null;
        this.playerRegistry = new Map(); // clientId -> {player, userId, authProvider}
        this.saveInterval = parseInt(process.env.AUTO_SAVE_INTERVAL) || 30000; // Default 30 seconds
    }

    /**
     * Start auto-save interval
     */
    start() {
        if (this.interval) {
            console.log('AutoSaveManager: Already running');
            return;
        }

        console.log(`AutoSaveManager: Starting with ${this.saveInterval}ms interval`);
        this.interval = setInterval(() => this.saveAll(), this.saveInterval);
    }

    /**
     * Stop auto-save interval
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            console.log('AutoSaveManager: Stopped');
        }
    }

    /**
     * Register a player for auto-save
     * @param {String} clientId - Client ID
     * @param {Object} player - Player entity
     * @param {String} userId - User ID from auth provider
     * @param {String} authProvider - 'discord' or 'raid'
     */
    register(clientId, player, userId, authProvider) {
        this.playerRegistry.set(clientId, { player, userId, authProvider });
        console.log(`AutoSaveManager: Registered ${clientId} (${authProvider}:${userId})`);
    }

    /**
     * Unregister a player from auto-save
     * @param {String} clientId - Client ID
     * @param {Boolean} saveOnExit - Save before unregistering
     */
    async unregister(clientId, saveOnExit = true) {
        const entry = this.playerRegistry.get(clientId);
        
        if (entry && saveOnExit) {
            console.log(`AutoSaveManager: Saving on disconnect for ${clientId}`);
            await savePlayerData(entry.player, entry.userId, entry.authProvider, true);
        }
        
        this.playerRegistry.delete(clientId);
        console.log(`AutoSaveManager: Unregistered ${clientId}`);
    }

    /**
     * Save all registered players
     */
    async saveAll() {
        if (this.playerRegistry.size === 0) {
            return;
        }

        console.log(`AutoSaveManager: Saving ${this.playerRegistry.size} players...`);
        
        const savePromises = [];
        for (const [clientId, entry] of this.playerRegistry.entries()) {
            savePromises.push(
                savePlayerData(entry.player, entry.userId, entry.authProvider, false)
                    .catch(error => {
                        console.error(`AutoSaveManager: Error saving ${clientId}:`, error);
                    })
            );
        }

        await Promise.all(savePromises);
        console.log('AutoSaveManager: Save cycle complete');
    }

    /**
     * Get number of registered players
     * @returns {Number}
     */
    getPlayerCount() {
        return this.playerRegistry.size;
    }
}

// Create singleton instance
const autoSaveManager = new AutoSaveManager();

module.exports = {
    loadPlayerData,
    savePlayerData,
    validatePlayerData,
    autoSaveManager
};

// Made with Bob
