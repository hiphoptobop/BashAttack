// Minimal canvas renderer. Called once per render frame (game.js), AFTER the
// camera has been positioned. Everything is drawn in world coordinates mapped
// through worldToScreen, so the camera transform is the only thing that knows
// about pixels. Draw order: arena border, static obstacles, dynamic entities.

// Companion layout constants — shared by drawCompanions and drawCompanionEffects
// so portrait positions and attack-effect origins are always in sync.
var COMPANION_RADIUS  = 32;
var COMPANION_SPACING = COMPANION_RADIUS * 2 + 28;  // wider spread
var COMPANION_GAP     = 44;  // gap between player edge and nearest companion
var COMPANION_LEFT    = ['warrior', 'mage'];
var COMPANION_RIGHT   = ['archer', 'priest'];

function drawObjects() {
    var ctx = gameContext;
    if (!ctx) { return; }

    // Reset to device-pixel space and clear every frame.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, camera.viewW, camera.viewH);

    try {
        drawLevelBasedBackground(ctx);

        if (world != null) {
            drawWorldBorder(ctx);
        }
        // drawObstacles(ctx); // Removed for Idle Clicker - no obstacles needed
        drawEntities(ctx);

        // Idle Clicker specific rendering — draw only the local player's monster.
        // Each player owns exactly one monster (ownerId === their socket id); drawing
        // all monsters would stack foreign monsters on top of the local one.
        var localPlayerForMonster = entities[myID];
        if (localPlayerForMonster) {
            for (var id in entities) {
                var entity = entities[id];
                if (entity.type === 'monster' && entity.ownerId === myID) {
                    drawMonster(ctx, entity, camera);
                    break; // only one monster per player
                }
            }
        }

        // Draw player health bar — local player only (each player has their own
        // isolated idle-clicker session; remote players' bars would overlap).
        var localPlayerForHealth = entities[myID];
        if (localPlayerForHealth && localPlayerForHealth.health !== undefined) {
            drawPlayerHealth(ctx, localPlayerForHealth, camera);
        }

        // Draw companions for the local player only.
        if (localPlayerForHealth && hasVisibleCompanions(localPlayerForHealth)) {
            drawCompanions(ctx, localPlayerForHealth, camera);
        }

        drawSlashEffects(ctx);
        drawCompanionEffects(ctx);
        drawPvPEffects(ctx);

        // Draw UI for local player
        var localPlayer = entities[myID];
        if (localPlayer) {
            drawUI(ctx, localPlayer);
        }

        // Draw combat log (if combatEvents exists in global scope)
        if (typeof combatEvents !== 'undefined' && combatEvents) {
            drawCombatLog(ctx, combatEvents);
        }
    } catch (err) {
        console.error('drawObjects render failure:', err);

        // Guaranteed fallback so the canvas never stays visually blank.
        ctx.save();
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Render error - fallback active', camera.viewW / 2, 40);

        var me = entities && myID != null ? entities[myID] : null;
        if (me && me.x != null && me.y != null) {
            var s = worldToScreen(me.x, me.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, (me.radius || 20) * camera.zoom, 0, Math.PI * 2);
            ctx.fillStyle = me.color || '#4caf50';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawWorldBorder(ctx) {
    var tl = worldToScreen(world.x, world.y);
    ctx.strokeStyle = '#3a3a44';
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, world.width * camera.zoom, world.height * camera.zoom);
}

function drawObstacles(ctx) {
    for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        ctx.fillStyle = o.color;
        if (o.shape === 'circle') {
            var c = worldToScreen(o.x, o.y);
            ctx.beginPath();
            ctx.arc(c.x, c.y, o.radius * camera.zoom, 0, 2 * Math.PI);
            ctx.fill();
        } else if (o.shape === 'box') {
            var tl = worldToScreen(o.x, o.y);
            ctx.fillRect(tl.x, tl.y, o.w * camera.zoom, o.h * camera.zoom);
        }
    }
}

function getPlayerAvatarImage(entity) {
    if (!entity || !entity.avatarUrl) {
        return null;
    }
    if (!entity.avatarImage || entity.avatarImage.src !== entity.avatarUrl) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = entity.avatarUrl;
        entity.avatarImage = img;
    }
    if (entity.avatarImage.complete && entity.avatarImage.naturalWidth > 0) {
        return entity.avatarImage;
    }
    return null;
}

function drawEntities(ctx) {
    var now = Date.now();
    for (var id in entities) {
        var e = entities[id];
        if (e == null || e.x == null) { continue; }
        // Skip monsters - they're drawn separately with drawMonster()
        if (e.type === 'monster') { continue; }
        // In idle clicker each player has their own isolated instance — only draw
        // the local player so remote players don't stack on screen.
        // (PvP rooms need all players rendered; idle players have a `gold` field.)
        var localMe = entities[myID];
        if (id !== myID && localMe && localMe.gold !== undefined) { continue; }
        var s = worldToScreen(e.x, e.y);
        var r = (e.radius + 20) * camera.zoom;  // draw larger than the physics radius

        var alpha = 1;
        if (e.isDead) {
            alpha = 0.25;
        } else if (e.respawnFadeUntil && e.respawnFadeUntil > now) {
            alpha = 1 - ((e.respawnFadeUntil - now) / 800) * 0.5;
        }

        ctx.save();
        ctx.globalAlpha = alpha;

        // In PvP, authenticated Discord users can render with their Discord avatar.
        // Otherwise fall back to the shared player art, then to a plain colour fill.
        var avatarImg = getPlayerAvatarImage(e);
        var playerImg = avatarImg || (typeof gameImages !== 'undefined' &&
            gameImages && gameImages.characters && gameImages.characters['Player']);

        // Animated draw — sprites.js handles the breathe/hit-pop transforms.
        if (typeof drawAnimatedSprite !== 'undefined') {
            drawAnimatedSprite(ctx, 'player', s.x, s.y, r, playerImg, e.color, now);
        } else {
            // Fallback if sprites.js is not loaded.
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
            var imgReady = playerImg && playerImg.complete && playerImg.naturalWidth > 0;
            if (imgReady) {
                ctx.clip();
                ctx.drawImage(playerImg, s.x - r, s.y - r, r * 2, r * 2);
            } else {
                ctx.fillStyle = e.color;
                ctx.fill();
            }
        }

        // Ring the local player so it's easy to tell which one you drive.
        if (id === myID) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
        if (e.lastDamageAt && now - e.lastDamageAt < 150) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ff4d4d';
            ctx.stroke();
        }
        ctx.restore();
    }
}


// ============================================================================
// IDLE CLICKER RENDERING FUNCTIONS
// ============================================================================

// ============================================================================
// LEVEL-BASED THEMING SYSTEM
// ============================================================================
// This system provides dynamic backgrounds and monster appearances based on
// monster level ranges. Each range (1-10, 11-20, etc.) has unique theming.
//
// TO REPLACE WITH ACTUAL IMAGES:
// 1. For backgrounds: Replace drawLevelBasedBackground() gradient fills with
//    ctx.drawImage(backgroundImage, 0, 0, camera.viewW, camera.viewH)
// 2. For monsters: Replace drawMonster() circle drawing with
//    ctx.drawImage(monsterSprite, x, y, width, height)
// 3. Load images in game initialization and store in a themes object
// ============================================================================

/**
 * Determines the theme index for a given monster level.
 * Theme progression is anchored so level 30 uses the Desert theme as expected:
 * 1-20 Forest, 21-30 Desert, 31-40 Ocean, etc.
 * @param {number} level - The monster level
 * @returns {number} - The theme index (0-based)
 */
function getLevelRange(level) {
    if (!level || level < 1) return 0;
    // Each theme covers 10 levels: 1-10 → 0 (Forest), 11-20 → 1 (Desert), etc.
    return Math.floor((level - 1) / 10);
}

/**
 * Gets the theme configuration for a specific theme index.
 * Each theme includes background colors/gradients and monster styling.
 * @param {number} levelRange - The theme index (0-based)
 * @returns {object} - Theme configuration object
 */
function getThemeForLevelRange(levelRange) {
    var themes = [
        // Levels 1-10: Green Forest Theme
        {
            name: 'Forest',
            bgColor1: '#a8e6a1',      // Light green
            bgColor2: '#66bb6a',      // Medium green
            monsterColor: '#2e7d32',  // Dark green
            monsterSize: 90,
            monsterShape: 'circle'
        },
        // Levels 11-20: Desert Theme
        {
            name: 'Desert',
            bgColor1: '#ffe082',      // Light sandy yellow
            bgColor2: '#ffb74d',      // Orange sand
            monsterColor: '#8d6e63',  // Brown
            monsterSize: 95,
            monsterShape: 'circle'
        },
        // Levels 21-30: Ocean Theme
        {
            name: 'Ocean',
            bgColor1: '#81d4fa',      // Light blue
            bgColor2: '#0288d1',      // Deep blue
            monsterColor: '#00838f',  // Blue-teal
            monsterSize: 100,
            monsterShape: 'circle'
        },
        // Levels 31-40: Volcano Theme
        {
            name: 'Volcano',
            bgColor1: '#ff8a65',      // Light red-orange
            bgColor2: '#d84315',      // Dark red-orange
            monsterColor: '#b71c1c',  // Deep red
            monsterSize: 105,
            monsterShape: 'circle'
        },
        // Levels 41-50: Ice Theme
        {
            name: 'Ice',
            bgColor1: '#e1f5fe',      // Very light blue
            bgColor2: '#81d4fa',      // Light blue
            monsterColor: '#0277bd',  // Blue-white
            monsterSize: 110,
            monsterShape: 'circle'
        },
        // Levels 51-60: Shadow Theme
        {
            name: 'Shadow',
            bgColor1: '#757575',      // Gray
            bgColor2: '#424242',      // Dark gray
            monsterColor: '#212121',  // Very dark gray
            monsterSize: 115,
            monsterShape: 'circle'
        },
        // Levels 61-70: Crystal Theme
        {
            name: 'Crystal',
            bgColor1: '#e1bee7',      // Light purple
            bgColor2: '#9c27b0',      // Purple
            monsterColor: '#6a1b9a',  // Dark purple
            monsterSize: 120,
            monsterShape: 'circle'
        },
        // Levels 71-80: Toxic Theme
        {
            name: 'Toxic',
            bgColor1: '#c5e1a5',      // Light lime
            bgColor2: '#7cb342',      // Lime green
            monsterColor: '#558b2f',  // Dark lime
            monsterSize: 125,
            monsterShape: 'circle'
        },
        // Levels 81-90: Inferno Theme
        {
            name: 'Inferno',
            bgColor1: '#ffccbc',      // Light orange
            bgColor2: '#ff5722',      // Deep orange
            monsterColor: '#bf360c',  // Dark orange-red
            monsterSize: 130,
            monsterShape: 'circle'
        },
        // Levels 91-100: Void Theme
        {
            name: 'Void',
            bgColor1: '#311b92',      // Dark purple
            bgColor2: '#1a237e',      // Very dark blue
            monsterColor: '#000051',  // Almost black blue
            monsterSize: 135,
            monsterShape: 'circle'
        }
    ];
    
    // Return theme for the level range, or the last theme for levels beyond defined ranges
    if (levelRange < themes.length) {
        return themes[levelRange];
    }
    // For levels beyond 100, cycle through themes with increasing monster size
    var cycleIndex = levelRange % themes.length;
    var theme = Object.assign({}, themes[cycleIndex]);
    theme.monsterSize = 95 + (Math.floor(levelRange / themes.length) * 10);
    return theme;
}

/**
 * Draws a level-appropriate background using actual images or gradient fallback
 * @param {CanvasRenderingContext2D} ctx - The canvas context
 */
function drawLevelBasedBackground(ctx) {
    // Find the current monster to determine level
    var currentMonster = null;
    for (var id in entities) {
        if (entities[id].type === 'monster') {
            currentMonster = entities[id];
            break;
        }
    }

    // Default to level 1 if no monster found
    var level = currentMonster ? currentMonster.level : 1;
    var levelRange = getLevelRange(level);
    var theme = getThemeForLevelRange(levelRange);

    // Only draw images that are actually ready. Otherwise use gradient fallback.
    var hasImages = typeof gameImages !== 'undefined' &&
        gameImages &&
        gameImages.backgrounds &&
        gameImages.backgrounds[theme.name] &&
        gameImages.backgrounds[theme.name].complete &&
        gameImages.backgrounds[theme.name].naturalWidth > 0;

    if (hasImages) {
        var bgImage = gameImages.backgrounds[theme.name];
        ctx.drawImage(bgImage, 0, 0, camera.viewW, camera.viewH);
    } else {
        var gradient = ctx.createLinearGradient(0, 0, 0, camera.viewH);
        gradient.addColorStop(0, theme.bgColor1);
        gradient.addColorStop(1, theme.bgColor2);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
}

/**
 * Gets monster styling based on level
 * PLACEHOLDER: Returns color and size, can be extended for sprite selection
 * @param {number} level - The monster level
 * @returns {object} - Monster styling configuration
 */
function getMonsterStyleByLevel(level) {
    if (!level) level = 1;
    var levelRange = getLevelRange(level);
    var theme = getThemeForLevelRange(levelRange);
    
    return {
        color: theme.monsterColor,
        size: theme.monsterSize,
        shape: theme.monsterShape,
        theme: theme.name
    };
}

// Legacy function kept for compatibility - now uses new theming system
function getMonsterColorByLevel(level) {
    var style = getMonsterStyleByLevel(level);
    return style.color;
}

/**
 * Draw monster with health bar and level
 * Uses level-based theming for appearance with actual monster images
 * @param {CanvasRenderingContext2D} ctx - The canvas context
 * @param {object} monster - The monster entity
 * @param {object} camera - The camera object
 */
function drawMonster(ctx, monster, camera) {
    if (!monster) return;

    // Get the local player's position
    var localPlayer = entities[myID];
    if (!localPlayer) return;

    // Position monster directly above the player for idle clicker presentation
    var playerScreen = worldToScreen(localPlayer.x, localPlayer.y);
    var shakeOffsetX = 0;
    if (typeof monsterShake !== 'undefined' && Date.now() < monsterShake.until) {
        var t = (Date.now() - (monsterShake.until - 300)) / 300; // 0→1 over shake duration
        var decay = 1 - t;                                        // amplitude fades out
        shakeOffsetX = Math.sin(t * Math.PI * 8) * monsterShake.amplitude * decay;
    }
    var screenX = playerScreen.x + shakeOffsetX;
    var screenY = playerScreen.y - 310;

    // Get styling based on level (uses new theming system)
    var monsterStyle = getMonsterStyleByLevel(monster.level);

    // Use theme-based size
    var monsterRadius = monsterStyle.size * camera.zoom;
    var monsterSize = monsterRadius * 2;

    var hasMonsterImage = typeof gameImages !== 'undefined' &&
        gameImages &&
        gameImages.monsters &&
        gameImages.monsters[monsterStyle.theme] &&
        gameImages.monsters[monsterStyle.theme].complete &&
        gameImages.monsters[monsterStyle.theme].naturalWidth > 0;

    if (hasMonsterImage) {
        var monsterImage = gameImages.monsters[monsterStyle.theme];
        // Clip to a circle so the square background of the image is hidden.
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenX, screenY, monsterRadius, 0, Math.PI * 2);
        ctx.clip();
        // Draw the center ~70% of the image (crop edges which are mostly background).
        var srcSize = monsterImage.naturalWidth;
        var cropInset = Math.floor(srcSize * 0.03); // trim 3% per side
        ctx.drawImage(
            monsterImage,
            cropInset, cropInset,
            srcSize - cropInset * 2, srcSize - cropInset * 2,
            screenX - monsterRadius,
            screenY - monsterRadius,
            monsterSize,
            monsterSize
        );
        ctx.restore();
        // Thin bright ring to cleanly separate monster from background.
        ctx.beginPath();
        ctx.arc(screenX, screenY, monsterRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();
    } else {
        ctx.fillStyle = monsterStyle.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, monsterRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    var barWidth = 100;
    var barHeight = 12;
    var barX = playerScreen.x - barWidth / 2;  // anchored to player centre, no shake
    var barY = screenY - monsterRadius - 20;

    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    var healthPercent = monster.maxHealth ? (monster.health / monster.maxHealth) : 0;
    healthPercent = Math.max(0, Math.min(1, healthPercent));
    ctx.fillStyle = healthPercent > 0.5 ? '#0f0' : healthPercent > 0.25 ? '#ff0' : '#f00';
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

    ctx.strokeStyle = '#fff';
    ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// Draw player health bar
function drawPlayerHealth(ctx, player, camera) {
    if (!player) return;
    
    var s = worldToScreen(player.x, player.y);
    var screenX = s.x;
    var screenY = s.y;
    
    // Draw health bar below the player
    var barWidth = 60;
    var barHeight = 8;
    var barX = screenX - barWidth / 2;
    var barY = screenY + (player.radius || 20) * camera.zoom + 10;
    
    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Health
    var healthPercent = player.maxHealth ? (player.health / player.maxHealth) : 0;
    ctx.fillStyle = healthPercent > 0.5 ? '#0f0' : healthPercent > 0.25 ? '#ff0' : '#f00';
    ctx.fillRect(barX, barY, barWidth * Math.max(0, healthPercent), barHeight);
    
    // Border
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    
    // Health text showing "HP: current/max" below the health bar
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('HP: ' + Math.floor(player.health) + '/' + player.maxHealth, screenX, barY + barHeight + 12);
}

/**
 * Draw companions next to the player
 * Companions appear as colored circles with their type indicated
 * Left side: Warrior (green), Mage (blue)
 * Right side: Archer (yellow), Priest (white)
 * @param {CanvasRenderingContext2D} ctx - The canvas context
 * @param {object} player - The player entity with companions
 * @param {object} camera - The camera object
 */
function hasVisibleCompanions(player) {
    if (!player || !player.companions) { return false; }
    if (Array.isArray(player.companions)) {
        return player.companions.length > 0;
    }
    for (var type in player.companions) {
        if (player.companions[type] > 0) { return true; }
    }
    return false;
}

function drawCompanions(ctx, player, camera) {
    if (!hasVisibleCompanions(player)) return;

    var companionColors = {
        warrior: '#4caf50',
        mage: '#2196f3',
        archer: '#ffeb3b',
        priest: '#ffffff'
    };

    // Flatten companions array (supports both array-of-objects and map formats).
    var companionTypes = [];
    if (Array.isArray(player.companions)) {
        for (var i = 0; i < player.companions.length; i++) {
            if (player.companions[i] && player.companions[i].type) {
                companionTypes.push(player.companions[i]);
            }
        }
    } else {
        for (var type in player.companions) {
            var count = player.companions[type] || 0;
            for (var j = 0; j < count; j++) {
                companionTypes.push({ type: type, level: 1 });
            }
        }
    }

    // Split into left group (warrior, mage) and right group (archer, priest).
    // Order within each group: warrior→mage left-to-right; archer→priest left-to-right.
    var leftOrder  = ['warrior', 'mage'];
    var rightOrder = ['archer', 'priest'];

    var leftGroup  = [];
    var rightGroup = [];
    var unassigned = [];

    for (var k = 0; k < companionTypes.length; k++) {
        var c = companionTypes[k];
        if (leftOrder.indexOf(c.type) !== -1) {
            leftGroup.push(c);
        } else if (rightOrder.indexOf(c.type) !== -1) {
            rightGroup.push(c);
        } else {
            unassigned.push(c);
        }
    }

    // Sort each group by the defined order so display is consistent regardless of arrival order.
    leftGroup.sort(function(a, b) { return leftOrder.indexOf(a.type) - leftOrder.indexOf(b.type); });
    rightGroup.sort(function(a, b) { return rightOrder.indexOf(a.type) - rightOrder.indexOf(b.type); });

    // Use shared layout constants (defined at top of file).
    var companionRadius = COMPANION_RADIUS;
    var spacing         = COMPANION_SPACING;
    var gap             = COMPANION_GAP;

    var playerScreen = worldToScreen(player.x, player.y);
    var playerDrawRadius = 44;
    var belowOffset = (playerDrawRadius + companionRadius + 14) * camera.zoom;
    var rowScreenY = playerScreen.y + belowOffset;

    // Helper: draw one companion at a given screen-space position.
    var _companionDrawNow = Date.now(); // shared timestamp for this companions pass
    function drawOne(companion, sx, sy) {
        var r = companionRadius * camera.zoom;

        // Look up the character art (e.g. gameImages.characters['Warrior']).
        var typeKey = companion.type.charAt(0).toUpperCase() + companion.type.slice(1);
        var charImg = typeof gameImages !== 'undefined' &&
            gameImages && gameImages.characters && gameImages.characters[typeKey];
        var fallbackColor = companionColors[companion.type] || '#888';

        // Animated draw — sprites.js handles per-type personality animations.
        if (typeof drawAnimatedSprite !== 'undefined') {
            drawAnimatedSprite(ctx, companion.type, sx, sy, r, charImg, fallbackColor, _companionDrawNow);
        } else {
            // Fallback if sprites.js is not loaded.
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            var imgReady = charImg && charImg.complete && charImg.naturalWidth > 0;
            if (imgReady) {
                ctx.clip();
                ctx.drawImage(charImg, sx - r, sy - r, r * 2, r * 2);
            } else {
                ctx.fillStyle = fallbackColor;
                ctx.fill();
            }
            ctx.restore();
        }

        // Ring around every companion.
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Level badge — only show once the companion levels up past 1.
        if (companion.level && companion.level > 1) {
            ctx.fillStyle = '#000';
            ctx.font = 'bold ' + Math.max(9, Math.floor(10 * camera.zoom)) + 'px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(companion.level, sx, sy);
        }
    }

    // Left group (warrior, mage): drawn right-to-left from the player.
    // Index 0 in the sorted group is closest to the player.
    var scaledSpacing = spacing * camera.zoom;
    var scaledGap     = gap     * camera.zoom;

    for (var li = 0; li < leftGroup.length; li++) {
        // li=0 → closest to player (one gap + half-radius in), li=1 → one more step left
        var sx = playerScreen.x - scaledGap - (li + 1) * scaledSpacing + scaledSpacing / 2;
        drawOne(leftGroup[li], sx, rowScreenY);
    }

    // Right group (archer, priest): drawn left-to-right from the player.
    for (var ri = 0; ri < rightGroup.length; ri++) {
        var sx = playerScreen.x + scaledGap + (ri + 1) * scaledSpacing - scaledSpacing / 2;
        drawOne(rightGroup[ri], sx, rowScreenY);
    }

    // Unassigned: continue to the right of the right group.
    var rightCount = rightGroup.length;
    for (var ui = 0; ui < unassigned.length; ui++) {
        var sx = playerScreen.x + scaledGap + (rightCount + ui + 1) * scaledSpacing - scaledSpacing / 2;
        drawOne(unassigned[ui], sx, rowScreenY);
    }
}

// Draw UI panel - Stats moved to HTML panel in idleclicker.html
function drawUI(ctx, player) {
    // Stats panel is now rendered as HTML element outside the canvas
    // This function is kept for potential future canvas UI elements
    return;
}

// Draw combat log — disabled (removed canvas overlay)
// Reconstruct a companion's screen X from its side + index using the same
// formula as drawCompanions, so attack origins are always in sync with portraits.
function companionScreenX(playerScreenX, side, sideIndex, zoom) {
    var scaledSpacing = COMPANION_SPACING * zoom;
    var scaledGap     = COMPANION_GAP     * zoom;
    if (side === 'left') {
        return playerScreenX - scaledGap - (sideIndex + 1) * scaledSpacing + scaledSpacing / 2;
    }
    return playerScreenX + scaledGap + (sideIndex + 1) * scaledSpacing - scaledSpacing / 2;
}

function drawCompanionEffects(ctx) {
    if (typeof companionEffects === 'undefined' || !companionEffects.length) { return; }
    var now = Date.now();

    var localPlayer = entities[myID];
    if (!localPlayer) { return; }
    var playerScreen = worldToScreen(localPlayer.x, localPlayer.y);
    var monsterScreenX = playerScreen.x;
    var monsterScreenY = playerScreen.y - 310;

    // Row Y matches drawCompanions layout
    var playerDrawRadius = 34;
    var belowOffset = (playerDrawRadius + COMPANION_RADIUS + 14) * camera.zoom;
    var companionRowY = playerScreen.y + belowOffset;

    for (var i = companionEffects.length - 1; i >= 0; i--) {
        var e = companionEffects[i];
        var age = now - e.startedAt;
        if (age >= e.duration) { companionEffects.splice(i, 1); continue; }
        var t = age / e.duration;   // 0 → 1
        var alpha = 1 - t;

        // Origin = the companion's portrait centre, not the player position.
        var originX = companionScreenX(playerScreen.x, e.side || 'left', e.sideIndex || 0, camera.zoom);
        var originY = companionRowY;
        var fromScreen = { x: originX, y: originY };

        // ── Warrior: small pair of crossed slash marks ──────────────────────
        if (e.kind === 'warrior') {
            var x0 = fromScreen.x, y0 = fromScreen.y;
            var x1 = monsterScreenX, y1 = monsterScreenY;
            var dx = x1 - x0, dy = y1 - y0;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var px = -dy / len, py = dx / len;
            // Two shorter crossed slashes offset to the side
            var offsets = [-10, 10];
            for (var j = 0; j < offsets.length; j++) {
                var ox = px * offsets[j], oy = py * offsets[j];
                var s0x = x0 + dx * 0.35 + ox, s0y = y0 + dy * 0.35 + oy;
                var s1x = x0 + dx * 0.80 + ox, s1y = y0 + dy * 0.80 + oy;
                ctx.save();
                ctx.globalAlpha = alpha * 0.85;
                ctx.strokeStyle = '#ffd54f';
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(s0x, s0y);
                ctx.lineTo(s1x, s1y);
                ctx.stroke();
                ctx.restore();
            }
        }

        // ── Archer: an arrow shaft travelling toward the monster ─────────────
        else if (e.kind === 'archer') {
            var x0 = fromScreen.x, y0 = fromScreen.y;
            var x1 = monsterScreenX, y1 = monsterScreenY;
            var dx = x1 - x0, dy = y1 - y0;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var ux = dx / len, uy = dy / len;   // unit vector toward monster
            var px = -uy, py = ux;              // perpendicular

            // Arrow travels: tip progresses from 30% → 95% along the path
            var tipFrac  = 0.30 + t * 0.65;
            var tailFrac = tipFrac - 0.12;
            var tipX  = x0 + dx * tipFrac,  tipY  = y0 + dy * tipFrac;
            var tailX = x0 + dx * tailFrac, tailY = y0 + dy * tailFrac;

            ctx.save();
            ctx.globalAlpha = alpha;

            // Shaft
            ctx.strokeStyle = '#8d6e63';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            // Arrowhead — small triangle at the tip
            var headLen = 8;
            var ax0 = tipX - ux * headLen + px * 4;
            var ay0 = tipY - uy * headLen + py * 4;
            var ax1 = tipX - ux * headLen - px * 4;
            var ay1 = tipY - uy * headLen - py * 4;
            ctx.fillStyle = '#e0e0e0';
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(ax0, ay0);
            ctx.lineTo(ax1, ay1);
            ctx.closePath();
            ctx.fill();

            // Small tail feathers
            var fLen = 6;
            ctx.strokeStyle = '#81c784';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tailX + px * fLen, tailY + py * fLen);
            ctx.lineTo(tailX, tailY);
            ctx.lineTo(tailX - px * fLen, tailY - py * fLen);
            ctx.stroke();

            ctx.restore();
        }

        // ── Mage: lightning bolt ─────────────────────────────────────────────
        else if (e.kind === 'mage') {
            var x0 = fromScreen.x, y0 = fromScreen.y;
            var x1 = monsterScreenX, y1 = monsterScreenY;
            var dx = x1 - x0, dy = y1 - y0;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var px = -dy / len, py = dx / len;

            // Seeded zigzag so it looks the same every frame for this effect
            var seed = e.startedAt;
            function rand01(n) {
                var x = Math.sin(seed + n * 127.1) * 43758.5453;
                return x - Math.floor(x);
            }

            var segments = 7;
            var points = [];
            for (var s = 0; s <= segments; s++) {
                var frac = s / segments;
                var bx = x0 + dx * frac;
                var by = y0 + dy * frac;
                var jitter = (s === 0 || s === segments) ? 0 : (rand01(s) - 0.5) * 28;
                points.push({ x: bx + px * jitter, y: by + py * jitter });
            }

            // Outer glow pass
            ctx.save();
            ctx.globalAlpha = alpha * 0.35;
            ctx.strokeStyle = '#b39ddb';
            ctx.lineWidth = 6;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var s = 1; s < points.length; s++) {
                ctx.lineTo(points[s].x, points[s].y);
            }
            ctx.stroke();
            ctx.restore();

            // Core bright bolt
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = '#e040fb';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var s = 1; s < points.length; s++) {
                ctx.lineTo(points[s].x, points[s].y);
            }
            ctx.stroke();
            // Bright white inner line
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (var s = 1; s < points.length; s++) {
                ctx.lineTo(points[s].x, points[s].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // ── Priest: green + signs floating up around the player ──────────────
        else if (e.kind === 'priestHeal') {
            var cx = playerScreen.x + (e.offsetX || 0);
            var cy = playerScreen.y + (e.offsetY || 0) - t * 25; // float upward
            var armLen = 7;
            var armW   = 3;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#66bb6a';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5;

            // Horizontal bar
            ctx.fillRect(cx - armLen, cy - armW / 2, armLen * 2, armW);
            // Vertical bar
            ctx.fillRect(cx - armW / 2, cy - armLen, armW, armLen * 2);

            ctx.strokeRect(cx - armLen, cy - armW / 2, armLen * 2, armW);
            ctx.strokeRect(cx - armW / 2, cy - armLen, armW, armLen * 2);

            ctx.restore();
        }

        // ── Monster hit: red/orange claw scratches radiating from the player ─
        else if (e.kind === 'monsterHit') {
            var playerS = worldToScreen(e.fromX, e.fromY);
            var cx = playerS.x;
            var cy = playerS.y;

            // Each scratch is a short curved arc radiating outward at e.angle,
            // drawn as two slightly offset lines to look like a claw mark.
            var scratchLen = 28 + t * 10;  // grows slightly as it fades
            var scratchW   = 4 * (1 - t);  // starts thick, tapers

            // Rotate the base angle slightly as t increases for a swipe feel
            var ang = e.angle + t * 0.25;
            var ux  = Math.cos(ang);
            var uy  = Math.sin(ang);
            var px2 = -uy, py2 = ux;   // perpendicular

            // Two parallel claw lines offset by ±4px perpendicular
            var lineOffsets = [-4, 0, 4];
            for (var ci2 = 0; ci2 < lineOffsets.length; ci2++) {
                var loff = lineOffsets[ci2];
                // Each line starts at a small inner radius and extends outward
                var innerR = 12;
                var x0c = cx + ux * innerR + px2 * loff;
                var y0c = cy + uy * innerR + py2 * loff;
                var x1c = cx + ux * (innerR + scratchLen) + px2 * loff;
                var y1c = cy + uy * (innerR + scratchLen) + py2 * loff;

                // Colour: outer lines orange, centre line bright red
                var col = ci2 === 1 ? '#ff1a1a' : '#ff7043';

                ctx.save();
                ctx.globalAlpha = alpha * (ci2 === 1 ? 0.95 : 0.6);
                ctx.strokeStyle = col;
                ctx.lineWidth   = ci2 === 1 ? scratchW : scratchW * 0.6;
                ctx.lineCap     = 'round';
                ctx.beginPath();
                ctx.moveTo(x0c, y0c);
                ctx.lineTo(x1c, y1c);
                ctx.stroke();
                ctx.restore();
            }
        }
    }
}

function drawSlashEffects(ctx) {
    if (typeof slashEffects === 'undefined' || !slashEffects.length) { return; }
    var now = Date.now();

    // Find the monster screen position (same logic as drawMonster).
    var localPlayer = entities[myID];
    if (!localPlayer) { return; }
    var playerScreen = worldToScreen(localPlayer.x, localPlayer.y);
    var monsterScreenX = playerScreen.x;
    var monsterScreenY = playerScreen.y - 310;

    for (var i = slashEffects.length - 1; i >= 0; i--) {
        var s = slashEffects[i];
        var age = now - s.startedAt;
        if (age >= s.duration) { slashEffects.splice(i, 1); continue; }

        var t = age / s.duration;          // 0 → 1
        var alpha = 1 - t;                 // fade out

        // Origin: player screen position at the time of the hit.
        var fromScreen = worldToScreen(s.fromX, s.fromY);
        var x0 = fromScreen.x;
        var y0 = fromScreen.y;
        var x1 = monsterScreenX;
        var y1 = monsterScreenY;

        // Draw three parallel diagonal slash lines fanning out from the trajectory.
        var dx = x1 - x0;
        var dy = y1 - y0;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Perpendicular unit vector for fanning.
        var px = -dy / len;
        var py =  dx / len;

        var slashSpread = 18;  // px between slash lines
        var offsets = [-slashSpread, 0, slashSpread];

        // Each slash travels only partway along the trajectory, staggered by offset.
        for (var j = 0; j < offsets.length; j++) {
            var off = offsets[j] * (1 - t * 0.5); // spread contracts as it fades
            var ox = px * off;
            var oy = py * off;

            // The slash starts a quarter of the way and ends 90% of the way to the monster.
            var startFrac = 0.25;
            var endFrac   = 0.90;

            var sx0 = x0 + dx * startFrac + ox;
            var sy0 = y0 + dy * startFrac + oy;
            var sx1 = x0 + dx * endFrac   + ox;
            var sy1 = y0 + dy * endFrac   + oy;

            // Derive colours from the stored hue (rainbow by click speed).
            var hue = s.hue || 0;
            // Centre line: full saturation at hue; side lines: lighter tint
            var centreCol = 'hsl(' + hue + ',100%,75%)';
            var sideCol   = 'hsl(' + hue + ',80%,88%)';

            ctx.save();
            ctx.globalAlpha = alpha * (j === 1 ? 1 : 0.55);
            ctx.strokeStyle = j === 1 ? centreCol : sideCol;
            ctx.lineWidth   = j === 1 ? 3 : 1.5;
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(sx0, sy0);
            ctx.lineTo(sx1, sy1);
            ctx.stroke();
            ctx.restore();
        }
    }
}

function drawCombatLog(ctx, combatEvents) { return; }

function drawPvPEffects(ctx) {
    drawAttackRangeIndicator(ctx);
    drawDamageNumbers(ctx);
    drawKillFeed(ctx);
    drawPvPError(ctx);
    drawDeathOverlay(ctx);
}

function drawAttackRangeIndicator(ctx) {
    var me = entities[myID];
    var target = pvpEffects.hoveredTargetId ? entities[pvpEffects.hoveredTargetId] : null;
    if (!me || !target || me.isDead) { return; }
    var meScreen = worldToScreen(me.x, me.y);
    var dx = me.x - target.x;
    var dy = me.y - target.y;
    var inRange = Math.sqrt(dx * dx + dy * dy) <= 100;

    ctx.save();
    ctx.strokeStyle = inRange ? '#00ff99' : '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(meScreen.x, meScreen.y, 100 * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    var targetScreen = worldToScreen(target.x, target.y);
    ctx.fillStyle = inRange ? '#00ff99' : '#ff4d4d';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(inRange ? 'Click to Attack!' : 'Out of Range', targetScreen.x, targetScreen.y - (target.radius || 20) - 28);
    ctx.restore();
}

function drawDamageNumbers(ctx) {
    var now = Date.now();
    var next = [];
    for (var i = 0; i < pvpEffects.damageNumbers.length; i++) {
        var dmg = pvpEffects.damageNumbers[i];
        var age = now - dmg.createdAt;
        if (age >= dmg.lifetime) { continue; }
        next.push(dmg);
        var alpha = 1 - (age / dmg.lifetime);
        var screen = worldToScreen(dmg.x, dmg.y - age * 0.03);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = '#ffff66';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.strokeText('-' + Math.floor(dmg.damage), screen.x, screen.y);
        ctx.fillText('-' + Math.floor(dmg.damage), screen.x, screen.y);
        ctx.restore();
    }
    pvpEffects.damageNumbers = next;
}

function drawKillFeed(ctx) {
    var now = Date.now();
    var x = camera.viewW - 20;
    var y = 30;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = '13px Arial';
    for (var i = pvpEffects.killFeed.length - 1; i >= 0; i--) {
        var item = pvpEffects.killFeed[i];
        var age = now - item.createdAt;
        if (age > 5000) { continue; }
        ctx.globalAlpha = 1 - (age / 5000);
        ctx.fillStyle = '#fff';
        ctx.fillText(shortPlayerName(item.killerId) + ' killed ' + shortPlayerName(item.victimId), x, y);
        y += 18;
    }
    ctx.restore();
}

function drawPvPError(ctx) {
    if (!pvpEffects.errorMessage || Date.now() > pvpEffects.errorExpiresAt) { return; }
    ctx.save();
    ctx.fillStyle = 'rgba(180, 30, 30, 0.9)';
    ctx.fillRect(camera.viewW / 2 - 140, camera.viewH - 60, 280, 34);
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(pvpEffects.errorMessage, camera.viewW / 2, camera.viewH - 38);
    ctx.restore();
}

function drawDeathOverlay(ctx) {
    if (!pvpEffects.deathOverlay.active) { return; }
    var remaining = Math.max(0, Math.ceil((pvpEffects.deathOverlay.respawnTime - Date.now()) / 1000));
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('You Died!', camera.viewW / 2, camera.viewH / 2 - 20);
    ctx.font = '18px Arial';
    ctx.fillText('Killed by: ' + shortPlayerName(pvpEffects.deathOverlay.killerId), camera.viewW / 2, camera.viewH / 2 + 20);
    ctx.fillText('Respawning in: ' + remaining + 's', camera.viewW / 2, camera.viewH / 2 + 52);
    ctx.restore();
}

function shortPlayerName(id) {
    if (!id) { return 'Unknown'; }
    return String(id).slice(0, 8);
}
