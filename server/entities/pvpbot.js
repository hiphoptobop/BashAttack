'use strict';
// PvPBot — a server-driven AI opponent in the PvP arena.
// Extends Entity so the engine simulates its movement and collisions normally.
// Its "input" is computed each tick by a simple state machine:
//   WANDER  — picks a random target point and moves toward it
//   CHASE   — locks onto the nearest living player and chases them
//   ATTACK  — when in range, attacks via the PvP mode's handleAttack

var { Entity } = require('./entity.js');
var utils = require('../utils.js');
var c = utils.loadConfig();

// Attack range (matches pvp.js ATTACK_RANGE = 100 px).
var ATTACK_RANGE = 100;
// Movement speed (px / s).
var BOT_SPEED    = 200;
// How long (ms) the bot stays on a wander target before picking a new one.
var WANDER_TIMEOUT = 2500;
// Attack cooldown (ms) — matches pvp.js 1000 ms cooldown.
var ATTACK_COOLDOWN = 2000;

class PvPBot extends Entity {
    constructor(x, y, tier, id) {
        var color = '#e53935'; // distinct red so players can tell it's a bot
        super(x, y, c.playerBaseRadius, color, id, 'player');

        this.tier            = tier;
        this.isBot           = true;

        // Stats scale with tier so higher-tier bots are tougher.
        this.maxHealth       = 100 + (tier - 1) * 20;
        this.health          = this.maxHealth;
        this.attackPower     = Math.round((10 + (tier - 1) * 5) / 2);

        // Fields the compressor / wire protocol expect on a player entity.
        this.gold                = 0;
        this.skillPoints         = 0;
        this.monstersDefeated    = 0;
        this.currentMonsterLevel = (tier - 1) * 10 + 1;
        this.companions          = [];
        this.skillTree           = { maxHealth: 0, attackPower: 0, companionDamage: 0,
                                     goldMultiplier: 0, clickDamage: 0, healthRegen: 0 };
        this.currentMonsterId    = null;
        this.isInCombat          = false;
        this.isDead              = false;
        this.respawnTime         = null;
        this.lastAttackTime      = 0;
        this.pvpKills            = 0;
        this.pvpDeaths           = 0;
        this.roomType            = 'pvp';

        // Input / reconciliation stubs (compressor reads these).
        this.lastInputSeq  = 0;
        this.lastQueuedSeq = 0;
        this.inputQueue    = [];
        this.currentInput  = { moveForward: false, moveBackward: false,
                               turnLeft: false, turnRight: false };
        this.moveConsts = {
            acel: c.playerBaseAcel,
            maxVelocity: BOT_SPEED,
            dragCoeff: c.playerDragCoeff,
            brakeCoeff: c.playerBrakeCoeff
        };

        // AI state.
        this._state          = 'wander';
        this._wanderTarget   = null;
        this._wanderSetAt    = 0;
        this._targetPlayerId = null;
        this._nearest        = null;

        // Reference to the game instance — set by pvp.js onStart after spawning.
        this._game = null;
    }

    // control(dt) is called by the engine each physics step. Velocity is set here
    // so the engine's bounce/collision/move pipeline sees it correctly.
    control(dt) {
        if (this.isDead || !this._game) {
            // Coast to a stop when dead or not yet linked to a game.
            this.velX *= 0.85;
            this.velY *= 0.85;
            this.newX += this.velX * dt;
            this.newY += this.velY * dt;
            return;
        }

        var now   = Date.now();
        var world = this._game.world;

        // ── Wander only — pick a new random target every WANDER_TIMEOUT ms ───
        if (!this._wanderTarget || now - this._wanderSetAt > WANDER_TIMEOUT) {
            this._wanderTarget = {
                x: 80 + Math.random() * (world.width  - 160),
                y: 80 + Math.random() * (world.height - 160)
            };
            this._wanderSetAt = now;
        }
        var wx   = this._wanderTarget.x - this.x;
        var wy   = this._wanderTarget.y - this.y;
        var wlen = Math.sqrt(wx * wx + wy * wy) || 1;
        if (wlen < 20) {
            // Reached target — coast until next target is picked.
            this.velX *= 0.85;
            this.velY *= 0.85;
        } else {
            this.velX = (wx / wlen) * (BOT_SPEED * 0.6);
            this.velY = (wy / wlen) * (BOT_SPEED * 0.6);
        }

        // Still track nearest player so tickAI can attack if they walk into range.
        var players = this._game.playerList;
        var nearest = null, nearestDist = Infinity;
        for (var pid in players) {
            var p = players[pid];
            if (p.isBot || p.isDead) { continue; }
            var dx = p.x - this.x, dy = p.y - this.y;
            var d  = Math.sqrt(dx * dx + dy * dy);
            if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        this._nearest     = nearest;
        this._nearestDist = nearestDist;
        this._state       = (nearest && nearestDist <= ATTACK_RANGE) ? 'attack' : 'wander';

        // Advance scratch position — engine will bounce + commit via move().
        this.newX += this.velX * dt;
        this.newY += this.velY * dt;
    }

    // Called every server tick by pvp.js onTick — handles attacks only.
    // Movement is now driven by control() inside the engine step.
    tickAI(game, dt) {
        if (this.isDead) { return; }
        var nearest = this._nearest;
        if (this._state === 'attack' && nearest &&
            Date.now() - this.lastAttackTime >= ATTACK_COOLDOWN) {
            game.mode.handleAttack(game, this.id, nearest.id);
        }
    }

    // PvP compatibility shims used by pvp.js handleAttack.
    canAttack(currentTime) {
        if (this.isDead) { return false; }
        return (currentTime - this.lastAttackTime) >= ATTACK_COOLDOWN;
    }

    attackPlayer(target, currentTime) {
        if (!this.canAttack(currentTime)) { return null; }
        if (target.isDead) { return null; }
        var damage = Math.max(1, Math.floor(this.attackPower * (0.9 + Math.random() * 0.2)));
        this.lastAttackTime = currentTime;
        var targetDied = target.takeDamage(damage, true);
        return { damage, targetDied, isCrit: false };
    }

    respawn(spawnX, spawnY) {
        this.health      = this.maxHealth;
        this.isDead      = false;
        this.respawnTime = null;
        this.x = spawnX; this.newX = spawnX;
        this.y = spawnY; this.newY = spawnY;
        this.velX = 0; this.velY = 0;
        this._state        = 'wander';
        this._wanderTarget = null;
    }

    takeDamage(amount, isPvP) {
        this.health -= amount;
        if (this.health < 0) { this.health = 0; }
        if (isPvP && this.health === 0) { this.isDead = true; }
        return this.health === 0;
    }
}

module.exports = { PvPBot };
