'use strict';
// PlayerData schema - stores persistent player data across sessions

const mongoose = require('mongoose');

const companionSchema = new mongoose.Schema({
    type: { type: String, required: true },
    level: { type: Number, default: 1 },
    lastAttackTime: { type: Number, default: 0 }
}, { _id: false });

const skillTreeSchema = new mongoose.Schema({
    maxHealth: { type: Number, default: 0 },
    attackPower: { type: Number, default: 0 },
    companionDamage: { type: Number, default: 0 },
    goldMultiplier: { type: Number, default: 0 },
    clickDamage: { type: Number, default: 0 },
    healthRegen: { type: Number, default: 0 }
}, { _id: false });

const statisticsSchema = new mongoose.Schema({
    totalKills: { type: Number, default: 0 },
    totalDeaths: { type: Number, default: 0 },
    monstersDefeated: { type: Number, default: 0 },
    pvpKills: { type: Number, default: 0 },
    pvpDeaths: { type: Number, default: 0 },
    totalGoldEarned: { type: Number, default: 0 },
    totalDamageDealt: { type: Number, default: 0 },
    totalDamageTaken: { type: Number, default: 0 },
    highestTier: { type: Number, default: 0 },
    playTimeSeconds: { type: Number, default: 0 }
}, { _id: false });

const playerDataSchema = new mongoose.Schema({
    // Authentication identifiers
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    authProvider: {
        type: String,
        required: true,
        enum: ['discord', 'raid'],
        index: true
    },
    username: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    
    // Core progression
    tier: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Monster progression
    monstersDefeated: {
        type: Number,
        default: 0,
        min: 0
    },
    currentMonsterLevel: {
        type: Number,
        default: 1,
        min: 1
    },
    
    // Resources
    gold: {
        type: Number,
        default: 0,
        min: 0
    },
    skillPoints: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Combat stats
    health: {
        type: Number,
        default: 100,
        min: 0
    },
    maxHealth: {
        type: Number,
        default: 100,
        min: 1
    },
    attackPower: {
        type: Number,
        default: 1,
        min: 1
    },
    
    // Skills
    skillTree: {
        type: skillTreeSchema,
        default: () => ({})
    },
    
    // Companions
    companions: {
        type: [companionSchema],
        default: []
    },
    
    // Equipment (for future implementation)
    equipment: {
        weapon: { type: String, default: null },
        armor: { type: String, default: null },
        accessory: { type: String, default: null }
    },
    
    // Statistics
    statistics: {
        type: statisticsSchema,
        default: () => ({})
    },
    
    // Session tracking
    lastLogin: {
        type: Date,
        default: Date.now
    },
    lastSave: {
        type: Date,
        default: Date.now
    },
    sessionCount: {
        type: Number,
        default: 0
    }
}, {
    // timestamps: true adds createdAt and updatedAt automatically.
    timestamps: true,
    collection: 'playerdata'
});

// Indexes for performance
playerDataSchema.index({ userId: 1, authProvider: 1 }, { unique: true });
playerDataSchema.index({ username: 1 });
playerDataSchema.index({ lastLogin: -1 });

// Pre-save middleware to update lastSave timestamp.
// (updatedAt is managed automatically by timestamps:true — no need to set it here.)
playerDataSchema.pre('save', function(next) {
    this.lastSave = new Date();
    next();
});

// Instance methods

/**
 * Convert player data to a format suitable for the game Player entity
 * @returns {Object} Player state object
 */
playerDataSchema.methods.toPlayerState = function() {
    return {
        gold: this.gold,
        skillPoints: this.skillPoints,
        health: this.health,
        maxHealth: this.maxHealth,
        attackPower: this.attackPower,
        skillTree: this.skillTree.toObject(),
        companions: this.companions.map(c => c.toObject()),
        pvpKills: this.statistics.pvpKills,
        pvpDeaths: this.statistics.pvpDeaths,
        monstersDefeated: this.monstersDefeated,
        currentMonsterLevel: this.currentMonsterLevel
    };
};

/**
 * Update player data from game Player entity
 * @param {Object} playerEntity - The game Player entity
 */
playerDataSchema.methods.updateFromPlayer = function(playerEntity) {
    this.gold = playerEntity.gold;
    this.skillPoints = playerEntity.skillPoints;
    this.health = playerEntity.health;
    this.maxHealth = playerEntity.maxHealth;
    this.attackPower = playerEntity.attackPower;
    
    // Update skill tree
    if (playerEntity.skillTree) {
        this.skillTree = playerEntity.skillTree;
    }
    
    // Update companions
    if (playerEntity.companions) {
        this.companions = playerEntity.companions;
    }
    
    // Update PvP stats
    if (playerEntity.pvpKills !== undefined) {
        this.statistics.pvpKills = playerEntity.pvpKills;
    }
    if (playerEntity.pvpDeaths !== undefined) {
        this.statistics.pvpDeaths = playerEntity.pvpDeaths;
    }
    
    // Update monster progression
    if (playerEntity.monstersDefeated !== undefined) {
        this.monstersDefeated = playerEntity.monstersDefeated;
    }
    if (playerEntity.currentMonsterLevel !== undefined) {
        this.currentMonsterLevel = playerEntity.currentMonsterLevel;
    }
};

/**
 * Increment session count and update last login
 */
playerDataSchema.methods.recordLogin = function() {
    this.lastLogin = new Date();
    this.sessionCount += 1;
};

// Static methods

/**
 * Find or create player data by userId and authProvider
 * @param {String} userId - User ID from auth provider
 * @param {String} authProvider - 'discord' or 'raid'
 * @param {String} username - Username
 * @returns {Promise<PlayerData>}
 */
playerDataSchema.statics.findOrCreate = async function(userId, authProvider, username) {
    let playerData = await this.findOne({ userId, authProvider });
    
    if (!playerData) {
        playerData = new this({
            userId,
            authProvider,
            username
        });
        await playerData.save();
        console.log(`Created new player data for ${username} (${authProvider}:${userId})`);
    } else {
        // Update username if changed
        if (playerData.username !== username) {
            playerData.username = username;
        }
        playerData.recordLogin();
        await playerData.save();
        console.log(`Loaded existing player data for ${username} (${authProvider}:${userId})`);
    }
    
    return playerData;
};

/**
 * Get leaderboard data
 * @param {String} sortBy - Field to sort by ('level', 'gold', 'pvpKills')
 * @param {Number} limit - Number of results
 * @returns {Promise<Array>}
 */
playerDataSchema.statics.getLeaderboard = async function(sortBy = 'gold', limit = 10) {
    const sortField = sortBy === 'pvpKills' ? 'statistics.pvpKills' : sortBy;
    const sortOrder = -1; // Descending
    
    return this.find()
        .sort({ [sortField]: sortOrder })
        .limit(limit)
        .select('username gold statistics.pvpKills statistics.pvpDeaths')
        .lean();
};

const PlayerData = mongoose.model('PlayerData', playerDataSchema);

module.exports = PlayerData;

// Made with Bob
