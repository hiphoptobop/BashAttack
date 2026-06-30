'use strict';
// Monster — a stationary enemy entity that each player fights. Monsters are
// non-collidable (solid = false) and don't move (movable = false). Each player
// has their own monster instance tracked by ownerId. Stats scale based on level
// and tier to provide progressive difficulty. Now supports multiple monster types
// with unique stats and appearances.

var { Entity } = require('./entity.js');
var { MONSTER_TYPES, getRandomMonsterType } = require('../data/monsterTypes.js');

class Monster extends Entity {
    constructor(x, y, level, ownerId, id, monsterType = null, isBoss = false) {
        // Determine monster type if not specified
        if (!monsterType) {
            monsterType = getRandomMonsterType(level);
        }
        
        // Get type data
        const typeData = MONSTER_TYPES[monsterType] || MONSTER_TYPES.GOBLIN;
        
        // Initialize with type-specific color
        super(x, y, 30, typeData.color, id, 'monster');
        
        this.level = level;
        this.ownerId = ownerId;
        this.monsterType = monsterType;
        this.typeName = typeData.name;
        this.isBoss = false;
        
        // Scale every level a little so progression feels steady without boss spikes
        // or sudden jumps at milestone levels.
        var levelOffset = Math.max(0, level - 1);
        
        // Health, attack, and rewards all rise smoothly every level.
        this.maxHealth = Math.floor((60 + (levelOffset * 6)) * typeData.healthMultiplier);
        this.health = this.maxHealth;
        // Minimum 1 attack power. Apply type multiplier before flooring so fractional
        // multipliers (e.g. SLIME 0.7) don't round a low base down to 0.
        this.attackPower = Math.max(1, Math.floor((1 + levelOffset * 0.12) * typeData.attackMultiplier));
        this.goldReward = Math.floor((10 + levelOffset * 3) * typeData.goldMultiplier);
        
        // Combat timing - varies by type
        this.attackSpeed = Math.floor(2000 / typeData.speedMultiplier);
        this.lastAttackTime = 0;
        
        // Monsters don't move or collide
        this.solid = false;
        this.movable = false;
    }
    
    // Override control to do nothing - monsters are static
    control(dt) {
        // Monsters don't move
    }
}

module.exports = { Monster };

// Made with Bob
