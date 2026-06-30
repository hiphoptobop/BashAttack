'use strict';
// Monster type definitions with unique stats and characteristics
// Each type has different scaling, colors, and behaviors

const MONSTER_TYPES = {
    GOBLIN: {
        name: 'Goblin',
        color: '#8B0000',
        healthMultiplier: 0.8,
        attackMultiplier: 0.9,
        speedMultiplier: 1.2,
        goldMultiplier: 0.9,
        description: 'Fast but weak'
    },
    ORC: {
        name: 'Orc',
        color: '#2F4F2F',
        healthMultiplier: 1.2,
        attackMultiplier: 1.1,
        speedMultiplier: 0.9,
        goldMultiplier: 1.1,
        description: 'Strong and tough'
    },
    SKELETON: {
        name: 'Skeleton',
        color: '#F5F5DC',
        healthMultiplier: 0.7,
        attackMultiplier: 1.0,
        speedMultiplier: 1.0,
        goldMultiplier: 0.8,
        description: 'Fragile but quick'
    },
    DEMON: {
        name: 'Demon',
        color: '#8B008B',
        healthMultiplier: 1.3,
        attackMultiplier: 1.3,
        speedMultiplier: 0.8,
        goldMultiplier: 1.5,
        description: 'Powerful and dangerous'
    },
    SLIME: {
        name: 'Slime',
        color: '#00FF7F',
        healthMultiplier: 1.5,
        attackMultiplier: 0.7,
        speedMultiplier: 0.7,
        goldMultiplier: 1.0,
        description: 'High health, low damage'
    },
    DRAGON: {
        name: 'Dragon',
        color: '#FF4500',
        healthMultiplier: 2.0,
        attackMultiplier: 1.5,
        speedMultiplier: 0.6,
        goldMultiplier: 2.0,
        description: 'Boss-tier enemy'
    }
};

// Get a random monster type (weighted distribution)
function getRandomMonsterType(level) {
    // Dragons only appear at higher levels
    if (level < 10) {
        const types = ['GOBLIN', 'ORC', 'SKELETON', 'SLIME'];
        return types[Math.floor(Math.random() * types.length)];
    } else if (level < 25) {
        const types = ['GOBLIN', 'ORC', 'SKELETON', 'SLIME', 'DEMON'];
        return types[Math.floor(Math.random() * types.length)];
    } else {
        // All types available at high levels
        const types = Object.keys(MONSTER_TYPES);
        return types[Math.floor(Math.random() * types.length)];
    }
}

// Get monster type for boss encounters (every 10 levels)
function getBossMonsterType(level) {
    // Bosses are always Dragons or Demons
    return level >= 20 ? 'DRAGON' : 'DEMON';
}

module.exports = {
    MONSTER_TYPES,
    getRandomMonsterType,
    getBossMonsterType
};

// Made with Bob