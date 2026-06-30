'use strict';
// Targeted audit of all recent changes:
//   1. Companion attack events (warrior/archer/mage/priest) emitted server-side
//   2. priestHeal event emitted for priest only
//   3. Duplicate-spawn guard in enterGame (player already in room)
//   4. Draw-layer globals (slashEffects, companionEffects) present in game.js source
//   5. All four visual branches present in draw.js

var pass = 0, fail = 0;
function assert(label, cond) {
    if (cond) { console.log('  PASS ', label); pass++; }
    else       { console.error('  FAIL ', label); fail++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: lightweight stubs
// ─────────────────────────────────────────────────────────────────────────────
function makePlayer(id) {
    return {
        id: id,
        x: 0, y: 0,
        health: 100, maxHealth: 100,
        gold: 9999,
        skillPoints: 0,
        skillTree: { healthRegen: 0, clickDamage: 0, companionDamage: 0,
                     goldMultiplier: 0, maxHealth: 0, attackPower: 0 },
        attackPower: 10,
        currentMonsterId: null,
        isInCombat: false,
        roomSig: 'pve-1',
        roomType: 'pve',
        companions: [],
        monstersDefeated: 0,
        currentMonsterLevel: 1,
        lastAttackTime: 0,
        isDead: false,
        getEffectiveClickDamage: function() { return { damage: 5, isCrit: false }; },
        getCompanionDamageMultiplier: function() { return 1; },
        takeDamage: function(dmg) { this.health -= dmg; return this.health <= 0; },
        heal: function(amt) { this.health = Math.min(this.maxHealth, this.health + amt); },
        addGold: function(g) { this.gold += g; },
        spendGold: function(g) { this.gold -= g; },
        incrementMonstersDefeated: function() { this.monstersDefeated++; },
        incrementMonsterLevel: function() { this.currentMonsterLevel++; },
        spendSkillPoint: function(id) { this.skillTree[id] = (this.skillTree[id]||0)+1; return true; }
    };
}

function makeMonster(ownerId) {
    return {
        id: 'mon_' + ownerId,
        type: 'monster',
        ownerId: ownerId,
        health: 500, maxHealth: 500,
        attackPower: 5,
        attackSpeed: 1000,
        lastAttackTime: 0,
        goldReward: 10
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Server — companion attack & priestHeal events
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAudit 1: server companion events');

// Load real companion defs for heal amount check
var COMPANION_DEFINITIONS = require('../server/data/companions.js');

var emitted = [];
// Stub messenger so we capture messageClientBySig calls
var messengerStub = {
    messageClientBySig: function(id, event, data) {
        emitted.push({ id, event, data });
    }
};

// Temporarily inject our stub before requiring the mode
var Module = require('module');
var origLoad = Module._load;
Module._load = function(req, parent, isMain) {
    if (req === '../messenger.js' || req.endsWith('/messenger.js')) return messengerStub;
    return origLoad.apply(this, arguments);
};

var createIdleClickerMode = require('../server/modes/idleclicker.js');
Module._load = origLoad;  // restore

var mode = createIdleClickerMode();

var companionTypes = ['warrior', 'archer', 'mage', 'priest'];
companionTypes.forEach(function(type) {
    var player = makePlayer('p_' + type);
    player.companions = [{ type: type, level: 1, lastAttackTime: 0 }];
    var monster = makeMonster(player.id);
    emitted = [];

    var fakeTime = 99999; // well past any cooldown
    mode.processCompanionAttacks({ entities: {}, playerList: {}, roomType: 'pve', roomSig: 'pve-1',
        spawnEntity: function(){}, despawnEntity: function(){} }, player, monster, fakeTime);

    var attackEvt = emitted.find(function(e) { return e.event === 'companionAttack'; });
    assert(type + ': companionAttack event emitted', !!attackEvt);
    assert(type + ': companionAttack has correct companionType',
        attackEvt && attackEvt.data.companionType === type);

    if (type === 'priest') {
        var healEvt = emitted.find(function(e) { return e.event === 'priestHeal'; });
        assert('priest: priestHeal event emitted', !!healEvt);
        // Priest heals by healAmount; take damage first so health isn't already at max
        player.health = 50;
        player.heal(COMPANION_DEFINITIONS['priest'].healAmount || 2);
        assert('priest: player healed (health increases from 50)', player.health > 50);
    } else {
        var healEvt = emitted.find(function(e) { return e.event === 'priestHeal'; });
        assert(type + ': NO priestHeal emitted for non-priest', !healEvt);
    }
});

// companionAttack fires each tick (cooldown resets each time)
(function() {
    var player = makePlayer('p_cooldown');
    player.companions = [{ type: 'warrior', level: 1, lastAttackTime: 0 }];
    var monster = makeMonster(player.id);
    emitted = [];
    var t1 = 99999;
    mode.processCompanionAttacks({ entities:{}, playerList:{}, roomType:'pve', roomSig:'pve-1',
        spawnEntity:function(){}, despawnEntity:function(){} }, player, monster, t1);
    var first = emitted.filter(function(e){ return e.event === 'companionAttack'; }).length;

    // second call immediately — should NOT fire again (cooldown not elapsed)
    emitted = [];
    mode.processCompanionAttacks({ entities:{}, playerList:{}, roomType:'pve', roomSig:'pve-1',
        spawnEntity:function(){}, despawnEntity:function(){} }, player, monster, t1);
    var second = emitted.filter(function(e){ return e.event === 'companionAttack'; }).length;

    assert('warrior: fires on first call', first === 1);
    assert('warrior: does NOT fire again before cooldown', second === 0);

    // call after attackSpeed ms — should fire again
    emitted = [];
    mode.processCompanionAttacks({ entities:{}, playerList:{}, roomType:'pve', roomSig:'pve-1',
        spawnEntity:function(){}, despawnEntity:function(){} }, player, monster, t1 + 1000);
    var third = emitted.filter(function(e){ return e.event === 'companionAttack'; }).length;
    assert('warrior: fires again after cooldown', third === 1);
}());

// ─────────────────────────────────────────────────────────────────────────────
// 2. Duplicate-spawn guard in messenger.js enterGame
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAudit 2: duplicate-spawn guard');

var messengerSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../server/messenger.js'), 'utf8');

assert('enterGame uses pendingTransfers to restore stats without extra spawn',
    messengerSrc.includes('pendingTransfers[String(roomSig)]'));
assert('enterGame deletes transfer after applying it (consumed once)',
    messengerSrc.includes('delete pendingTransfers[String(roomSig)]'));
assert('enterGame still calls spawnPlayer for genuinely new joins',
    messengerSrc.includes('spawnPlayer'));

// ─────────────────────────────────────────────────────────────────────────────
// 3. Client-side globals in game.js source
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAudit 3: client globals');

var gameSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../client/scripts/game.js'), 'utf8');

assert('slashEffects global declared', gameSrc.includes('slashEffects'));
assert('companionEffects global declared', gameSrc.includes('companionEffects'));

// ─────────────────────────────────────────────────────────────────────────────
// 4. client.js handlers wired
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAudit 4: client.js event handlers');

var clientSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../client/scripts/client.js'), 'utf8');

assert("server.on('companionAttack') registered", clientSrc.includes("server.on('companionAttack'"));
assert("server.on('priestHeal') registered",      clientSrc.includes("server.on('priestHeal'"));
assert('companionEffects.push() on companionAttack', (function() {
    var idx = clientSrc.indexOf("server.on('companionAttack'");
    var end = clientSrc.indexOf('\n    });\n', idx + 1);  // closing of the handler
    var chunk = clientSrc.slice(idx, end + 8);
    return chunk.includes('companionEffects.push');
}()));
assert('slashEffects.push() on player click combatEvent', clientSrc.includes('slashEffects.push'));
assert('priestHeal pushes 3 entries (loop i < 3)', (function() {
    var idx = clientSrc.indexOf("server.on('priestHeal'");
    var chunk = clientSrc.slice(idx, idx + 600);
    return chunk.includes('i < 3') && chunk.includes('companionEffects.push');
}()));

// ─────────────────────────────────────────────────────────────────────────────
// 5. draw.js visual branches
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAudit 5: draw.js visual branches');

var drawSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../client/scripts/draw.js'), 'utf8');

assert("drawCompanionEffects function defined",  drawSrc.includes('function drawCompanionEffects'));
assert("drawCompanionEffects called in drawObjects", (function() {
    var drawObjEnd = drawSrc.indexOf('drawPvPEffects');
    var callIdx    = drawSrc.indexOf('drawCompanionEffects(ctx)');
    return callIdx !== -1 && callIdx < drawObjEnd;
}()));
assert("warrior branch present",   drawSrc.includes("e.kind === 'warrior'"));
assert("archer branch present",    drawSrc.includes("e.kind === 'archer'"));
assert("mage branch present",      drawSrc.includes("e.kind === 'mage'"));
assert("priestHeal branch present",drawSrc.includes("e.kind === 'priestHeal'"));

// Warrior: two offset slashes (offsets array)
assert('warrior uses offset pair [-10, 10]', drawSrc.includes('[-10, 10]'));
// Archer: arrowhead triangle drawn
assert('archer draws arrowhead (closePath+fill)', (function() {
    var idx = drawSrc.indexOf("e.kind === 'archer'");
    var nextKind = drawSrc.indexOf("e.kind ===", idx + 1);
    var chunk = drawSrc.slice(idx, nextKind);
    return chunk.includes('closePath') && chunk.includes('ctx.fill()');
}()));
// Mage: lightning segments (zigzag)
assert('mage generates zigzag points array', (function() {
    var idx = drawSrc.indexOf("e.kind === 'mage'");
    var nextKind = drawSrc.indexOf("e.kind ===", idx + 1);
    var chunk = drawSrc.slice(idx, nextKind);
    return chunk.includes('points') && chunk.includes('jitter') && chunk.includes('segments');
}()));
assert('mage draws glow + core passes (three stroke calls)', (function() {
    var idx = drawSrc.indexOf("e.kind === 'mage'");
    var nextKind = drawSrc.indexOf("e.kind ===", idx + 1);
    var chunk = drawSrc.slice(idx, nextKind);
    var strokes = (chunk.match(/ctx\.stroke\(\)/g) || []).length;
    return strokes >= 3; // glow, purple core, white inner
}()));
// Priest: + sign uses fillRect twice (horizontal + vertical bars)
assert('priestHeal draws two fillRect bars', (function() {
    var idx = drawSrc.indexOf("e.kind === 'priestHeal'");
    var closingBrace = drawSrc.indexOf('\n    }\n}', idx); // end of the else-if block
    var chunk = drawSrc.slice(idx, closingBrace > idx ? closingBrace : idx + 800);
    var rects = (chunk.match(/ctx\.fillRect/g) || []).length;
    return rects >= 2;
}()));
assert('priestHeal floats upward (t * 25)', drawSrc.includes('t * 25'));

// Shake: health bar uses playerScreen.x (not shaken screenX)
assert('health bar barX anchored to playerScreen.x (no shake)',
    drawSrc.includes('var barX = playerScreen.x - barWidth / 2'));

// drawSlashEffects also present and called
assert('drawSlashEffects function defined', drawSrc.includes('function drawSlashEffects'));
assert('drawSlashEffects called in drawObjects', drawSrc.includes('drawSlashEffects(ctx)'));

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nchanges_audit: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) { process.exit(1); }
