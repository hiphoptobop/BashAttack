'use strict';
// Messenger — the socket boundary. Inbound socket events are wired here; outbound
// room/client messages go through here. Handlers:
//   getConfig    — ship the shared config (single source of truth) to the client.
//   enterGame    — matchmake into a room and spawn the client's player; reply with
//                  the full join snapshot (entities, obstacles, world, config).
//   movement     — record the client's held input + sequence number on its player.
//   playerLeaveRoom / disconnect — tear the client out of its room.
//
// All client-supplied values are treated as untrusted: the room id is validated to
// a numeric signature, and input is range/sequence-checked.

var utils = require('./utils.js');
var c = utils.loadConfig();
var hostess = require('./hostess.js');
var compressor = require('./compressor.js');

var mailBoxList = Object.create(null),   // clientId -> socket
    roomMailList = Object.create(null),  // clientId -> roomSig
    // Pending stat transfers: roomSig -> { stats, expiresAt }
    // Written by switchRoom after the player entity is removed from the old room.
    // Read once by the next enterGame call with that roomSig, then deleted.
    pendingTransfers = Object.create(null),
    io;

exports.build = function (mainIO) {
    io = mainIO;
};

exports.addMailBox = function (id, client) {
    mailBoxList[id] = client;
    checkForMail(mailBoxList[id]);
};
exports.removeMailBox = function (id) {
    delete mailBoxList[id];
};
exports.addRoomToMailBox = function (id, roomSig) {
    roomMailList[id] = roomSig;
};
exports.removeRoomMailBox = function (id) {
    delete roomMailList[id];
};
exports.getClient = function (id) {
    return mailBoxList[id];
};
exports.getRoomSigByClientId = function (id) {
    return roomMailList[id];
};
exports.messageRoomBySig = function (sig, header, payload) {
    io.to(String(sig)).emit(header, payload);
};
exports.messageClientBySig = function (sig, header, payload) {
    if (mailBoxList[sig] != null) {
        mailBoxList[sig].emit(header, payload);
    }
};

// Send the full game state to a client (used for room switching and initial join)
exports.sendGameState = function (clientId, game) {
    var client = mailBoxList[clientId];
    if (client == null) {
        return;
    }
    var roomSig = roomMailList[clientId];
    if (roomSig == null) {
        return;
    }
    var room = hostess.getRoomBySig(roomSig);
    if (room == null) {
        return;
    }
    
    client.emit('gameState', {
        protocolVersion: c.protocolVersion,
        entityList: compressor.entitiesSpawn(game.entities),
        obstacles: compressor.obstacles(room.world.obstacles),
        world: compressor.worldResize(room.world),
        game: compressor.gameState(game),
        tick: game.tick,
        config: c,
        myID: clientId,
        gameID: roomSig
    });
};

// Validate the client-supplied room id.
// Accepts: -1 (matchmake), plain integer sigs (0-999), or prefixed string sigs
// like "pvp-123" / "pve-456" produced by hostess.generateRoomSig.
// Anything else is rejected so the server never indexes roomList with an unsafe value.
function parseRoomId(raw) {
    if (raw === -1 || raw === '-1') {
        return -1;
    }
    // Accept prefixed string sigs: "<word>-<0-999>"
    if (typeof raw === 'string' && /^[a-z]+-\d{1,3}$/.test(raw)) {
        return raw;
    }
    var n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 999) {
        return null;
    }
    return n;
}

function checkForMail(client) {
    client.emit('welcome', client.id);

    client.on('getConfig', function () {
        client.emit('config', c);
    });

    client.on('enterGame', async function (id) {
        var roomId = parseRoomId(id);
        if (roomId === null) {
            client.emit('roomNotFound');
            return;
        }
        var roomSig = (roomId === -1) ? hostess.findARoom() : roomId;

        var room = hostess.joinARoom(roomSig, client.id);
        if (room === false) {
            client.emit('roomNotFound');
            return;
        }
        room.clientList[client.id] = client.id;
        // Signal to onPlayerJoin that a transfer is pending — monster spawn must be
        // deferred until after the correct stats (especially currentMonsterLevel) are applied.
        var hasPendingTransfer = !!(pendingTransfers[String(roomSig)] &&
            Date.now() < pendingTransfers[String(roomSig)].expiresAt);
        if (hasPendingTransfer) { room.game._pendingTransferForClient = client.id; }

        var player = await room.spawnPlayer(client.id);

        // If a stat transfer was parked for this room sig (from a switchRoom on the
        // previous socket), apply those stats onto the freshly spawned player now.
        // This is the correct way to carry progress across a page navigation because
        // the new socket has a different client.id and can never match the old one.
        var transfer = pendingTransfers[String(roomSig)];
        if (transfer && Date.now() < transfer.expiresAt) {
            var s = transfer.stats;
            player.health              = s.health;
            player.maxHealth           = s.maxHealth;
            player.attackPower         = s.attackPower;
            player.gold                = s.gold;
            player.skillPoints         = s.skillPoints;
            player.monstersDefeated    = s.monstersDefeated;
            player.currentMonsterLevel = s.currentMonsterLevel;
            player.companions          = s.companions;
            player.skillTree           = s.skillTree;
            player.pvpKills            = s.pvpKills  || 0;
            player.pvpDeaths           = s.pvpDeaths || 0;
            // _idleSnapshot carries the idle progress saved before a PvP session
            if (s._idleSnapshot) { player._idleSnapshot = s._idleSnapshot; }
            console.log('Applied pending transfer to new socket ' + client.id +
                ' (room ' + roomSig + ', hp ' + player.health + '/' + player.maxHealth + ')');

            // Now that correct stats are in place, spawn the monster at the right level.
            room.game._pendingTransferForClient = null;
            if (room.game.mode && room.game.mode.spawnMonsterForPlayer) {
                room.game.mode.spawnMonsterForPlayer(room.game, player);
            }
        }
        delete pendingTransfers[String(roomSig)];

        // Join the socket.io room for broadcasting
        client.join(String(roomSig));
        
        // Update the room mail list mapping
        roomMailList[client.id] = roomSig;

        // Full join snapshot. protocolVersion lets the client refuse a mismatched
        // server; entities + obstacles + world + state rehydrate a (possibly
        // mid-game) joiner; config is the single source of truth.
        client.emit('gameState', {
            protocolVersion: c.protocolVersion,
            entityList: compressor.entitiesSpawn(room.game.entities),
            obstacles: compressor.obstacles(room.world.obstacles),
            world: compressor.worldResize(room.world),
            game: compressor.gameState(room.game),
            tick: room.game.tick,
            config: c,
            myID: client.id,
            gameID: roomSig
        });

        // Tell everyone already in the room about the newcomer.
        client.broadcast.to(String(roomSig)).emit('entitySpawn', compressor.appendEntity(player));
    });

    // The only gameplay input: one held-keys command per client fixed step, with a
    // monotonically increasing sequence number. The client is authoritative over
    // NOTHING — it reports intent; the engine decides the motion. Each command is
    // ENQUEUED on the player and consumed one-per-sub-step (Player.control), so the
    // server applies each input for the same single step the client predicted it
    // for. The consumed seq is echoed back each tick for reconciliation.
    client.on('movement', function (packet) {
        var room = hostess.getRoomBySig(roomMailList[client.id]);
        if (room === undefined || packet == null) {
            return;
        }
        var player = room.playerList[client.id];
        if (player == null) {
            return;
        }
        var seq = Number(packet.seq);
        if (!Number.isFinite(seq)) {
            return; // malformed
        }
        player.enqueueInput({
            seq: seq,
            moveForward: !!packet.moveForward,
            moveBackward: !!packet.moveBackward,
            turnLeft: !!packet.turnLeft,
            turnRight: !!packet.turnRight
        });
    });

    // Idle Clicker: Player click attack
    client.on('playerClick', function() {
        var room = hostess.getRoomBySig(roomMailList[client.id]);
        if (!room || !room.game || !room.game.mode) return;
        
        var player = room.playerList[client.id];
        if (!player) return;
        
        // Call the game mode's handlePlayerClick method
        var result = room.game.mode.handlePlayerClick(room.game, player);
        
        if (result && result.success !== false) {
            // Broadcast combat result to all clients in room
            for (var cid in room.clientList) {
                var clientSocket = mailBoxList[cid];
                if (clientSocket) {
                    clientSocket.emit('combatEvent', {
                        playerId: client.id,
                        monsterId: player.currentMonsterId,
                        type: 'playerClick',
                        damage: result.damage,
                        monsterHealth: result.monsterHealth
                    });
                }
            }

            client.emit('playerStatsUpdate', {
                playerId: client.id,
                gold: player.gold,
                skillPoints: player.skillPoints,
                currentMonsterLevel: player.currentMonsterLevel
            });
        }
    });

    // Idle Clicker: Purchase companion
    client.on('purchaseCompanion', function(data) {
        var room = hostess.getRoomBySig(roomMailList[client.id]);
        if (!room || !room.game || !room.game.mode) return;
        if (!data || !data.companionType) return;
        
        var player = room.playerList[client.id];
        if (!player) return;
        
        // Call the game mode's purchaseCompanion method
        var result = room.game.mode.purchaseCompanion(room.game, player, data.companionType);
        
        console.log('Purchase companion result:', JSON.stringify(result));
        
        // Send result back to requesting client
        client.emit('purchaseResult', result);
        
        if (result.success) {
            // Count companions by type
            var companionCounts = {};
            for (var i = 0; i < player.companions.length; i++) {
                var type = player.companions[i].type;
                companionCounts[type] = (companionCounts[type] || 0) + 1;
            }
            
            var statsUpdate = {
                playerId: client.id,
                gold: player.gold,
                companions: companionCounts
            };
            
            console.log('Emitting playerStatsUpdate:', JSON.stringify(statsUpdate));
            
            // Broadcast updated player stats to all clients in the room
            for (var cid in room.clientList) {
                var clientSocket = mailBoxList[cid];
                if (clientSocket) {
                    clientSocket.emit('playerStatsUpdate', statsUpdate);
                }
            }
        }
    });

    // Idle Clicker: Upgrade skill
    client.on('upgradeSkill', function(data) {
        var room = hostess.getRoomBySig(roomMailList[client.id]);
        if (!room || !room.game || !room.game.mode) return;
        if (!data || !data.skillId) return;
        
        var player = room.playerList[client.id];
        if (!player) return;
        
        // Call the game mode's upgradeSkill method
        var result = room.game.mode.upgradeSkill(room.game, player, data.skillId);
        
        console.log('Upgrade skill result:', JSON.stringify(result));
        
        // Send result back to requesting client
        client.emit('upgradeResult', result);
        
        if (result.success) {
            var statsUpdate = {
                playerId: client.id,
                skillPoints: player.skillPoints,
                skillTree: player.skillTree,
                maxHealth: player.maxHealth,
                attackPower: player.attackPower
            };
            
            console.log('Emitting playerStatsUpdate:', JSON.stringify(statsUpdate));
            
            // Broadcast updated player stats to all clients in the room
            for (var cid in room.clientList) {
                var clientSocket = mailBoxList[cid];
                if (clientSocket) {
                    clientSocket.emit('playerStatsUpdate', statsUpdate);
                }
            }
        }
    });

    // PvP: Player attack
    client.on('pvpAttack', function(data) {
        var room = hostess.getRoomBySig(roomMailList[client.id]);
        if (!room || !room.game || !room.game.mode) {
            client.emit('pvpAttackError', { error: 'Room not found' });
            return;
        }
        
        // Validate this is a PvP room using roomType property
        if (room.roomType !== 'pvp') {
            console.log('Player ' + client.id + ' attempted attack in non-PvP room (roomType: ' + room.roomType + ')');
            client.emit('pvpAttackError', { error: 'Not in PvP arena' });
            return;
        }
        
        var player = room.playerList[client.id];
        if (!player) {
            client.emit('pvpAttackError', { error: 'Player not found' });
            return;
        }
        
        if (!data || !data.targetId) {
            client.emit('pvpAttackError', { error: 'Invalid target' });
            return;
        }
        
        // Call the PvP mode's handleAttack method
        var result = room.game.mode.handleAttack(room.game, client.id, data.targetId);
        
        if (!result.success) {
            client.emit('pvpAttackError', { error: result.error });
        }
        // Success case is handled by the mode broadcasting pvpCombat/pvpDeath events
    });

    client.on('switchRoom', function (data) {
        if (!data || !data.targetRoomType) {
            client.emit('switchRoomError', { error: 'Invalid room type' });
            return;
        }

        var targetRoomType = data.targetRoomType;
        var oldRoomSig = roomMailList[client.id];

        // Grab the player's current stats BEFORE hostess removes them from the room.
        var oldRoom = hostess.getRoomBySig(oldRoomSig);
        var departingPlayer = oldRoom ? oldRoom.playerList[client.id] : null;

        var newRoomSig = hostess.switchPlayerRoom(client.id, targetRoomType);

        if (newRoomSig === false) {
            client.emit('switchRoomError', { error: 'Failed to switch rooms' });
            return;
        }

        var newRoom = hostess.getRoomBySig(newRoomSig);
        if (newRoom == null) {
            client.emit('switchRoomError', { error: 'Room not found after switch' });
            return;
        }

        // Park the player's post-switch stats so the new socket's enterGame can
        // pick them up. hostess.switchPlayerRoom has already applied the
        // snapshot/restore logic (PvP reset or idle restore), so the stats on
        // departingPlayer are already the correct target-room values.
        if (departingPlayer) {
            pendingTransfers[String(newRoomSig)] = {
                expiresAt: Date.now() + 15000,  // 15 s — plenty of time for page nav
                stats: {
                    health:              departingPlayer.health,
                    maxHealth:           departingPlayer.maxHealth,
                    attackPower:         departingPlayer.attackPower,
                    gold:                departingPlayer.gold,
                    skillPoints:         departingPlayer.skillPoints,
                    monstersDefeated:    departingPlayer.monstersDefeated,
                    currentMonsterLevel: departingPlayer.currentMonsterLevel,
                    companions:          departingPlayer.companions,
                    skillTree:           JSON.parse(JSON.stringify(departingPlayer.skillTree)),
                    pvpKills:            departingPlayer.pvpKills  || 0,
                    pvpDeaths:           departingPlayer.pvpDeaths || 0,
                    _idleSnapshot:       departingPlayer._idleSnapshot || null
                }
            };
            console.log('Parked transfer for room ' + newRoomSig +
                ' (hp ' + departingPlayer.health + '/' + departingPlayer.maxHealth + ')');
        }

        // The old socket is about to navigate away — remove it from its current
        // socket.io room so it stops receiving broadcasts from the old room.
        if (oldRoomSig) {
            client.leave(String(oldRoomSig));
        }

        // Send the gameState back on THIS socket so the client gets the roomSig
        // token to pass via sessionStorage, then navigates. The new socket will
        // call enterGame with that token and pick up the transfer above.
        client.emit('gameState', {
            protocolVersion: c.protocolVersion,
            entityList: compressor.entitiesSpawn(newRoom.game.entities),
            obstacles:  compressor.obstacles(newRoom.world.obstacles),
            world:      compressor.worldResize(newRoom.world),
            game:       compressor.gameState(newRoom.game),
            tick:       newRoom.game.tick,
            config:     c,
            myID:       client.id,
            gameID:     newRoomSig
        });

        console.log('Player ' + client.id + ' switched to ' + targetRoomType + ' room ' + newRoomSig);
    });

    client.on('playerLeaveRoom', function () {
        var roomSig = roomMailList[client.id];
        if (roomSig) {
            client.leave(String(roomSig));
        }
        hostess.kickFromRoom(client.id);
        exports.removeRoomMailBox(client.id);
    });
}
