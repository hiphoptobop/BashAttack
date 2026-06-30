// Socket handlers + DECODERS — the CLIENT half of the wire contract.
//
// *** THE LOCKSTEP RULE ***
// The decoders below read POSITIONAL ARRAYS produced by server/compressor.js. Slot
// order MUST match the packers there exactly. The protocol is versioned: on join we
// compare the server's protocolVersion to CLIENT_PROTOCOL_VERSION and refuse to run
// on a mismatch, so a layout drift fails loudly instead of silently misreading.

function registerHandlers(server) {
    server.on('welcome', function (id) {
        myID = id;
    });

    // Full join snapshot: version, config, world, obstacles, entities, state, our id.
    server.on('gameState', function (gs) {
        if (gs.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
            protocolOK = false;
            console.error('Protocol mismatch: server v' + gs.protocolVersion +
                ' vs client v' + CLIENT_PROTOCOL_VERSION + ' — refusing to run. Reload the page.');
            return;
        }
        config = gs.config;
        FIXED_DT_MS = config.serverTickSpeed;
        FIXED_DT_S = config.serverTickSpeed / 1000;
        myID = gs.myID;
        serverTick = gs.tick;

        // gameState is a FULL snapshot. Reset the entity set first so a reconnect
        // (Socket.IO auto-reconnects and re-emits enterGame, getting a fresh socket
        // id + snapshot) can't leave the old player and any since-despawned entities
        // as frozen ghosts — our own despawns were broadcast while we were offline.
        entities = {};

        worldResize(gs.world);
        decodeObstacles(gs.obstacles);
        spawnEntities(gs.entityList);
        checkGameState(gs.game);
        resetPvPClientState();

        // Seed prediction from our authoritative spawn position.
        var me = entities[myID];
        if (me != null) {
            predictionInit(me.x, me.y);
        }

        resize();
        if (!gameRunning) {
            gameRunning = true;
            lastFrameTime = Date.now();
            animloop();
        }
    });

    // An entity appeared (a joining player, or a mode-spawned thing like a pickup).
    server.on('entitySpawn', function (rec) {
        appendEntity(rec);
    });

    // An entity left / was removed.
    server.on('entityDespawn', function (id) {
        delete entities[id];
    });

    // Per-tick authoritative snapshot.
    server.on('gameUpdates', function (u) {
        updateEntities(u.entityList);
        checkGameState(u.state);
        serverTick = u.tick;
    });

    server.on('pvpCombat', function (data) {
        handlePvPCombat(data);
    });

    server.on('pvpDeath', function (data) {
        handlePvPDeath(data);
    });

    server.on('pvpRespawn', function (data) {
        handlePvPRespawn(data);
    });

    server.on('pvpAttackError', function (data) {
        handlePvPAttackError(data);
    });

    server.on('switchRoomError', function (data) {
        handleSwitchRoomError(data);
    });

    server.on('roomNotFound', function () {
        console.warn('roomNotFound — retrying matchmaking in 1s');
        setTimeout(function () { server.emit('enterGame', -1); }, 1000);
    });

    // Idle Clicker: Combat event
    server.on('combatEvent', function(data) {
        // Trigger monster shake on every hit
        if (typeof monsterShake !== 'undefined') {
            monsterShake.until = Date.now() + 300;
        }
        // Store combat event for rendering
        if (!combatEvents) combatEvents = [];
        combatEvents.push({
            playerId: data.playerId,
            type: data.type,
            damage: data.damage,
            monsterHealth: data.monsterHealth,
            timestamp: Date.now()
        });

        // Spawn a slash effect when the LOCAL player lands a hit.
        if (data.playerId === myID && data.type === 'playerClick') {
            var player = entities[myID];
            if (player && typeof slashEffects !== 'undefined') {
                // ── Rainbow colour: step through the spectrum on every click ──
                // Advance 40° per click so 9 clicks cycle the full rainbow.
                if (typeof clickSpeedTracker !== 'undefined') {
                    clickSpeedTracker.hue = (clickSpeedTracker.hue + 40) % 360;
                }
                var hue = (typeof clickSpeedTracker !== 'undefined') ? clickSpeedTracker.hue : 0;

                slashEffects.push({
                    startedAt: Date.now(),
                    duration: 350,
                    fromX: player.x,
                    fromY: player.y,
                    hue: hue
                });
                if (slashEffects.length > 10) { slashEffects.shift(); }
            }
        }
        
        // Immediately update the monster's health for responsive visual feedback
        if (data.monsterId && game && game.entities && game.entities[data.monsterId]) {
            game.entities[data.monsterId].health = data.monsterHealth;
        }
        
        // Keep only last 10 events
        if (combatEvents.length > 10) {
            combatEvents.shift();
        }
    });

    // Idle Clicker: Companion attack visual event
    server.on('companionAttack', function(data) {
        var player = entities[myID];
        if (!player || typeof companionEffects === 'undefined') { return; }

        // Work out which side this companion sits on and what its index is
        // so drawCompanionEffects can reconstruct the exact portrait position.
        var type = data.companionType;
        var leftTypes  = (typeof COMPANION_LEFT  !== 'undefined') ? COMPANION_LEFT  : ['warrior', 'mage'];
        var rightTypes = (typeof COMPANION_RIGHT !== 'undefined') ? COMPANION_RIGHT : ['archer', 'priest'];

        var side  = (leftTypes.indexOf(type)  !== -1) ? 'left'
                  : (rightTypes.indexOf(type) !== -1) ? 'right' : 'right';

        // Find which companions the player currently has on this side to determine index.
        var sideList = (side === 'left') ? leftTypes : rightTypes;
        var companions = (player.companions && Array.isArray(player.companions))
            ? player.companions : [];
        // Build sorted list of this side's types that the player owns
        var owned = sideList.filter(function(t) {
            return companions.some(function(c) { return c.type === t; });
        });
        var sideIndex = owned.indexOf(type);
        if (sideIndex < 0) { sideIndex = 0; }

        companionEffects.push({
            kind: type,
            startedAt: Date.now(),
            duration: type === 'mage' ? 500 : 400,
            fromX: player.x,
            fromY: player.y,
            side: side,
            sideIndex: sideIndex
        });
        if (companionEffects.length > 20) { companionEffects.shift(); }
    });

    // Idle Clicker: Priest heal visual
    server.on('priestHeal', function() {
        var player = entities[myID];
        if (!player || typeof companionEffects === 'undefined') { return; }
        // Spawn 3 + signs scattered around the player
        for (var i = 0; i < 3; i++) {
            var angle = (Math.PI * 2 / 3) * i + Math.random() * 0.4;
            var dist  = 30 + Math.random() * 20;
            companionEffects.push({
                kind: 'priestHeal',
                startedAt: Date.now(),
                duration: 700,
                offsetX: Math.cos(angle) * dist,
                offsetY: Math.sin(angle) * dist,
                fromX: player.x,
                fromY: player.y
            });
        }
        if (companionEffects.length > 30) { companionEffects.splice(0, companionEffects.length - 30); }
    });

    // Idle Clicker: Monster attack animation
    server.on('monsterAttack', function(data) {
        var player = entities[myID];
        if (!player || typeof companionEffects === 'undefined') { return; }
        // Spawn 4 claw-scratch marks radiating out from the player position.
        for (var i = 0; i < 4; i++) {
            var angle = (Math.PI * 2 / 4) * i + Math.PI / 8; // rotate 22.5° for variety
            companionEffects.push({
                kind: 'monsterHit',
                startedAt: Date.now(),
                duration: 450,
                angle: angle,
                fromX: player.x,
                fromY: player.y
            });
        }
        if (companionEffects.length > 30) { companionEffects.splice(0, companionEffects.length - 30); }
    });

    // Idle Clicker: Player death event
    server.on('playerDeath', function(data) {
        console.log('Player died');
        // The spawn/despawn events will handle entity updates
    });

    // Idle Clicker: Player stats update
    server.on('playerStatsUpdate', function(data) {
        console.log('Received playerStatsUpdate:', data);
        var player = entities[data.playerId];
        if (player) {
            if (data.gold !== undefined) player.gold = data.gold;
            if (data.skillPoints !== undefined) player.skillPoints = data.skillPoints;
            if (data.skillTree !== undefined) player.skillTree = data.skillTree;
            if (data.maxHealth !== undefined) player.maxHealth = data.maxHealth;
            if (data.attackPower !== undefined) player.attackPower = data.attackPower;
            if (data.currentMonsterLevel !== undefined) player.currentMonsterLevel = data.currentMonsterLevel;
            // NOTE: companions are authoritative in the per-tick 'gameUpdates' wire packet
            // (compressor.sendEntityUpdates sends the full companions array). Do NOT merge
            // the stat-update's count map here — that would corrupt player.companions from
            // an array of objects into a plain object, breaking .length and cost scaling.
            // The tick update is the single source of truth for companions.
        }
    });

    // Idle Clicker: Purchase result
    server.on('purchaseResult', function(result) {
        if (!window.purchaseCallback) return;
        window.purchaseCallback(result);
        window.purchaseCallback = null;
    });

    // Idle Clicker: Upgrade result
    server.on('upgradeResult', function(result) {
        if (!window.upgradeCallback) return;
        window.upgradeCallback(result);
        window.upgradeCallback = null;
    });
}

// --- Decoders ----------------------------------------------------------------

// Mirrors compressor.entitySpawnPacket:
//   Standard: [ type, id, x, y, color, radius ]
//   Monster: [ 'monster', id, x, y, color, radius, health, maxHealth, ownerId, level ]
//   Idle Player: [ 'player', id, x, y, color, radius, health, maxHealth, gold, tier, attackPower, skillPoints, monstersDefeated, currentMonsterLevel, companions, avatarUrl ]
function createEntity(a) {
    var id = a[1];
    var entity = {
        type: a[0],
        id: id,
        x: a[2], y: a[3],
        tx: a[2], ty: a[3],   // interpolation target (remotes)
        velX: 0, velY: 0,
        color: a[4],
        radius: a[5]
    };
    
    // Extended data for monsters
    if (a[0] === 'monster' && a.length > 6) {
        entity.health = a[6];
        entity.maxHealth = a[7];
        entity.ownerId = a[8];
        entity.level = a[9] || 1;
    }
    
    // Extended data for idle clicker players
    if (a[0] === 'player' && a.length > 6) {
        entity.health = a[6];
        entity.maxHealth = a[7];
        entity.gold = a[8];
        entity.tier = a[9];
        entity.attackPower = a[10];
        entity.skillPoints = a[11];
        entity.monstersDefeated = a[12] || 0;
        entity.currentMonsterLevel = a[13] || 1;
        entity.companions = a[14] || [];
        entity.avatarUrl = a[15] || null;
        entity.companionsCount = entity.companions.length;
        entity.skillTree = {}; // Initialize empty skillTree object
        entity.kills = entity.kills || 0;
        entity.deaths = entity.deaths || 0;
        entity.isDead = false;
        entity.respawnFadeUntil = 0;
        entity.lastDamageAt = 0;
    }
    
    entities[id] = entity;
}

// Mirrors compressor.entitiesSpawn: JSON array of spawn records.
function spawnEntities(packet) {
    if (packet == null) { return; }
    var arr = JSON.parse(packet);
    for (var i = 0; i < arr.length; i++) {
        if (entities[arr[i][1]] == null) { createEntity(arr[i]); }
    }
}

// Mirrors compressor.appendEntity: a single JSON spawn record.
function appendEntity(packet) {
    if (packet == null) { return; }
    var a = JSON.parse(packet);
    if (entities[a[1]] == null) { createEntity(a); }
}

// Mirrors compressor.sendEntityUpdates: [ id, x, y, velX, velY, inputAck ] per entity.
// Extended formats for idle clicker:
//   monster: [ 'monster', id, x, y, health, maxHealth, level ]
//   idleplayer: [ 'idleplayer', id, x, y, velX, velY, inputAck, health, maxHealth, gold, attackPower, skillPoints, monstersDefeated, currentMonsterLevel ]
// The local player feeds reconciliation; remotes feed interpolation.
function updateEntities(packet) {
    if (packet == null) { return; }
    for (var i = 0; i < packet.length; i++) {
        var row = packet[i];
        
        // Check for extended formats (idle clicker)
        if (row[0] === 'monster') {
            // Monster format: [ 'monster', id, x, y, health, maxHealth, level ]
            var e = entities[row[1]];
            if (e == null) { continue; }
            e.tx = row[2];
            e.ty = row[3];
            e.health = row[4];
            e.maxHealth = row[5];
            e.level = row[6] || 1;
        } else if (row[0] === 'idleplayer') {
            // Idle player format: [ 'idleplayer', id, x, y, velX, velY, inputAck, health, maxHealth, gold, attackPower, skillPoints, monstersDefeated, currentMonsterLevel, companions, pvpKills, pvpDeaths ]
            var e = entities[row[1]];
            if (e == null) { continue; }
            if (row[1] === myID) {
                if (predicted != null) {
                    predictReconcile(row[2], row[3], row[4], row[5], row[6], FIXED_DT_S);
                }
            } else {
                e.tx = row[2];
                e.ty = row[3];
                e.velX = row[4];
                e.velY = row[5];
            }
            e.health = row[7];
            e.maxHealth = row[8];
            e.gold = row[9];
            e.attackPower = row[10];
            e.skillPoints = row[11];
            e.monstersDefeated = row[12] || 0;
            e.currentMonsterLevel = row[13] || 1;
            e.companions = row[14] || [];
            e.companionsCount = e.companions.length;
            e.kills  = row[15] || 0;
            e.deaths = row[16] || 0;
        } else if (row[0] === 'pvpplayer') {
            // PvP player format: [ 'pvpplayer', id, x, y, velX, velY, inputAck, health, maxHealth, attackPower, kills, deaths ]
            var e = entities[row[1]];
            if (e == null) { continue; }
            if (row[1] === myID) {
                if (predicted != null) {
                    predictReconcile(row[2], row[3], row[4], row[5], row[6], FIXED_DT_S);
                }
            } else {
                e.tx = row[2];
                e.ty = row[3];
                e.velX = row[4];
                e.velY = row[5];
            }
            e.health = row[7];
            e.maxHealth = row[8];
            e.attackPower = row[9];
            e.kills = row[10];
            e.deaths = row[11];
        } else {
            // Standard format: [ id, x, y, velX, velY, inputAck ]
            var e = entities[row[0]];
            if (e == null) { continue; }
            if (row[0] === myID) {
                if (predicted != null) {
                    predictReconcile(row[1], row[2], row[3], row[4], row[5], FIXED_DT_S);
                }
            } else {
                e.tx = row[1];
                e.ty = row[2];
                e.velX = row[3];
                e.velY = row[4];
            }
        }
    }
}

// Mirrors compressor.worldResize: [ x, y, width, height ]
function worldResize(packet) {
    var a = JSON.parse(packet);
    world = { x: a[0], y: a[1], width: a[2], height: a[3] };
}

// Mirrors compressor.obstacles: rows tagged 'c' (circle) or 'b' (box).
//   [ 'c', x, y, radius, color ]   |   [ 'b', x, y, width, height, color ]
function decodeObstacles(packet) {
    obstacles = [];
    if (packet == null) { return; }
    var arr = JSON.parse(packet);
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (o[0] === 'c') {
            obstacles.push({ shape: 'circle', x: o[1], y: o[2], radius: o[3], color: o[4] });
        } else if (o[0] === 'b') {
            obstacles.push({ shape: 'box', x: o[1], y: o[2], w: o[3], h: o[4], color: o[5] });
        }
    }
}

// Mirrors compressor.gameState: [ currentState ]
function checkGameState(packet) {
    if (packet == null) { return; }
    currentState = JSON.parse(packet)[0];
}


// --- Idle Clicker helper functions ------------------------------------------

// Send player click
function sendPlayerClick() {
    console.log('sendPlayerClick called, client.socket:', client.socket);
    if (client && client.socket && client.socket.connected) {
        console.log('Emitting playerClick event');
        client.socket.emit('playerClick');
    } else {
        console.error('Cannot send click: socket not connected');
    }
}

// Send companion purchase request
function purchaseCompanion(companionType, callback) {
    if (typeof combatEvents === 'undefined') {
        window.combatEvents = [];
    }
    if (!window.purchaseCallback) {
        window.purchaseCallback = null;
    }
    window.purchaseCallback = callback;
    if (server) {
        server.emit('purchaseCompanion', {companionType: companionType});
    }
}

// Send skill upgrade request
function upgradeSkill(skillId, callback) {
    if (!window.upgradeCallback) {
        window.upgradeCallback = null;
    }
    window.upgradeCallback = callback;
    if (server) {
        server.emit('upgradeSkill', {skillId: skillId});
    }
}

// Expose client API for HTML
window.client = {
    sendPlayerClick: sendPlayerClick,
    purchaseCompanion: purchaseCompanion,
    upgradeSkill: upgradeSkill
};

var client = window.client;

function resetPvPClientState() {
    if (!pvpEffects) { return; }
    pvpEffects.damageNumbers = [];
    pvpEffects.killFeed = [];
    pvpEffects.errorMessage = null;
    pvpEffects.errorExpiresAt = 0;
    pvpEffects.attackCooldownUntil = 0;
    pvpEffects.attackFlashUntil = 0;
    pvpEffects.hoveredTargetId = null;
    pvpEffects.hoveredWorldX = 0;
    pvpEffects.hoveredWorldY = 0;
    pvpEffects.deathOverlay.active = false;
    pvpEffects.deathOverlay.killerId = null;
    pvpEffects.deathOverlay.respawnTime = 0;
}

function pushDamageNumber(targetId, damage) {
    var target = entities[targetId];
    if (!target || !pvpEffects) { return; }
    pvpEffects.damageNumbers.push({
        x: target.x,
        y: target.y - (target.radius || 20),
        damage: damage,
        createdAt: Date.now(),
        lifetime: 1000
    });
    if (pvpEffects.damageNumbers.length > 20) {
        pvpEffects.damageNumbers.shift();
    }
}

function pushKillFeed(killerId, victimId) {
    if (!pvpEffects) { return; }
    pvpEffects.killFeed.push({
        killerId: killerId,
        victimId: victimId,
        createdAt: Date.now()
    });
    if (pvpEffects.killFeed.length > 6) {
        pvpEffects.killFeed.shift();
    }
}

function showPvPError(message) {
    if (!pvpEffects) { return; }
    pvpEffects.errorMessage = message;
    pvpEffects.errorExpiresAt = Date.now() + 2000;
}

function handlePvPCombat(data) {
    if (!data) { return; }
    var target = entities[data.targetId];
    if (target) {
        target.health = data.targetHealth;
        target.maxHealth = data.targetMaxHealth;
        target.lastDamageAt = Date.now();
    }
    pushDamageNumber(data.targetId, data.damage);
    if (data.attackerId === myID) {
        pvpEffects.attackCooldownUntil = Date.now() + 1000;
        pvpEffects.attackFlashUntil = Date.now() + 180;
    }
}

function handlePvPDeath(data) {
    if (!data) { return; }
    var victim = entities[data.victimId];
    var killer = entities[data.killerId];
    if (victim) {
        victim.isDead = true;
        victim.health = 0;
    }
    if (killer) {
        killer.kills = data.killerKills !== undefined ? data.killerKills : ((killer.kills || 0) + 1);
    }
    if (victim) {
        victim.deaths = data.victimDeaths !== undefined ? data.victimDeaths : ((victim.deaths || 0) + 1);
    }
    pushKillFeed(data.killerId, data.victimId);
    if (data.victimId === myID) {
        pvpEffects.deathOverlay.active = true;
        pvpEffects.deathOverlay.killerId = data.killerId;
        pvpEffects.deathOverlay.respawnTime = data.respawnTime || (Date.now() + 5000);
    }
}

function handlePvPRespawn(data) {
    if (!data) { return; }
    var player = entities[data.playerId];
    if (!player) { return; }
    player.x = data.x;
    player.y = data.y;
    player.tx = data.x;
    player.ty = data.y;
    player.health = data.health;
    player.isDead = false;
    player.respawnFadeUntil = Date.now() + 800;
    if (data.playerId === myID) {
        if (predicted != null) {
            predictionInit(data.x, data.y);
        }
        pvpEffects.deathOverlay.active = false;
        pvpEffects.deathOverlay.killerId = null;
        pvpEffects.deathOverlay.respawnTime = 0;
    }
}

function handlePvPAttackError(data) {
    var message = (data && data.error) ? data.error : 'Attack failed';
    showPvPError(message);
}

function handleSwitchRoomError(data) {
    var message = (data && data.error) ? data.error : 'Room switch failed';
    showPvPError(message);
}
