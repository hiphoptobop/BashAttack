// sprites.js — Procedural animation layer for player and companion portraits.
//
// All animations are purely visual: they apply Canvas transforms (scale,
// translate, rotate) around the existing static images each frame. No new art
// is required. When sprite-sheet frames become available, swap the draw call
// inside drawAnimatedSprite() and the transform math remains untouched.
//
// Public API (used by draw.js):
//   drawAnimatedSprite(ctx, type, sx, sy, r, img, now)
//     Draw one animated portrait at screen position (sx, sy) with radius r.
//     'type' is 'player' or a companion type string ('warrior','mage','archer','priest').
//     'img' is the preloaded Image (or null for the coloured-circle fallback).
//     'now' is Date.now() — pass it in so all siblings share the same timestamp.
//
//   notifyPlayerHit()
//     Call when the local player takes damage to trigger the hit-pop animation.
//
//   notifyCompanionAttack(type)
//     Call when a companion attacks to trigger its attack-lunge animation.

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

var _spriteState = {
    // Per-entity animation clocks, keyed by companion type or 'player'.
    // { phase: number (0..2π offset so siblings aren't in sync) }
    phases: {
        player:  0,
        warrior: 0,
        mage:    Math.PI * 0.5,
        archer:  Math.PI * 1.0,
        priest:  Math.PI * 1.5
    },

    // Hit-pop for the player: scale spike that decays quickly.
    playerHitPop: 0,      // 0..1, decays each frame
    playerHitTime: 0,     // timestamp of last hit

    // Per-companion attack lunge (forward-lean scale spike).
    companionAttackPop: {},   // type -> { t: 0..1, startedAt }
};

// ---------------------------------------------------------------------------
// Event triggers (called from client.js socket handlers via draw.js or game.js)
// ---------------------------------------------------------------------------

function notifyPlayerHit() {
    _spriteState.playerHitTime  = Date.now();
    _spriteState.playerHitPop   = 1.0;
}

function notifyCompanionAttack(type) {
    _spriteState.companionAttackPop[type] = {
        startedAt: Date.now(),
        duration: 300
    };
}

// ---------------------------------------------------------------------------
// Core draw helper
// ---------------------------------------------------------------------------

/**
 * Draw one animated portrait.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string}  type   'player' | 'warrior' | 'mage' | 'archer' | 'priest'
 * @param {number}  sx     screen X centre
 * @param {number}  sy     screen Y centre
 * @param {number}  r      rendered radius in screen pixels
 * @param {Image|null} img loaded Image, or null to use the fallback colour
 * @param {string}  fallbackColor  CSS colour string used when img is null
 * @param {number}  now    Date.now() value (shared across all draws this frame)
 */
function drawAnimatedSprite(ctx, type, sx, sy, r, img, fallbackColor, now) {
    // Resolve phase offset for this entity type.
    var phase = (_spriteState.phases[type] !== undefined)
        ? _spriteState.phases[type] : 0;

    // Compute the animated transforms for this type.
    var anim = _getAnimParams(type, phase, now);

    // Compose the final scale and offset.
    var scaleX = anim.scaleX;
    var scaleY = anim.scaleY;
    var offX   = anim.offX;
    var offY   = anim.offY;

    ctx.save();

    // Translate to the sprite centre so scale/rotate pivot correctly.
    ctx.translate(sx + offX, sy + offY);

    // Apply any rotation (archer sway, etc.)
    if (anim.rotate) {
        ctx.rotate(anim.rotate);
    }

    // Clip to circle before drawing image.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    var drawR = r;  // effective half-size after scale

    if (img && img.complete && img.naturalWidth > 0) {
        ctx.scale(scaleX, scaleY);
        var hw = drawR / scaleX;  // compensate so clip radius stays correct
        var hh = drawR / scaleY;
        ctx.drawImage(img, -hw, -hh, hw * 2, hh * 2);
    } else {
        // Coloured-circle fallback — still animate scale.
        ctx.scale(scaleX, scaleY);
        ctx.fillStyle = fallbackColor || '#888';
        ctx.fill();
    }

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Animation parameter calculator
// ---------------------------------------------------------------------------

/**
 * Returns { scaleX, scaleY, offX, offY, rotate } for the given type + time.
 */
function _getAnimParams(type, phase, now) {
    var t = now / 1000;  // seconds

    switch (type) {

        // ── Player: gentle breathe + hit-pop ─────────────────────────────
        case 'player': {
            // Slow uniform breathe (3 s period)
            var breathe = 1 + Math.sin(t * 2.094 + phase) * 0.025;

            // Hit pop: sharp rise + exponential decay over ~400 ms
            var pop = 0;
            if (_spriteState.playerHitPop > 0) {
                var elapsed = now - _spriteState.playerHitTime;
                var decay   = Math.max(0, 1 - elapsed / 400);
                pop = decay * 0.18;  // max +18% scale spike
                _spriteState.playerHitPop = decay;
            }

            var s = breathe + pop;
            return { scaleX: s, scaleY: s, offX: 0, offY: 0, rotate: 0 };
        }

        // ── Warrior: slow heavy bob ───────────────────────────────────────
        case 'warrior': {
            var lunge = _getAttackLunge('warrior', now);
            var bob   = Math.sin(t * 1.4 + phase) * 2.5;   // 2.5 px up/down, ~4.5 s period
            var squat = 1 + Math.sin(t * 1.4 + phase) * 0.02; // slight squash on down
            return {
                scaleX: squat + lunge * 0.12,
                scaleY: 1 / squat + lunge * 0.12,
                offX: lunge * 6,    // lunges toward the monster (right)
                offY: bob,
                rotate: 0
            };
        }

        // ── Mage: gentle float with slight x-drift ────────────────────────
        case 'mage': {
            var lunge  = _getAttackLunge('mage', now);
            var floatY = Math.sin(t * 1.8 + phase) * 3.5;   // floats up and down
            var floatX = Math.cos(t * 0.9 + phase) * 1.5;   // slow side drift
            // Slight scale pulse on attack
            var pulse  = 1 + lunge * 0.15;
            return {
                scaleX: pulse,
                scaleY: pulse,
                offX: floatX + lunge * 5,
                offY: floatY,
                rotate: 0
            };
        }

        // ── Archer: subtle side-to-side sway (drawing bow feel) ──────────
        case 'archer': {
            var lunge  = _getAttackLunge('archer', now);
            var sway   = Math.sin(t * 2.2 + phase) * 0.022; // tilt ±1.25°
            var lean   = lunge * 0.03;                        // lean into shot
            return {
                scaleX: 1 + lunge * 0.08,
                scaleY: 1 + lunge * 0.08,
                offX: lunge * 4,
                offY: Math.sin(t * 2.2 + phase) * 1.5,
                rotate: sway + lean
            };
        }

        // ── Priest: slow calm pulse (heartbeat) ───────────────────────────
        case 'priest': {
            var lunge  = _getAttackLunge('priest', now);
            // Double-beat pulse: two quick bumps per cycle (~2.5 s)
            var beat1  = Math.exp(-Math.pow(((t * 0.4 + phase / (Math.PI * 2)) % 1) - 0.1, 2) / 0.005);
            var beat2  = Math.exp(-Math.pow(((t * 0.4 + phase / (Math.PI * 2)) % 1) - 0.25, 2) / 0.005);
            var pulse  = 1 + (beat1 + beat2) * 0.04 + lunge * 0.1;
            return {
                scaleX: pulse,
                scaleY: pulse,
                offX: 0,
                offY: -lunge * 3,   // rises slightly on heal
                rotate: 0
            };
        }

        // ── Default fallback: no animation ───────────────────────────────
        default:
            return { scaleX: 1, scaleY: 1, offX: 0, offY: 0, rotate: 0 };
    }
}

// ---------------------------------------------------------------------------
// Attack-lunge helper
// ---------------------------------------------------------------------------

/**
 * Returns a 0..1 value representing how far into an attack lunge this
 * companion currently is. The lunge rises instantly and decays over `duration`.
 */
function _getAttackLunge(type, now) {
    var pop = _spriteState.companionAttackPop[type];
    if (!pop) { return 0; }
    var elapsed  = now - pop.startedAt;
    var progress = elapsed / pop.duration;   // 0..1
    if (progress >= 1) {
        delete _spriteState.companionAttackPop[type];
        return 0;
    }
    // Sharp rise, smooth decay: sin(π * progress) gives a bump curve.
    return Math.sin(Math.PI * progress);
}
