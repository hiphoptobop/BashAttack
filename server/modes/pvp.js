'use strict';
// PvP Mode — Player vs Player arena mode with click-to-attack combat.
// Records weekly K/D stats to MongoDB via PvpWeeklyStats on each kill.
//
// This mode provides PvP combat mechanics including:
// - Click-to-attack combat system
// - Player collision/attack range detection (100 pixels)
// - Damage calculation using attackPower + skill bonuses
// - Death/respawn mechanics (30 second respawn timer)
// - PvP stats tracking (kills, deaths)
// - Attack cooldown (1 second)
//
// Hooks:
//   onStart(game)            — entered the playing state (first player joined).
//   onStop(game)             — fell back to waiting (last player left).
//   onPlayerJoin(game, p)    — a player entity was created/registered.
//   onPlayerLeave(game, id)  — a player is leaving (still present this call).
//   onTick(game, dt)         — once per server tick while playing (after the sim).
//   checkWin(game)           — return a winner (or null).

var utils = require('../utils.js');
var messenger = require('../messenger.js');
var c = utils.loadConfig();
var { PvPBot } = require('../entities/pvpbot.js');
var PvpWeeklyStats = require('../database/models/PvpWeeklyStats');
var { isDbConnected } = require('../database/connection');

// Record a kill and a death into the weekly leaderboard.
// Skips bots and skips silently when DB is unavailable.
function recordWeeklyStats(game, killerId, victimId) {
    // Look up player identity from their socket session
    function getIdentity(playerId) {
        var client = messenger.getClient(playerId);
        if (!client || !client.request || !client.request.session) { return null; }
        var passport = client.request.session.passport;
        return (passport && passport.user) ? passport.user : null;
    }

    if (!isDbConnected()) { return; }

    var killerPlayer = game.playerList[killerId];
    var victimPlayer = game.playerList[victimId];
    var tier = game.pvpTier || 1;

    // Record kill for killer (human only)
    if (killerPlayer && !killerPlayer.isBot) {
        var ki = getIdentity(killerId);
        if (ki) {
            PvpWeeklyStats.record({
                userId: ki.userId, authProvider: ki.authProvider,
                username: ki.username, tier: tier, kills: 1, deaths: 0
            }).catch(function(e) { console.error('PvpWeeklyStats kill error:', e); });
        }
    }

    // Record death for victim (human only)
    if (victimPlayer && !victimPlayer.isBot) {
        var vi = getIdentity(victimId);
        if (vi) {
            PvpWeeklyStats.record({
                userId: vi.userId, authProvider: vi.authProvider,
                username: vi.username, tier: tier, kills: 0, deaths: 1
            }).catch(function(e) { console.error('PvpWeeklyStats death error:', e); });
        }
    }
}

// PvP Constants
const ATTACK_RANGE  = 100;   // pixels
const RESPAWN_TIME  = 30000; // 30 seconds in milliseconds
const BOT_RESPAWN   = 8000;  // 8 seconds for the bot to respawn

// Helper function to calculate distance between two entities
function getDistance(entity1, entity2) {
    const dx = entity1.x - entity2.x;
    const dy = entity1.y - entity2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

module.exports = function createPvPMode() {
    return {
        name: 'pvp',

        onStart: function (game) {
            console.log('PvP mode started in room ' + game.roomSig);
            // Spawn one AI bot calibrated to this room's tier.
            var tier = game.pvpTier || 1;
            var loc  = game.world.getSafeLoc ? game.world.getSafeLoc(c.playerBaseRadius)
                                             : { x: 200 + Math.random() * 900, y: 200 + Math.random() * 400 };
            var bot  = new PvPBot(loc.x, loc.y, tier, 'bot_' + game.roomSig);
            bot.roomSig  = game.roomSig;
            bot.roomType = 'pvp';
            bot._game    = game;
            game.spawnEntity(bot);
            game.playerList[bot.id] = bot;
            console.log('Spawned tier-' + tier + ' bot in room ' + game.roomSig);
        },

        onPlayerJoin: function (game, player) {
            // Stats are already reset to PvP defaults by hostess.switchPlayerRoom
            // before this hook is called. Nothing to do except log.
            console.log('Player ' + player.id + ' entered PvP arena (health: ' +
                player.health + '/' + player.maxHealth + ', attackPower: ' + player.attackPower +
                ', tier: ' + (game.pvpTier || 1) + ')');
        },

        onPlayerLeave: function (game, id) {
            console.log('Player ' + id + ' left PvP arena');
            var player = game.playerList[id];
            if (player && !player.isBot) {
                player.isDead         = false;
                player.respawnTime    = null;
                player.lastAttackTime = 0;
                player.currentMonsterId = null;
                player.isInCombat     = false;
            }
        },

        onStop: function (game) {
            console.log('PvP mode stopped in room ' + game.roomSig);
            // Remove the bot from playerList so it doesn't linger.
            for (var id in game.playerList) {
                if (game.playerList[id].isBot) {
                    delete game.playerList[id];
                }
            }
        },

        onTick: function (game, dt) {
            if (game.roomType !== 'pvp') { return; }
            const currentTime = Date.now();

            for (const playerId in game.playerList) {
                const player = game.playerList[playerId];
                if (player.roomSig && player.roomSig !== game.roomSig) { continue; }

                // Drive bot AI every tick.
                if (player.isBot) {
                    player.tickAI(game, dt);
                }

                // Handle respawns for all players (human + bot).
                if (player.respawnTime && currentTime >= player.respawnTime) {
                    var spawnPoint = game.world.getSafeLoc
                        ? game.world.getSafeLoc(player.radius)
                        : { x: 80 + Math.random() * (game.world.width - 160),
                            y: 80 + Math.random() * (game.world.height - 160) };
                    player.respawn(spawnPoint.x, spawnPoint.y);
                    // Sync bot's entity position so the engine sees the update.
                    if (player.isBot) {
                        var botEntity = game.entities[player.id];
                        if (botEntity) {
                            botEntity.x    = player.x;    botEntity.newX = player.x;
                            botEntity.y    = player.y;    botEntity.newY = player.y;
                            botEntity.velX = 0;           botEntity.velY = 0;
                        }
                    }
                    messenger.messageRoomBySig(game.roomSig, 'pvpRespawn', {
                        playerId: player.id,
                        x: player.x,
                        y: player.y,
                        health: player.health
                    });
                }
            }
        },
        
        // Handle player click in PvP arena
        // In PvP mode, clicks are used for attacking other players
        // This method is called by messenger.js when a player clicks
        handlePlayerClick: function (game, player) {
            // Validate player exists
            if (!player) {
                return { success: false, error: 'Invalid player' };
            }
            
            // Check if player is dead
            if (player.isDead) {
                return { success: false, error: 'Player is dead' };
            }
            
            // In PvP mode, clicks don't do anything by default
            // Players attack by clicking on other players, which is handled
            // through a different mechanism (handleAttack)
            // This method exists to prevent the error, but doesn't perform any action
            
            // For future enhancement: could implement click-to-move or
            // auto-target nearest enemy on click
            
            return {
                success: true,
                message: 'Click registered (use attack commands to fight other players)'
            };
        },
        
        // Handle PvP attack from a player
        handleAttack: function (game, attackerId, targetId) {
            const attacker = game.playerList[attackerId];
            const target = game.playerList[targetId];
            
            // Validation
            if (!attacker || !target) {
                return { success: false, error: 'Invalid attacker or target' };
            }
            
            if (attacker.isDead) {
                return { success: false, error: 'Attacker is dead' };
            }
            
            if (target.isDead) {
                return { success: false, error: 'Target is dead' };
            }
            
            if (attackerId === targetId) {
                return { success: false, error: 'Cannot attack yourself' };
            }
            
            // Check attack cooldown
            const currentTime = Date.now();
            if (!attacker.canAttack(currentTime)) {
                return { success: false, error: 'Attack on cooldown' };
            }
            
            // Check range
            const distance = getDistance(attacker, target);
            if (distance > ATTACK_RANGE) {
                return { success: false, error: 'Target out of range' };
            }
            
            // Perform attack
            const attackResult = attacker.attackPlayer(target, currentTime);
            
            if (!attackResult) {
                return { success: false, error: 'Attack failed' };
            }
            
            // Handle death
            if (attackResult.targetDied) {
                attacker.pvpKills++;
                target.pvpDeaths++;
                // Bots respawn much faster than human players.
                target.respawnTime = currentTime + (target.isBot ? BOT_RESPAWN : RESPAWN_TIME);

                // Persist weekly K/D stats (human players only, non-blocking)
                recordWeeklyStats(game, attackerId, targetId);

                // Broadcast death event
                messenger.messageRoomBySig(game.roomSig, 'pvpDeath', {
                    victimId: target.id,
                    killerId: attacker.id,
                    killerKills: attacker.pvpKills,
                    victimDeaths: target.pvpDeaths,
                    respawnTime: target.respawnTime
                });
            }
            
            // Broadcast combat event
            messenger.messageRoomBySig(game.roomSig, 'pvpCombat', {
                attackerId: attacker.id,
                targetId: target.id,
                damage: attackResult.damage,
                targetHealth: target.health,
                targetMaxHealth: target.maxHealth,
                targetDied: attackResult.targetDied
            });
            
            return {
                success: true,
                damage: attackResult.damage,
                targetDied: attackResult.targetDied
            };
        },

        checkWin: function (game) {
            // Future: implement win conditions
            // Examples:
            // - Last player standing
            // - First to X kills
            // - Highest score after time limit
            // - Team-based victory conditions
            
            return null; // No win condition yet - continuous PvP arena
        }
    };
};

// Made with Bob
