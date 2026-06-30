// Headless integration test — two scripted clients against a running server.
// Decodes the current PvE wire arrays and verifies the real join/update flow stays
// compatible with the active idle clicker mode.
'use strict';
var { io } = require('socket.io-client');

var URL = 'http://localhost:3000';
var passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name); } }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function decodeSpawnEntity(a) {
    var entity = { type: a[0], id: a[1], x: a[2], y: a[3], color: a[4], radius: a[5] };
    if (a[0] === 'monster') {
        entity.health = a[6];
        entity.maxHealth = a[7];
        entity.ownerId = a[8];
        entity.level = a[9] || 1;
    } else if (a[0] === 'player') {
        entity.health = a[6];
        entity.maxHealth = a[7];
        entity.gold = a[8];
        entity.attackPower = a[10];
        entity.skillPoints = a[11];
        entity.monstersDefeated = a[12];
        entity.currentMonsterLevel = a[13];
        entity.companions = a[14] || [];
    }
    return entity;
}

function applyUpdateRow(cl, row) {
    if (row[0] === 'monster') {
        var monster = cl.entities[row[1]];
        if (monster) {
            monster.x = row[2];
            monster.y = row[3];
            monster.health = row[4];
            monster.maxHealth = row[5];
            monster.level = row[6];
        }
        return;
    }
    if (row[0] === 'idleplayer') {
        var idlePlayer = cl.entities[row[1]];
        if (idlePlayer) {
            idlePlayer.x = row[2];
            idlePlayer.y = row[3];
            idlePlayer.velX = row[4];
            idlePlayer.velY = row[5];
            idlePlayer.health = row[7];
            idlePlayer.maxHealth = row[8];
            idlePlayer.gold = row[9];
            idlePlayer.attackPower = row[10];
            idlePlayer.skillPoints = row[11];
            idlePlayer.monstersDefeated = row[12];
            idlePlayer.currentMonsterLevel = row[13];
            idlePlayer.companions = row[14] || [];
        }
        if (row[1] === cl.id) {
            cl.lastAck = row[6];
        }
        return;
    }
    var entity = cl.entities[row[0]];
    if (entity) {
        entity.x = row[1];
        entity.y = row[2];
        entity.velX = row[3];
        entity.velY = row[4];
    }
    if (row[0] === cl.id) {
        cl.lastAck = row[5];
    }
}

function mkClient() {
    var cl = { id: null, world: null, obstacles: null, state: null, config: null, version: null, entities: {}, seq: 0, lastAck: null };
    var s = io(URL, { transports: ['websocket'] });
    cl.socket = s;
    s.on('gameState', function (gs) {
        cl.version = gs.protocolVersion;
        cl.id = gs.myID;
        cl.config = gs.config;
        cl.world = JSON.parse(gs.world);
        cl.obstacles = JSON.parse(gs.obstacles);
        cl.state = JSON.parse(gs.game)[0];
        JSON.parse(gs.entityList).forEach(function (a) {
            var entity = decodeSpawnEntity(a);
            cl.entities[entity.id] = entity;
        });
    });
    s.on('entitySpawn', function (rec) {
        var entity = decodeSpawnEntity(JSON.parse(rec));
        cl.entities[entity.id] = entity;
    });
    s.on('entityDespawn', function (id) { delete cl.entities[id]; });
    s.on('gameUpdates', function (u) {
        cl.state = JSON.parse(u.state)[0];
        cl.tick = u.tick;
        u.entityList.forEach(function (row) {
            applyUpdateRow(cl, row);
        });
    });
    return cl;
}
function drive(cl, dirs) {
    cl.seq++;
    cl.socket.emit('movement', Object.assign({ seq: cl.seq, moveForward: false, moveBackward: false, turnLeft: false, turnRight: false }, dirs));
}
function countType(cl, type) { return Object.keys(cl.entities).filter(function (k) { return cl.entities[k].type === type; }).length; }
function getOwnedMonster(cl) {
    return Object.keys(cl.entities).map(function (k) { return cl.entities[k]; }).find(function (e) {
        return e.type === 'monster' && e.ownerId === cl.id;
    }) || null;
}

(async function () {
    console.log('integration.test.js');

    var a = mkClient();
    await sleep(300); a.socket.emit('enterGame', -1);
    await sleep(500);
    var b = mkClient();
    await sleep(300); b.socket.emit('enterGame', -1);
    await sleep(600);

    check('protocol version delivered (v1)', a.version === 1);
    check('A and B got distinct ids', a.id != null && a.id !== b.id);
    check('A sees both players', countType(a, 'player') === 2);
    check('B sees both players', countType(b, 'player') === 2);
    check('each player gets an owned monster in PvE mode', !!getOwnedMonster(a) && !!getOwnedMonster(b));
    check('obstacle payload is delivered on join', Array.isArray(a.obstacles));
    check('world arena delivered (1366x768)', a.world && a.world[2] === 1366 && a.world[3] === 768);
    check('config delivered (single source of truth)', a.config != null && a.config.worldWidth === 1366);
    check('state is playing (1)', a.state === 1);

    var startX = a.entities[a.id].x;
    var driveTimer = setInterval(function () { drive(a, { turnRight: true }); }, 33);
    await sleep(1000);
    clearInterval(driveTimer);
    drive(a, {});
    await sleep(200);
    var movedX = a.entities[a.id].x;
    check('driving moves the player (server-authoritative)', Math.abs(movedX - startX) > 40);
    check('server acks our latest input seq (reconciliation plumbing)', a.lastAck != null && a.lastAck > 0);

    check('B sees A at the same authoritative position (live sync)',
        b.entities[a.id] && Math.abs(b.entities[a.id].x - movedX) < 50);

    b.socket.close();
    await sleep(500);
    check('A drops B after B disconnects', b.id != null && a.entities[b.id] == null);

    a.socket.close();
    console.log('integration: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed === 0 ? 0 : 1);
})();
