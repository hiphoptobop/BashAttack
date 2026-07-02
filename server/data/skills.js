'use strict';
// Power-Up definitions — data structures for the power-up system. Power-Ups provide
// passive bonuses to the player. Some apply immediately (maxHealth, attackPower),
// while others are used in calculations (clickDamage, companionDamage,
// goldMultiplier, healthRegen). Players spend power-up points to level up power-ups.

const SKILL_DEFINITIONS = {
    maxHealth: {
        name: 'Vitality',
        maxLevel: 25,
        costPerLevel: 1,
        bonusPerLevel: 20,
        description: '+20 max health per level'
    },
    attackPower: {
        name: 'Strength',
        maxLevel: 25,
        costPerLevel: 1,
        bonusPerLevel: 1,
        description: '+1 attack power per level'
    },
    clickDamage: {
        name: 'Precision',
        maxLevel: 25,
        costPerLevel: 2,
        bonusPerLevel: 0.05,
        description: '+5% critical hit chance per level'
    },
    companionDamage: {
        name: 'Leadership',
        maxLevel: 25,
        costPerLevel: 2,
        bonusPerLevel: 0.2,
        description: '+20% companion damage per level'
    },
    goldMultiplier: {
        name: 'Fortune',
        maxLevel: 25,
        costPerLevel: 2,
        bonusPerLevel: 0.1,
        description: '+10% gold earned per level'
    },
    healthRegen: {
        name: 'Regeneration',
        maxLevel: 25,
        costPerLevel: 2,
        bonusPerLevel: 1,
        description: '+1 health per second per level'
    }
};

module.exports = SKILL_DEFINITIONS;

// Made with Bob
