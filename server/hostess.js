'use strict';
// Hostess — chaochao's hostess.js, the room registry / matchmaker. Trimmed of the
// preview/co-op rooms, late-join locking, AI-count bookkeeping, and the rich room
// listing the join page needed. What's left is the core: keep a map of live rooms,
// hand a joining client an existing room with space (or spin up a new one), tick
// every room each server frame, and reclaim a room once it empties.
//
// Extended to support multiple room types (pve, pvp) and room switching while
// preserving player stats.

var utils = require('./utils.js');
var c = utils.loadConfig();
var game = require('./game.js');
var messenger = require('./messenger.js');

// Object.create(null): a prototype-less map so a client-influenced signature can
// never resolve to an inherited property (e.g. "__proto__"/"constructor"). The
// sig is also validated to a 0–999 integer in messenger before it reaches here —
// belt and braces.
var roomList = Object.create(null),
    maxPlayersInRoom = c.maxPlayersInRoom;

// Find a room with free space, creating one if none exists / none is free.
// For PvP rooms, an optional tier is used to match players of similar level.
// Returns the room's signature (its key in roomList).
exports.findARoom = function (roomType, tier) {
    roomType = roomType || 'pve';
    for (var sig in roomList) {
        var room = roomList[sig];
        if (room.roomType !== roomType || !room.hasSpace()) { continue; }
        // For PvP, only match rooms of the same tier.
        if (roomType === 'pvp' && tier !== undefined && room.pvpTier !== tier) { continue; }
        return sig;
    }
    return generateNewRoom(roomType, tier);
};

// Place a client into the room with the given signature. Returns the room, or
// false if it's gone / full.
exports.joinARoom = function (sig, clientID) {
    var room = roomList[sig];
    if (room == null) {
        return false;
    }
    if (!room.hasSpace()) {
        return false;
    }
    room.join(clientID);
    return room;
};

// Remove a client from whatever room holds it; delete the room once it's empty.
exports.kickFromRoom = function (clientID) {
    var room = searchForRoom(clientID);
    if (room != undefined) {
        room.leave(clientID);
        if (room.clientCount == 0) {
            console.log('Deleting empty room ' + room.sig);
            delete roomList[room.sig];
        }
    }
};

// Tick every live room once per server frame (called from index.js's loop).
exports.updateRooms = function (dt) {
    for (var sig in roomList) {
        var room = roomList[sig];
        if (room == null) {
            delete roomList[sig];
            continue;
        }
        room.update(dt);
    }
};

exports.getRoomBySig = function (sig) {
    return roomList[sig];
};

function searchForRoom(id) {
    for (var sig in roomList) {
        if (roomList[sig].checkRoom(id)) {
            return roomList[sig];
        }
    }
    return undefined;
}

// Switch a player from their current room to a different room type.
// Preserves player stats during the transfer.
// Returns the new room signature, or false on error.
exports.switchPlayerRoom = function (clientID, targetRoomType) {
    // Validate room type
    if (targetRoomType !== 'pve' && targetRoomType !== 'pvp') {
        console.log('Invalid room type requested: ' + targetRoomType);
        return false;
    }

    // Find the player's current room
    var currentRoom = searchForRoom(clientID);
    if (currentRoom == undefined) {
        console.log('Player not found in any room: ' + clientID);
        return false;
    }

    // Don't switch if already in the target room type
    if (currentRoom.roomType === targetRoomType) {
        console.log('Player already in ' + targetRoomType + ' room');
        return currentRoom.sig;
    }

    // Extract the player entity (preserving all stats)
    var player = currentRoom.playerList[clientID];
    if (player == null) {
        console.log('Player entity not found: ' + clientID);
        return false;
    }

    console.log('Switching player ' + clientID + ' from ' + currentRoom.roomType + ' to ' + targetRoomType);

    // Compute the PvP tier from the player's current monster level (every 10 levels).
    // tier 1 = levels 1-10, tier 2 = 11-20, etc.
    var pvpTier = (targetRoomType === 'pvp')
        ? Math.max(1, Math.ceil((player.currentMonsterLevel || 1) / 10))
        : undefined;

    // ── Stat isolation ───────────────────────────────────────────────────────
    // PvP is a completely independent game mode. When entering PvP, snapshot all
    // idle-clicker progression so it can be restored on return, then wipe the
    // player down to PvP-fresh defaults. On the way back to PvE, restore the
    // snapshot so idle progress is never lost.
    if (targetRoomType === 'pvp') {
        // Snapshot what needs to be restored on return: companions and idle combat
        // references. Also save the current idle health so it is not overwritten
        // by PvP combat when the player returns to PvE.
        player._idleSnapshot = {
            companions:          player.companions,
            currentMonsterId:    player.currentMonsterId,
            isInCombat:          player.isInCombat,
            health:              player.health
        };

        // Strip companions (they don't exist in the PvP arena).
        player.companions          = [];
        player.currentMonsterId    = null;
        player.isInCombat          = false;
        // Restore accumulated PvP totals (carried across sessions via _pvpKills/_pvpDeaths).
        // Only reset on very first entry (no saved totals yet).
        player.pvpKills            = player._pvpKills  || 0;
        player.pvpDeaths           = player._pvpDeaths || 0;
        player.isDead              = false;
        player.respawnTime         = null;
        player.lastAttackTime      = 0;

        // First entry: start at full health. Returning from PvE: restore the
        // PvP health that was saved when the player last left the arena.
        if (player._pvpHealth !== undefined) {
            player.health = player._pvpHealth;
            player._pvpHealth = undefined;
            console.log('Entering PvP: restored previous arena health (' + player.health + '/' + player.maxHealth + ') for player ' + clientID);
        } else {
            player.health = player.maxHealth;
            console.log('Entering PvP: set full health (' + player.health + '/' + player.maxHealth + ') for player ' + clientID);
        }

    } else if (targetRoomType === 'pve' && player._idleSnapshot) {
        // Save PvP health and cumulative K/D so they survive the round-trip to PvE.
        player._pvpHealth  = player.health;
        player._pvpKills   = player.pvpKills;
        player._pvpDeaths  = player.pvpDeaths;

        // Restore what was stripped: companions, combat references, and idle health.
        var snap = player._idleSnapshot;
        player.companions          = snap.companions;
        player.health              = snap.health;
        player.currentMonsterId    = null;  // monster will be respawned by onPlayerJoin
        player.isInCombat          = false;
        player._idleSnapshot       = null;
        console.log('Returning to PvE: restored companions and idle health (' + player.health + '/' + player.maxHealth + ') for player ' + clientID);
    }
    // ────────────────────────────────────────────────────────────────────────

    // Remove the player fully from the current room. Use room.leave() so all
    // cleanup (mail box, socket.io room membership, entity unregister) is consistent.
    // We only need the stat snapshot above; the entity itself is discarded here and
    // will be re-created by the new socket's enterGame call.
    currentRoom.game.mode.onPlayerLeave(currentRoom.game, clientID);
    currentRoom.game.unregisterEntity(clientID);
    messenger.messageRoomBySig(currentRoom.sig, 'entityDespawn', clientID);
    delete currentRoom.clientList[clientID];
    delete currentRoom.playerList[clientID];
    currentRoom.clientCount--;
    if (currentRoom.clientCount <= 0) {
        console.log('Deleting empty room ' + currentRoom.sig);
        delete roomList[currentRoom.sig];
    }

    // Find or create a room of the target type (tier-matched for PvP) and return its sig.
    // The actual player entity will be spawned there by the new socket's enterGame,
    // which reads the stat transfer parked by messenger.switchRoom.
    var targetSig = exports.findARoom(targetRoomType, pvpTier);
    if (roomList[targetSig] == null) {
        console.log('Failed to find/create target room');
        return false;
    }

    console.log('Ready for transfer: player ' + clientID + ' → room ' + targetSig + ' (' + targetRoomType + ')');
    return targetSig;
};

function generateRoomSig(roomType) {
    var sig = utils.getRandomInt(0, 999);
    var fullSig = roomType + '-' + sig;
    if (roomList[fullSig] == null) {
        return fullSig;
    }
    return generateRoomSig(roomType);
}

function generateNewRoom(roomType, tier) {
    roomType = roomType || 'pve';
    var sig = generateRoomSig(roomType);
    var newRoom = game.getRoom(sig, maxPlayersInRoom, roomType, tier);
    roomList[sig] = newRoom;
    console.log('Started a new ' + roomType + ' room ' + sig +
        (tier !== undefined ? ' (tier ' + tier + ')' : ''));
    return sig;
}
