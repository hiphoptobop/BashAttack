// Keyboard input -> held movement flags.
//
// Unlike the first skeleton, input is NOT emitted here. The prediction loop
// (game.js) samples these held flags every fixed step, applies them locally for
// instant response, stamps a sequence number, and sends that to the server. This
// keeps prediction and the network packet perfectly in step (one input per
// predicted step, each with its own seq for reconciliation).

window.addEventListener('keydown', onKey(true), false);
window.addEventListener('keyup', onKey(false), false);
gameCanvas.addEventListener('click',      onCanvasClick,  false);
gameCanvas.addEventListener('mousemove',  onCanvasMove,   false);
gameCanvas.addEventListener('mouseleave', onCanvasLeave,  false);
// Touch attack — fires on touchend so it doesn't conflict with the joystick's
// touchstart and doesn't block scrolling. Uses a wider hit radius than mouse
// because a finger tap is far less precise than a cursor click.
gameCanvas.addEventListener('touchend', onCanvasTouchEnd, { passive: true });

function keyToAction(e) {
    switch (e.code) {
        case 'KeyW': case 'ArrowUp': return 'moveForward';
        case 'KeyS': case 'ArrowDown': return 'moveBackward';
        case 'KeyA': case 'ArrowLeft': return 'turnLeft';
        case 'KeyD': case 'ArrowRight': return 'turnRight';
        default: return null;
    }
}

function onKey(pressed) {
    return function (e) {
        var action = keyToAction(e);
        if (action == null) { return; }
        e.preventDefault(); // stop arrow keys scrolling the page
        switch (action) {
            case 'moveForward': moveForward = pressed; break;
            case 'moveBackward': moveBackward = pressed; break;
            case 'turnLeft': turnLeft = pressed; break;
            case 'turnRight': turnRight = pressed; break;
        }
    };
}

function screenToWorld(screenX, screenY) {
    return {
        x: (screenX - camera.viewW / 2) / camera.zoom + camera.cx,
        y: (screenY - camera.viewH / 2) / camera.zoom + camera.cy
    };
}

function getNearestAttackablePlayer(worldX, worldY, clickRadius) {
    var nearest = null;
    var nearestDistSq = clickRadius * clickRadius;
    for (var id in entities) {
        if (id === myID) { continue; }
        var entity = entities[id];
        if (!entity || entity.type !== 'player' || entity.isDead) { continue; }
        var dx = entity.x - worldX;
        var dy = entity.y - worldY;
        var distSq = dx * dx + dy * dy;
        if (distSq <= nearestDistSq) {
            nearest = entity;
            nearestDistSq = distSq;
        }
    }
    return nearest;
}

function onCanvasClick(e) {
    if (!server || !myID) { return; }
    var rect = gameCanvas.getBoundingClientRect();
    var clickX = e.clientX - rect.left;
    var clickY = e.clientY - rect.top;
    var worldPos = screenToWorld(clickX, clickY);
    var target = getNearestAttackablePlayer(worldPos.x, worldPos.y, 50);
    if (!target) { return; }
    pvpEffects.attackFlashUntil = Date.now() + 120;
    server.emit('pvpAttack', {
        targetId: target.id,
        clickX: Math.round(worldPos.x),
        clickY: Math.round(worldPos.y)
    });
}

function onCanvasMove(e) {
    var rect = gameCanvas.getBoundingClientRect();
    var hoverX = e.clientX - rect.left;
    var hoverY = e.clientY - rect.top;
    var worldPos = screenToWorld(hoverX, hoverY);
    var target = getNearestAttackablePlayer(worldPos.x, worldPos.y, 50);
    pvpEffects.hoveredWorldX = worldPos.x;
    pvpEffects.hoveredWorldY = worldPos.y;
    pvpEffects.hoveredTargetId = target ? target.id : null;
}

function onCanvasLeave() {
    pvpEffects.hoveredTargetId = null;
}

function onCanvasTouchEnd(e) {
    if (!server || !myID) { return; }
    // Use the first changed touch (the finger that just lifted).
    var touch = e.changedTouches && e.changedTouches[0];
    if (!touch) { return; }
    var rect = gameCanvas.getBoundingClientRect();
    var touchX = touch.clientX - rect.left;
    var touchY = touch.clientY - rect.top;
    var worldPos = screenToWorld(touchX, touchY);
    // Wider radius than mouse (120 vs 50) — fingers are imprecise.
    var target = getNearestAttackablePlayer(worldPos.x, worldPos.y, 120);
    if (!target) { return; }
    pvpEffects.attackFlashUntil = Date.now() + 120;
    server.emit('pvpAttack', {
        targetId: target.id,
        clickX: Math.round(worldPos.x),
        clickY: Math.round(worldPos.y)
    });
}

// Be a good citizen: tell the server we're leaving so the room frees our slot
// promptly (the socket 'disconnect' is the real teardown, but this is instant).
window.addEventListener('beforeunload', function () {
    if (server != null) { server.emit('playerLeaveRoom'); }
});
