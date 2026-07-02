'use strict';
// Companion definitions — data structures for the different companion types
// that players can purchase. Companions provide auto-attack damage and are
// stored in the player's companions array. Each companion type has different
// costs, attack power, and attack speeds.

const COMPANION_DEFINITIONS = {
    warrior: {
        name: 'Warrior',
        baseCost: 20,
        costMultiplier: 1.5,
        baseAttack: 2,
        attackSpeed: 1000
    },
    archer: {
        name: 'Archer',
        baseCost: 100,
        costMultiplier: 1.5,
        baseAttack: 4,
        attackSpeed: 1000
    },
    mage: {
        name: 'Mage',
        baseCost: 400,
        costMultiplier: 1.5,
        baseAttack: 16,
        attackSpeed: 2000
    },
    priest: {
        name: 'Priest',
        baseCost: 1000,
        costMultiplier: 1.5,
        baseAttack: 0,
        attackSpeed: 1000,
        healAmount: 2
    }
};

module.exports = COMPANION_DEFINITIONS;

// Made with Bob
