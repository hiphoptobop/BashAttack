'use strict';
// World — the arena rectangle plus its static level geometry. It owns player
// creation/colours and a small default obstacle layout (a centre block and two
// bumpers) so every game starts with something to bounce off. Replace
// buildDefaultObstacles (or feed obstacles from a map file / the game mode) to
// build real levels — the engine treats `obstacles` as opaque static colliders.

var utils = require('../utils.js');
var c = utils.loadConfig();
var { Rect } = require('./shapes.js');
var { Player } = require('./player.js');
var { CircleObstacle, BoxObstacle } = require('./obstacles.js');

class World extends Rect {
    constructor(x, y, width, height, engine, playerList, roomSig) {
        super(x, y, width, height, 0, 'white');
        this.engine = engine;
        this.playerList = playerList;
        this.roomSig = roomSig;
        this.center = { x: width / 2, y: height / 2 };
        this.obstacles = [];
        this.buildDefaultObstacles();
    }
    buildDefaultObstacles() {
        // No obstacles for Idle Clicker mode
        // Obstacles array remains empty
    }
    createNewPlayer(id) {
        var color = this.getUniqueColorR();
        var player = new Player(0, 0, color, id, this.roomSig);
        this.spawnPlayerRandomLoc(player);
        return player;
    }
    spawnPlayerRandomLoc(entity) {
        // PvP needs clear spawns so players do not stack on top of each other or the
        // bot in the middle of the arena.
        if (String(this.roomSig).indexOf('pvp-') === 0) {
            var loc = this.getSafeLoc(c.playerBaseRadius * 2);
            entity.x = loc.x;
            entity.y = loc.y;
            entity.newX = loc.x;
            entity.newY = loc.y;
            return;
        }

        // Idle clicker: each player gets their own unique position so they don't
        // stack. Spread them in a row, 300px apart, centred around x=600.
        var playerCount = Object.keys(this.playerList).length;
        var spawnX = 600 + playerCount * 300;
        entity.x = spawnX;
        entity.y = 600;
        entity.newX = spawnX;
        entity.newY = 600;
    }
    // Return a random location at least `margin` pixels from the world edges.
    getSafeLoc(margin) {
        margin = margin || 40;
        return {
            x: margin + Math.random() * (this.width  - margin * 2),
            y: margin + Math.random() * (this.height - margin * 2)
        };
    }
    getUniqueColorR() {
        var usedColors = {};
        for (var id in this.playerList) {
            usedColors[this.playerList[id].color] = true;
        }
        return utils.getUniqueColor(usedColors);
    }
}

module.exports = { World };
