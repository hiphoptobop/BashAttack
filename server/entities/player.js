'use strict';
// Player — a dynamic Entity driven by client input. All the geometry, collision
// response, and lifecycle now live in the Entity base; Player only adds the input
// it carries and the per-step "apply input to motion" via the SHARED integrator
// (shared/movement.js), which the client runs too for prediction. Keeping that
// math shared is what lets client-side prediction agree with the server.

var utils = require('../utils.js');
var c = utils.loadConfig();
var { Entity } = require('./entity.js');
var { applyMovement } = require('../../shared/movement.js');

class Player extends Entity {
    constructor(x, y, color, id, roomSig) {
        super(x, y, c.playerBaseRadius, color, id, 'player');
        this.roomSig = roomSig;
        // Per-input queue. The client produces ONE seq'd input command per fixed
        // step and sends it; the server enqueues them here and consumes exactly ONE
        // per simulation sub-step (Player.control), in order. Consuming one-per-step
        // (rather than latching only the latest) makes the server apply each input
        // for the same single step the client predicted it for — so a non-colliding
        // player reconciles bit-exactly, not approximately.
        this.inputQueue = [];
        // The last consumed command's keys, reused while the queue is empty (a brief
        // network gap) so the player coasts on its last input instead of stalling.
        this.currentInput = { moveForward: false, moveBackward: false, turnLeft: false, turnRight: false };
        // Highest seq CONSUMED — echoed to the owning client every tick as its
        // reconciliation ack (drop inputs <= this, replay the rest). Advances by one
        // per command consumed; stays put when the queue is empty.
        this.lastInputSeq = 0;
        // Highest seq ever ENQUEUED — guards against stale/duplicate/out-of-order
        // commands at the queue boundary.
        this.lastQueuedSeq = 0;
        // Movement tuning, pulled from config once so the shared integrator gets the
        // same numbers on both sides (single source of truth).
        this.moveConsts = {
            acel: c.playerBaseAcel,
            maxVelocity: c.playerMaxSpeed,
            dragCoeff: c.playerDragCoeff,
            brakeCoeff: c.playerBrakeCoeff
        };
        
        // Combat Stats
        this.health = 100;
        this.maxHealth = 100;
        this.attackPower = 1;
        
        // Progression
        this.gold = 0;
        this.skillPoints = 0;
        this.monstersDefeated = 0;
        this.currentMonsterLevel = 1;
        
        // Companions (array of owned instances)
        this.companions = [];
        // Format: [{type: 'warrior', level: 1, lastAttackTime: 0}]
        
        // Skill Tree (skillId -> level)
        this.skillTree = {
            maxHealth: 0,
            attackPower: 0,
            companionDamage: 0,
            goldMultiplier: 0,
            clickDamage: 0,
            healthRegen: 0
        };
        
        // Combat State
        this.currentMonsterId = null;
        this.isInCombat = false;
        
        // PvP-specific properties
        this.lastAttackTime = 0;
        this.pvpKills = 0;
        this.pvpDeaths = 0;
        this.isDead = false;
        this.respawnTime = null;
    }
    // Enqueue one client input command. Rejected if it's stale/duplicate (seq not
    // strictly greater than the last enqueued). The queue is bounded; on overflow
    // the OLDEST is dropped (prefer the freshest input — lower latency), which
    // reconciliation absorbs on the client.
    enqueueInput(cmd) {
        if (cmd.seq <= this.lastQueuedSeq) {
            return; // stale, duplicate, or reordered
        }
        this.lastQueuedSeq = cmd.seq;
        this.inputQueue.push(cmd);
        if (this.inputQueue.length > c.maxInputQueue) {
            this.inputQueue.shift();
        }
    }
    // Consume exactly ONE queued input (if any) and drive velocity + scratch
    // position from it, using the exact same function the client predicts with.
    // With the queue empty (a network gap), reuse the last consumed input so motion
    // continues smoothly; lastInputSeq only advances when a command is consumed.
    control(dt) {
        if (this.inputQueue.length > 0) {
            var cmd = this.inputQueue.shift();
            this.currentInput.moveForward = cmd.moveForward;
            this.currentInput.moveBackward = cmd.moveBackward;
            this.currentInput.turnLeft = cmd.turnLeft;
            this.currentInput.turnRight = cmd.turnRight;
            this.lastInputSeq = cmd.seq;
        }
        applyMovement(this, this.currentInput, dt, this.moveConsts);
    }
    
    takeDamage(amount, isPvP = false) {
        this.health -= amount;
        if (this.health < 0) this.health = 0;
        
        // In PvP, mark as dead but don't handle respawn here
        if (isPvP && this.health === 0) {
            this.isDead = true;
        }
        
        return this.health === 0; // Returns true if player died
    }
    
    heal(amount) {
        this.health += amount;
        if (this.health > this.maxHealth) this.health = this.maxHealth;
    }
    
    addGold(amount) {
        var multiplier = 1 + (this.skillTree.goldMultiplier * 0.1);
        this.gold += Math.floor(amount * multiplier);
    }
    
    spendGold(amount) {
        if (this.gold >= amount) {
            this.gold -= amount;
            return true;
        }
        return false;
    }
    
    addSkillPoint() {
        this.skillPoints++;
        console.log('Player ' + this.id + ' awarded skill point! Total: ' + this.skillPoints);
    }
    
    incrementMonstersDefeated() {
        this.monstersDefeated++;
        
        // Award 1 skill point for every 3 monsters defeated
        if (this.monstersDefeated % 3 === 0) {
            this.addSkillPoint();
            console.log('Player ' + this.id + ' earned skill point from defeating ' + this.monstersDefeated + ' monsters!');
        }
        
        return this.monstersDefeated;
    }
    
    incrementMonsterLevel() {
        this.currentMonsterLevel++;
        return this.currentMonsterLevel;
    }
    
    // Returns the point cost to upgrade skillId from its current level.
    // Base cost comes from the skill definition; +1 is added for every 5
    // levels already purchased (thresholds: 5, 10, 15, 20 → +1 each time).
    getSkillCost(skillId) {
        var SKILL_DEFINITIONS = require('../data/skills.js');
        var skill = SKILL_DEFINITIONS[skillId];
        if (!skill) return Infinity;
        var currentLevel = this.skillTree[skillId] || 0;
        var bonus = Math.floor(currentLevel / 5);   // +1 at lv5, +2 at lv10, …
        return skill.costPerLevel + bonus;
    }

    spendSkillPoint(skillId) {
        var SKILL_DEFINITIONS = require('../data/skills.js');
        var skill = SKILL_DEFINITIONS[skillId];
        
        if (!skill) return false;
        var cost = this.getSkillCost(skillId);
        if (this.skillPoints < cost) return false;
        if (this.skillTree[skillId] >= skill.maxLevel) return false;
        
        this.skillPoints -= cost;
        this.skillTree[skillId]++;
        
        // Apply immediate effects
        if (skillId === 'maxHealth') {
            this.maxHealth += skill.bonusPerLevel;
            this.health = this.maxHealth; // Heal to full
        } else if (skillId === 'attackPower') {
            this.attackPower += skill.bonusPerLevel;
        }
        
        return true;
    }
    
    
    getEffectiveClickDamage() {
        const baseDamage = this.attackPower;
        const critChance = Math.min(this.skillTree.clickDamage * 0.05, 1.0);
        const isCrit = Math.random() < critChance;
        const damage = isCrit ? baseDamage * 2 : baseDamage;
        
        // Log critical hits for debugging
        if (isCrit) {
            console.log('CRITICAL HIT! Player ' + this.id + ' dealt ' + damage + ' damage (2x ' + baseDamage + ')');
        }
        
        return { damage, isCrit };
    }
    
    getCompanionDamageMultiplier() {
        return 1 + (this.skillTree.companionDamage * 0.2);
    }
    
    // PvP-specific methods
    canAttack(currentTime) {
        if (this.isDead) return false;
        if (!this.lastAttackTime) return true;
        return (currentTime - this.lastAttackTime) >= 1000; // 1 second cooldown
    }
    
    attackPlayer(target, currentTime) {
        if (!this.canAttack(currentTime)) return null;
        if (target.isDead) return null;
        
        // Calculate base damage
        let damage = this.attackPower;
        
        // Apply critical hit system (clickDamage now provides crit chance)
        const critChance = Math.min(this.skillTree.clickDamage * 0.05, 1.0);
        const isCrit = Math.random() < critChance;
        if (isCrit) {
            damage = damage * 2;
            console.log('CRITICAL HIT in PvP! Player ' + this.id + ' dealt ' + damage + ' damage');
        }
        
        // Random variance (±10%)
        const variance = 0.9 + (Math.random() * 0.2);
        damage = Math.floor(damage * variance);
        
        // Minimum 1 damage
        damage = Math.max(1, damage);
        
        // Update attack time
        this.lastAttackTime = currentTime;
        
        // Apply damage to target
        const targetDied = target.takeDamage(damage, true);
        
        return {
            damage: damage,
            targetDied: targetDied,
            isCrit: isCrit
        };
    }
    
    respawn(spawnX, spawnY) {
        this.health = this.maxHealth;
        this.isDead = false;
        this.respawnTime = null;
        this.x = spawnX;
        this.y = spawnY;
        // Reset velocity
        this.vx = 0;
        this.vy = 0;
    }
    
    // Calculate companion positions relative to player
    // Returns array of companion position objects with type and coordinates
    getCompanionPositions() {
        var positions = [];
        
        // Define horizontal companion positioning:
        // Order from left to right: Mage, Warrior, [Player], Archer, Priest
        var companionLayout = {
            mage: { xOffset: -70 },      // Furthest left
            warrior: { xOffset: -40 },   // Between Mage and Player
            archer: { xOffset: 40 },     // Between Player and Priest
            priest: { xOffset: 70 }      // Furthest right
        };
        
        // Build positions for owned companions
        for (var i = 0; i < this.companions.length; i++) {
            var companion = this.companions[i];
            var layout = companionLayout[companion.type];
            
            if (layout) {
                positions.push({
                    type: companion.type,
                    x: this.x + layout.xOffset,
                    y: this.y,  // Same y-coordinate as player (horizontal alignment)
                    level: companion.level
                });
            }
        }
        
        return positions;
    }
}

module.exports = { Player };
