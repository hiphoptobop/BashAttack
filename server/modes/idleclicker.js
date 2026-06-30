'use strict';
// Idle Clicker — a game mode where each player fights their own monster in
// isolated combat. Players click to damage monsters, companions provide auto-attack
// damage, and monsters counter-attack periodically. Death handling awards gold and
// spawns new monsters. Progression through levels, tiers, skill tree, and companion
// purchases.
//
// This mode implements:
//   - Per-player monster spawning and combat
//   - Click-based damage dealing
//   - Companion auto-attacks with different types
//   - Monster counter-attacks
//   - Health regeneration
//   - Death handling with gold rewards
//   - Companion purchasing system
//   - Skill tree upgrades

var { Monster } = require('../entities/monster.js');
var COMPANION_DEFINITIONS = require('../data/companions.js');
var messenger = require('../messenger.js');

module.exports = function createIdleClickerMode() {
    return {
        name: 'idleclicker',

        onStart: function(game) {
            // Called when first player joins
            // No special initialization needed (monsters spawn per-player)
        },

        onStop: function(game) {
            // Called when last player leaves
            // Clean up any remaining monsters
            var entityIds = Object.keys(game.entities);
            for (var i = 0; i < entityIds.length; i++) {
                var entity = game.entities[entityIds[i]];
                if (entity.type === 'monster') {
                    game.despawnEntity(entity.id);
                }
            }
        },

        onPlayerJoin: function(game, player) {
            player.isDead = false;
            player.isInCombat = false;
            player.currentMonsterId = null;

            // If a pending stat transfer is waiting for this player, defer the monster
            // spawn until messenger applies the transfer (so currentMonsterLevel is correct).
            if (game._pendingTransferForClient === player.id) {
                console.log('Player ' + player.id + ' joined IdleClicker — deferring monster spawn until transfer applied');
                return;
            }

            console.log('Player ' + player.id + ' joined IdleClicker at monster level ' + player.currentMonsterLevel);
            this.spawnMonsterForPlayer(game, player);
        },

        onPlayerLeave: function(game, playerId) {
            // Get the player from game.playerList
            var player = game.playerList[playerId];
            if (!player) return;
            
            // CRITICAL: Clean up player's monster when leaving idle clicker mode
            // If player has a currentMonsterId, despawn it
            if (player.currentMonsterId) {
                console.log('Despawning monster ' + player.currentMonsterId + ' for leaving player ' + playerId);
                // Check if monster exists in THIS game's entities before despawning
                if (game.entities[player.currentMonsterId]) {
                    game.despawnEntity(player.currentMonsterId);
                } else {
                    console.log('Monster ' + player.currentMonsterId + ' not found in game entities (already cleaned up)');
                }
                // Clear the reference regardless
                player.currentMonsterId = null;
            }
            
            // Clear combat state
            player.isInCombat = false;
            
            console.log('Cleaned up idle clicker state for leaving player ' + playerId);
        },

        onTick: function(game, dt) {
            // CRITICAL: Only process players in THIS game's room (PvE mode)
            // This prevents idle clicker logic from affecting players in PvP rooms
            if (game.roomType !== 'pve') {
                console.warn('IdleClicker onTick called for non-PvE room: ' + game.roomType);
                return;
            }
            
            // Iterate through all players in game.playerList
            var playerIds = Object.keys(game.playerList);
            var currentTime = Date.now();
            
            for (var i = 0; i < playerIds.length; i++) {
                var player = game.playerList[playerIds[i]];
                
                // Double-check player is in the correct room type
                // This is a safety check in case of race conditions during room switching
                if (player.roomSig !== game.roomSig) {
                    console.warn('Player ' + player.id + ' in wrong room during onTick (player room: ' + player.roomSig + ', game room: ' + game.roomSig + ')');
                    continue;
                }
                
                // For each player with a monster
                if (player.currentMonsterId) {
                    var monster = game.entities[player.currentMonsterId];
                    
                    // Skip if monster doesn't exist (edge case)
                    if (!monster) {
                        player.currentMonsterId = null;
                        player.isInCombat = false;
                        continue;
                    }
                    
                    // Verify monster belongs to this player (safety check)
                    if (monster.ownerId !== player.id) {
                        console.warn('Monster ' + monster.id + ' owner mismatch (expected: ' + player.id + ', got: ' + monster.ownerId + ')');
                        player.currentMonsterId = null;
                        player.isInCombat = false;
                        continue;
                    }
                    
                    // Process companion attacks
                    this.processCompanionAttacks(game, player, monster, currentTime);
                    
                    // Process monster attack (only if monster still alive)
                    if (monster.health > 0) {
                        this.processMonsterAttack(game, player, monster, currentTime);
                    }
                    
                    // Process health regeneration
                    this.processHealthRegen(game, player, dt);
                }
            }
        },

        checkWin: function(game) {
            // Return null (endless game mode)
            return null;
        },

        spawnMonsterForPlayer: function(game, player) {
            // Generate unique ID
            var monsterId = 'monster_' + player.id + '_' + Date.now();
            
            // Position monster at same X coordinate as player (horizontally aligned)
            // Y coordinate can be same or slightly different for visual separation
            var monsterX = player.x;
            var monsterY = player.y;
            
            // Create new Monster using player's current monster level
            var monster = new Monster(monsterX, monsterY, player.currentMonsterLevel, player.id, monsterId);
            
            // Spawn using game.spawnEntity
            game.spawnEntity(monster);
            
            // Set player's monster reference
            player.currentMonsterId = monster.id;
            player.isInCombat = true;
            
            console.log('Spawned monster level ' + player.currentMonsterLevel + ' for player ' + player.id);
        },

        handlePlayerClick: function(game, player) {
            // Validate player exists and has a monster
            if (!player || !player.currentMonsterId) {
                return { success: false, error: 'No monster to attack' };
            }
            
            // Get monster from game.entities
            var monster = game.entities[player.currentMonsterId];
            
            // If no monster, return error
            if (!monster) {
                return { success: false, error: 'Monster not found' };
            }
            
            // Calculate click damage (now returns {damage, isCrit})
            var clickResult = player.getEffectiveClickDamage();
            var clickDamage = clickResult.damage;
            var isCrit = clickResult.isCrit;
            
            // Apply damage to monster
            monster.health -= clickDamage;
            
            // If monster health <= 0
            if (monster.health <= 0) {
                // Call handleMonsterDeath (player won)
                this.handleMonsterDeath(game, player, monster, true);
            }
            
            // Return result object with damage dealt and monster remaining health
            return {
                success: true,
                damage: clickDamage,
                isCrit: isCrit,
                monsterHealth: Math.max(0, monster.health),
                monsterMaxHealth: monster.maxHealth
            };
        },

        processCompanionAttacks: function(game, player, monster, currentTime) {
            // Iterate through player.companions array
            for (var i = 0; i < player.companions.length; i++) {
                var companion = player.companions[i];
                
                // Get companion definition from COMPANION_DEFINITIONS
                var companionDef = COMPANION_DEFINITIONS[companion.type];
                if (!companionDef) continue;
                
                // Check if enough time has passed
                if (currentTime - companion.lastAttackTime >= companionDef.attackSpeed) {
                    // Calculate damage — scales with companion level (default 1 for legacy entries)
                    var level = companion.level || 1;
                    var damage = companionDef.baseAttack * level * player.getCompanionDamageMultiplier();
                    
                    // Apply damage to monster
                    monster.health -= damage;
                    
                    // Update lastAttackTime
                    companion.lastAttackTime = currentTime;
                    
                    // Notify the owning client so it can play the attack visual.
                    messenger.messageClientBySig(player.id, 'companionAttack', {
                        companionType: companion.type
                    });

                    // If companion is priest, also heal player
                    if (companion.type === 'priest' && companionDef.healAmount) {
                        player.heal(companionDef.healAmount);
                        messenger.messageClientBySig(player.id, 'priestHeal', {});
                    }
                    
                    // If monster health <= 0
                    if (monster.health <= 0) {
                        // Call handleMonsterDeath (player won)
                        this.handleMonsterDeath(game, player, monster, true);
                        // Break loop (monster is dead)
                        break;
                    }
                }
            }
        },

        processMonsterAttack: function(game, player, monster, currentTime) {
            // Check if enough time has passed
            if (currentTime - monster.lastAttackTime >= monster.attackSpeed) {
                // Apply damage to player
                var playerDied = player.takeDamage(monster.attackPower);
                
                // Update lastAttackTime
                monster.lastAttackTime = currentTime;

                // Notify client so it can show the monster attack animation.
                messenger.messageClientBySig(player.id, 'monsterAttack', {
                    damage: monster.attackPower
                });
                
                // If player died
                if (playerDied) {
                    // Award 5% gold for losing
                    var goldReward = Math.floor(monster.goldReward * 0.05);
                    player.addGold(goldReward);
                    
                    // Reset player health to max
                    player.health = player.maxHealth;
                    
                    // Reset monster health to max (player respawns, monster stays)
                    monster.health = monster.maxHealth;
                    
                    // Emit event to notify client of reset
                    messenger.messageClientBySig(player.id, 'playerDeath', {
                        playerId: player.id,
                        monsterId: player.currentMonsterId,
                        goldEarned: goldReward
                    });
                    
                    console.log('Player ' + player.id + ' died. Respawning with monster at same level.');
                    
                    // Return to prevent further execution after death
                    return;
                }
            }
        },

        processHealthRegen: function(game, player, dt) {
            // Calculate regen amount (1 HP per skill level per second)
            var regenPerSecond = player.skillTree.healthRegen * 1;
            
            // If regenPerSecond > 0
            if (regenPerSecond > 0) {
                // Calculate regen this tick (dt is in milliseconds)
                var regenAmount = (regenPerSecond * dt) / 1000;
                
                // Heal player
                player.heal(regenAmount);
            }
        },

        handleMonsterDeath: function(game, player, monster, playerWon) {
            // Calculate gold reward
            var goldReward;
            if (playerWon) {
                goldReward = monster.goldReward;
            } else {
                goldReward = Math.floor(monster.goldReward * 0.05); // 5% on loss
            }
            
            // Award gold
            player.addGold(goldReward);
            
            // Increment monsters defeated count (awards skill points every 5 defeats)
            player.incrementMonstersDefeated();
            
            // Increment monster level for next spawn (happens regardless of win/loss)
            player.incrementMonsterLevel();
            
            console.log('Player ' + player.id + ' defeated monster. Total defeats: ' + player.monstersDefeated + ', Next monster level: ' + player.currentMonsterLevel);
            messenger.messageClientBySig(player.id, 'playerStatsUpdate', {
                playerId: player.id,
                gold: player.gold,
                skillPoints: player.skillPoints,
                currentMonsterLevel: player.currentMonsterLevel
            });
            
            // Despawn old monster
            game.despawnEntity(monster.id);
            
            // Clear player's monster reference
            player.currentMonsterId = null;
            
            // Spawn new monster at the new level
            this.spawnMonsterForPlayer(game, player);
        },

        purchaseCompanion: function(game, player, companionType) {
            // Validate companion type exists in COMPANION_DEFINITIONS
            var companionDef = COMPANION_DEFINITIONS[companionType];
            if (!companionDef) {
                return { success: false, error: 'Invalid companion type' };
            }

            // Find existing companion of this type (one entry per type, upgraded by level)
            var existing = null;
            for (var i = 0; i < player.companions.length; i++) {
                if (player.companions[i].type === companionType) {
                    existing = player.companions[i];
                    break;
                }
            }

            // Cost scales with current level (0 if not yet owned)
            var currentLevel = existing ? existing.level : 0;
            var cost = Math.floor(companionDef.baseCost * Math.pow(companionDef.costMultiplier, currentLevel));

            // Check if player can afford
            if (player.gold < cost) {
                return {
                    success: false,
                    error: 'Not enough gold (need ' + cost + ', have ' + player.gold + ')'
                };
            }

            // Spend the gold
            player.spendGold(cost);

            if (existing) {
                // Upgrade: increment the level on the existing entry
                existing.level++;
            } else {
                // First purchase: add a new entry at level 1
                player.companions.push({
                    type: companionType,
                    level: 1,
                    lastAttackTime: 0
                });
            }

            var newLevel = existing ? existing.level : 1;
            return {
                success: true,
                cost: cost,
                companionType: companionType,
                newLevel: newLevel
            };
        },

        upgradeSkill: function(game, player, skillId) {
            // Load skill definitions
            var SKILL_DEFINITIONS = require('../data/skills.js');
            var skill = SKILL_DEFINITIONS[skillId];
            
            // Validate skill exists
            if (!skill) {
                return {
                    success: false,
                    error: 'Invalid skill ID: ' + skillId
                };
            }
            
            // Check if player has enough power-up points (cost scales every 5 levels)
            var cost = player.getSkillCost(skillId);
            if (player.skillPoints < cost) {
                return {
                    success: false,
                    error: 'Not enough power-up points (need ' + cost + ', have ' + player.skillPoints + ')'
                };
            }
            
            // Check if skill is at max level
            if (player.skillTree[skillId] >= skill.maxLevel) {
                return {
                    success: false,
                    error: 'Skill already at max level (' + skill.maxLevel + ')'
                };
            }
            
            // Call player's method to spend the power-up point
            var success = player.spendSkillPoint(skillId);
            
            // If success
            if (success) {
                return {
                    success: true,
                    skillId: skillId,
                    newLevel: player.skillTree[skillId]
                };
            } else {
                // This should not happen if the checks above passed
                return {
                    success: false,
                    error: 'Failed to upgrade skill (unexpected error)'
                };
            }
        }
    };
};

// Made with Bob
