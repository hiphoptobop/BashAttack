# PvP Integration Plan for Idle Clicker Game

## Executive Summary

This document provides a comprehensive technical design for integrating Player vs Player (PvP) combat into the existing idle clicker game. The design preserves the single-player idle clicker experience while adding a multiplayer arena mode where players can battle each other using their accumulated stats.

**Key Design Principle:** Use separate room types to allow players to switch between idle clicker (PvE) and PvP arena modes while preserving character progression.

---

## 1. System Architecture

### 1.1 Current Architecture Analysis

```
Current System:
┌─────────────────────────────────────────────────────────────┐
│ Hostess (Room Manager)                                      │
│  - Manages single room type (idleclicker OR arena)          │
│  - One game mode per server instance                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Room                                                         │
│  - Contains Game instance                                   │
│  - Manages clientList and playerList                        │
│  - Fixed mode (config.gameMode)                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Game                                                         │
│  - Loads single mode from config                            │
│  - Manages entities and simulation                          │
└─────────────────────────────────────────────────────────────┘
```

**Current Limitations:**
- Single mode per server instance (config.gameMode)
- No room type differentiation
- No player state persistence across rooms
- No mechanism for room switching

### 1.2 Proposed Multi-Room Architecture

```
Enhanced System:
┌─────────────────────────────────────────────────────────────┐
│ Hostess (Enhanced Room Manager)                             │
│  - Manages multiple room types (PvE and PvP)                │
│  - Room type registry: { 'pve': [...], 'pvp': [...] }       │
│  - Matchmaking by room type                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ PvE Room (idleclicker)  │  │ PvP Room (pvparena)     │
│  - Single-player combat │  │  - Multiplayer combat   │
│  - Monster spawning     │  │  - Player vs Player     │
│  - Progression system   │  │  - Uses player stats    │
└─────────────────────────┘  └─────────────────────────┘
                │                       │
                ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Player State Manager (NEW)                                  │
│  - Persists player stats across room switches              │
│  - Validates stat integrity                                 │
│  - Handles state serialization/deserialization              │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Room Type System

**Room Type Enumeration:**
```javascript
const ROOM_TYPES = {
    PVE: 'pve',      // Idle clicker mode
    PVP: 'pvp'       // PvP arena mode
};
```

**Room Signature Format:**
```
Current: "123" (numeric only)
Proposed: "pve-123" or "pvp-456" (type-prefixed)
```

---

## 2. Data Architecture

### 2.1 Player State Schema

**Persistent Stats (Preserved Across Rooms):**
```javascript
{
    // Identity
    id: string,
    socketId: string,
    
    // Combat Stats (used in both modes)
    health: number,
    maxHealth: number,
    attackPower: number,
    
    // Progression (PvE only, but displayed in PvP)
    gold: number,
    skillPoints: number,
    level: number,
    tier: number,
    
    // Skill Tree (affects combat in both modes)
    skillTree: {
        maxHealth: number,
        attackPower: number,
        companionDamage: number,
        goldMultiplier: number,
        clickDamage: number,
        healthRegen: number
    },
    
    // Companions (PvE only)
    companions: Array<{
        type: string,
        lastAttackTime: number
    }>,
    
    // PvE State
    currentMonsterId: string | null,
    isInCombat: boolean,
    
    // PvP State (NEW)
    pvpStats: {
        kills: number,
        deaths: number,
        damageDealt: number,
        damageTaken: number,
        lastAttackTime: number,
        respawnTime: number | null
    }
}
```

### 2.2 Combat Event Schema

**PvP Combat Events:**
```javascript
{
    type: 'pvp_attack' | 'pvp_damage' | 'pvp_death' | 'pvp_respawn',
    attackerId: string,
    targetId: string,
    damage: number,
    timestamp: number,
    position: { x: number, y: number }
}
```

---

## 3. Room Switching System

### 3.1 Room Switching Flow

```
Player in PvE Room:
    │
    ├─ Clicks "Enter PvP Arena" button
    │
    ▼
┌─────────────────────────────────────┐
│ Client: Emit 'switchRoom' event    │
│  payload: { targetRoomType: 'pvp' }│
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Server: Handle room switch request │
│  1. Validate player state           │
│  2. Serialize player stats          │
│  3. Leave current room              │
│  4. Find/create target room         │
│  5. Join target room                │
│  6. Restore player stats            │
│  7. Spawn player in new room        │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Client: Receive 'roomSwitched'     │
│  - Update UI for new mode           │
│  - Show/hide mode-specific controls │
└─────────────────────────────────────┘
```

### 3.2 State Preservation Strategy

**Player State Manager (NEW Component):**
```javascript
class PlayerStateManager {
    constructor() {
        this.playerStates = new Map(); // socketId -> serialized state
    }
    
    // Save player state before room switch
    saveState(player) {
        const state = {
            health: player.health,
            maxHealth: player.maxHealth,
            attackPower: player.attackPower,
            gold: player.gold,
            skillPoints: player.skillPoints,
            level: player.level,
            tier: player.tier,
            skillTree: { ...player.skillTree },
            companions: [...player.companions],
            pvpStats: { ...player.pvpStats }
        };
        this.playerStates.set(player.socketId, state);
        return state;
    }
    
    // Restore player state after room switch
    restoreState(player, socketId) {
        const state = this.playerStates.get(socketId);
        if (!state) return false;
        
        Object.assign(player, state);
        return true;
    }
    
    // Clean up state on disconnect
    clearState(socketId) {
        this.playerStates.delete(socketId);
    }
}
```

---

## 4. PvP Combat System Design

### 4.1 Combat Mechanics

**Attack System:**
```
Click-to-Attack Flow:
    │
    ├─ Player clicks on canvas
    │
    ▼
┌─────────────────────────────────────┐
│ Client: Detect click position      │
│  - Convert screen to world coords   │
│  - Check if clicking near enemy     │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Client: Emit 'pvpAttack' event     │
│  payload: {                         │
│    targetId: string,                │
│    clickX: number,                  │
│    clickY: number                   │
│  }                                  │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Server: Validate attack             │
│  1. Check attacker exists           │
│  2. Check target exists             │
│  3. Check attack cooldown           │
│  4. Check range (distance < 100)    │
│  5. Calculate damage                │
│  6. Apply damage to target          │
│  7. Check for death                 │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Server: Broadcast combat event     │
│  - Send to all players in room      │
│  - Include damage, positions, etc.  │
└─────────────────────────────────────┘
```

**Damage Calculation:**
```javascript
function calculatePvPDamage(attacker, target) {
    // Base damage from attacker's stats
    let damage = attacker.attackPower;
    
    // Add skill bonuses
    damage += attacker.skillTree.clickDamage * 5;
    
    // Add level scaling (small bonus)
    damage += Math.floor(attacker.level * 0.5);
    
    // Random variance (±10%)
    const variance = 0.9 + (Math.random() * 0.2);
    damage = Math.floor(damage * variance);
    
    return Math.max(1, damage); // Minimum 1 damage
}
```

**Attack Range Detection:**
```javascript
function isInAttackRange(attacker, target) {
    const dx = attacker.x - target.x;
    const dy = attacker.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    const ATTACK_RANGE = 100; // pixels
    return distance <= ATTACK_RANGE;
}
```

**Attack Cooldown:**
```javascript
const PVP_ATTACK_COOLDOWN = 1000; // 1 second between attacks

function canAttack(player, currentTime) {
    if (!player.pvpStats.lastAttackTime) return true;
    return (currentTime - player.pvpStats.lastAttackTime) >= PVP_ATTACK_COOLDOWN;
}
```

### 4.2 Death and Respawn System

**Death Handling:**
```javascript
function handlePvPDeath(game, victim, killer) {
    // Award kill to killer
    killer.pvpStats.kills++;
    
    // Record death for victim
    victim.pvpStats.deaths++;
    
    // Set respawn timer (5 seconds)
    victim.pvpStats.respawnTime = Date.now() + 5000;
    
    // Reset victim health
    victim.health = 0;
    
    // Broadcast death event
    messenger.messageRoomBySig(game.roomSig, 'pvpDeath', {
        victimId: victim.id,
        killerId: killer.id,
        respawnTime: victim.pvpStats.respawnTime
    });
}
```

**Respawn System:**
```javascript
function checkRespawns(game, currentTime) {
    for (const playerId in game.playerList) {
        const player = game.playerList[playerId];
        
        if (player.pvpStats.respawnTime && 
            currentTime >= player.pvpStats.respawnTime) {
            
            // Respawn player
            player.health = player.maxHealth;
            player.pvpStats.respawnTime = null;
            
            // Move to spawn point
            const spawnPoint = game.world.getSafeLoc(player.radius);
            player.x = spawnPoint.x;
            player.y = spawnPoint.y;
            
            // Broadcast respawn
            messenger.messageRoomBySig(game.roomSig, 'pvpRespawn', {
                playerId: player.id,
                x: player.x,
                y: player.y,
                health: player.health
            });
        }
    }
}
```

### 4.3 Companion Behavior in PvP

**Design Decision:** Companions do NOT participate in PvP combat.

**Rationale:**
1. Simplifies balance (PvP is skill-based, not progression-based)
2. Prevents "pay-to-win" feel (companions cost gold)
3. Reduces network traffic (fewer entities to sync)
4. Maintains clear distinction between PvE and PvP modes

**Implementation:**
- Companions remain in player data but are inactive in PvP rooms
- Companion damage bonuses do NOT apply to PvP attacks
- UI hides companion display in PvP mode

---

## 5. Network Protocol Design

### 5.1 New Socket Events

**Client → Server:**

```javascript
// Room switching
'switchRoom': {
    targetRoomType: 'pve' | 'pvp'
}

// PvP attack
'pvpAttack': {
    targetId: string,
    clickX: number,
    clickY: number
}

// Request PvP stats
'getPvPStats': {
    playerId?: string  // Optional, defaults to self
}
```

**Server → Client:**

```javascript
// Room switch confirmation
'roomSwitched': {
    roomType: 'pve' | 'pvp',
    roomSig: string,
    success: boolean,
    error?: string
}

// PvP combat event
'pvpCombatEvent': {
    type: 'attack' | 'damage' | 'death' | 'respawn',
    attackerId: string,
    targetId: string,
    damage: number,
    targetHealth: number,
    targetMaxHealth: number,
    timestamp: number
}

// PvP death notification
'pvpDeath': {
    victimId: string,
    killerId: string,
    respawnTime: number
}

// PvP respawn notification
'pvpRespawn': {
    playerId: string,
    x: number,
    y: number,
    health: number
}

// PvP stats update
'pvpStatsUpdate': {
    playerId: string,
    kills: number,
    deaths: number,
    damageDealt: number,
    damageTaken: number
}
```

### 5.2 Entity Update Protocol Extensions

**Current Format:**
```javascript
// Standard: [id, x, y, velX, velY, inputAck]
// Idle player: ['idleplayer', id, x, y, velX, velY, inputAck, health, maxHealth, gold, level]
```

**New PvP Format:**
```javascript
// PvP player: ['pvpplayer', id, x, y, velX, velY, inputAck, health, maxHealth, level, attackPower, kills, deaths]
```

**Compressor Updates:**
```javascript
// server/compressor.js
function sendEntityUpdates(entities) {
    const updates = [];
    for (const id in entities) {
        const e = entities[id];
        if (e.type === 'player') {
            if (e.roomType === 'pvp') {
                updates.push([
                    'pvpplayer', e.id, e.x, e.y, e.velX, e.velY,
                    e.lastInputSeq, e.health, e.maxHealth, e.level,
                    e.attackPower, e.pvpStats.kills, e.pvpStats.deaths
                ]);
            } else {
                // Existing idle player format
                updates.push([
                    'idleplayer', e.id, e.x, e.y, e.velX, e.velY,
                    e.lastInputSeq, e.health, e.maxHealth, e.gold,
                    e.level, e.attackPower, e.skillPoints
                ]);
            }
        }
    }
    return updates;
}
```

---

## 6. UI/UX Design

### 6.1 Mode Switching UI

**Idle Clicker Mode (idleclicker.html):**

```html
<!-- Add below FAQ button -->
<div class="section">
    <h3>Multiplayer</h3>
    <button id="enterPvPBtn" onclick="enterPvPArena()">
        ⚔️ Enter PvP Arena
    </button>
    <p style="font-size: 12px; color: #aaa;">
        Battle other players using your stats!
    </p>
</div>
```

**PvP Arena Mode (pvparena.html - NEW FILE):**

```html
<!-- Top-left: Player stats -->
<div id="playerStats">
    <h3>Your Stats</h3>
    <p>Level: <span id="statLevel">1</span></p>
    <p>Attack: <span id="statAttack">1</span></p>
    <p>Health: <span id="statHealth">100</span>/<span id="statMaxHealth">100</span></p>
    <p>K/D: <span id="statKills">0</span>/<span id="statDeaths">0</span></p>
</div>

<!-- Top-right: Controls -->
<div id="pvpControls">
    <h3>PvP Arena</h3>
    <button onclick="returnToPvE()">← Return to PvE</button>
    <p style="font-size: 12px;">
        Click near enemies to attack!<br>
        Range: 100 pixels<br>
        Cooldown: 1 second
    </p>
</div>

<!-- Center: Attack range indicator (when hovering over enemy) -->
<div id="attackRangeIndicator" style="display: none;">
    <div class="range-circle"></div>
    <p>Click to Attack!</p>
</div>
```

### 6.2 Combat Feedback UI

**Health Bars:**
```javascript
// Draw health bar above each player
function drawPlayerHealthBar(ctx, player) {
    const barWidth = 60;
    const barHeight = 6;
    const x = player.x - barWidth / 2;
    const y = player.y - player.radius - 15;
    
    // Background (red)
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Health (green)
    const healthPercent = player.health / player.maxHealth;
    ctx.fillStyle = '#00FF00';
    ctx.fillRect(x, y, barWidth * healthPercent, barHeight);
    
    // Border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barWidth, barHeight);
    
    // Health text
    ctx.fillStyle = '#FFF';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
        Math.ceil(player.health) + '/' + player.maxHealth,
        player.x, y - 2
    );
}
```

**Damage Numbers:**
```javascript
// Floating damage numbers
class DamageNumber {
    constructor(x, y, damage, isCrit) {
        this.x = x;
        this.y = y;
        this.damage = damage;
        this.isCrit = isCrit;
        this.alpha = 1.0;
        this.lifetime = 1000; // 1 second
        this.startTime = Date.now();
    }
    
    update() {
        const elapsed = Date.now() - this.startTime;
        this.y -= 0.5; // Float upward
        this.alpha = 1.0 - (elapsed / this.lifetime);
        return elapsed < this.lifetime;
    }
    
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.font = this.isCrit ? 'bold 20px Arial' : '16px Arial';
        ctx.fillStyle = this.isCrit ? '#FF0000' : '#FFFF00';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.textAlign = 'center';
        ctx.strokeText('-' + this.damage, this.x, this.y);
        ctx.fillText('-' + this.damage, this.x, this.y);
        ctx.restore();
    }
}
```

**Attack Range Indicator:**
```javascript
// Draw attack range circle when hovering over enemy
function drawAttackRange(ctx, player, target) {
    const distance = getDistance(player, target);
    const inRange = distance <= ATTACK_RANGE;
    
    ctx.save();
    ctx.strokeStyle = inRange ? '#00FF00' : '#FF0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, ATTACK_RANGE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}
```

### 6.3 Respawn UI

**Death Screen Overlay:**
```html
<div id="deathOverlay" style="display: none;">
    <div class="death-screen">
        <h1>You Died!</h1>
        <p>Killed by: <span id="killerName"></span></p>
        <p>Respawning in: <span id="respawnTimer">5</span>s</p>
        <div class="death-stats">
            <p>Damage Dealt: <span id="deathDamageDealt">0</span></p>
            <p>Damage Taken: <span id="deathDamageTaken">0</span></p>
        </div>
    </div>
</div>
```

---

## 7. Implementation Plan

### Phase 1: Foundation (Week 1)

**Goal:** Establish multi-room architecture and state management

**Tasks:**
1. Create PlayerStateManager class
   - File: [`server/playerStateManager.js`](server/playerStateManager.js)
   - Implement saveState, restoreState, clearState methods
   - Add state validation

2. Enhance Hostess for multi-room types
   - File: [`server/hostess.js`](server/hostess.js:1)
   - Add room type registry
   - Modify findARoom to accept room type parameter
   - Update room signature format (type-prefixed)

3. Create Room base class with type property
   - File: [`server/game.js`](server/game.js:34)
   - Add roomType property to Room constructor
   - Pass roomType to Game instance

4. Add pvpStats to Player entity
   - File: [`server/entities/player.js`](server/entities/player.js:43)
   - Initialize pvpStats object in constructor
   - Add PvP-specific methods

**Testing:**
- Unit tests for PlayerStateManager
- Integration test for room type creation
- Verify player state persistence

### Phase 2: PvP Mode Implementation (Week 2)

**Goal:** Create PvP arena mode with basic combat

**Tasks:**
1. Create pvparena.js mode
   - File: [`server/modes/pvparena.js`](server/modes/pvparena.js) (NEW)
   - Implement mode lifecycle hooks
   - Add combat validation logic
   - Implement death/respawn system

2. Add PvP combat handlers to messenger
   - File: [`server/messenger.js`](server/messenger.js:134)
   - Add 'pvpAttack' handler
   - Add 'switchRoom' handler
   - Implement attack validation

3. Update compressor for PvP entity format
   - File: [`server/compressor.js`](server/compressor.js)
   - Add 'pvpplayer' format
   - Update sendEntityUpdates logic

4. Implement combat mechanics
   - Damage calculation
   - Range detection
   - Cooldown system
   - Death handling

**Testing:**
- Test attack validation
- Test damage calculation
- Test death/respawn cycle
- Test room switching

### Phase 3: Client-Side Integration (Week 3)

**Goal:** Build PvP UI and client-side combat

**Tasks:**
1. Create pvparena.html
   - File: [`client/pvparena.html`](client/pvparena.html) (NEW)
   - Design PvP-specific UI
   - Add attack controls
   - Add stats display

2. Update client.js for PvP events
   - File: [`client/scripts/client.js`](client/scripts/client.js:75)
   - Add PvP event handlers
   - Implement 'pvpplayer' decoder
   - Add room switch logic

3. Enhance draw.js for combat feedback
   - File: [`client/scripts/draw.js`](client/scripts/draw.js)
   - Add health bar rendering
   - Add damage number system
   - Add attack range indicator

4. Add room switching to idleclicker.html
   - File: [`client/idleclicker.html`](client/idleclicker.html:168)
   - Add "Enter PvP Arena" button
   - Implement enterPvPArena() function

**Testing:**
- Test UI responsiveness
- Test combat visual feedback
- Test room switching flow
- Test health bar accuracy

### Phase 4: Polish and Balance (Week 4)

**Goal:** Refine gameplay and fix edge cases

**Tasks:**
1. Balance tuning
   - Adjust damage formulas
   - Tune attack cooldowns
   - Balance respawn times
   - Test with various stat levels

2. Edge case handling
   - Handle disconnects during combat
   - Handle room switching during combat
   - Handle rapid attack spam
   - Handle invalid target IDs

3. Performance optimization
   - Optimize entity updates
   - Reduce network traffic
   - Add client-side prediction for attacks
   - Implement attack interpolation

4. Documentation
   - Update README with PvP instructions
   - Document new socket events
   - Create PvP gameplay guide
   - Add code comments

**Testing:**
- Load testing with multiple players
- Network latency testing
- Edge case testing
- User acceptance testing

---

## 8. Risk Assessment and Mitigation

### 8.1 Technical Risks

**Risk 1: State Synchronization Issues**
- **Impact:** High - Players could lose progression
- **Probability:** Medium
- **Mitigation:**
  - Implement state validation before/after room switch
  - Add state backup/restore on failure
  - Log all state transitions
  - Add rollback mechanism

**Risk 2: Combat Desynchronization**
- **Impact:** High - Unfair combat outcomes
- **Probability:** Medium
- **Mitigation:**
  - Server-authoritative combat (no client trust)
  - Timestamp all combat events
  - Implement lag compensation
  - Add combat replay validation

**Risk 3: Performance Degradation**
- **Impact:** Medium - Poor player experience
- **Probability:** Low
- **Mitigation:**
  - Profile entity update performance
  - Optimize compressor for PvP format
  - Implement spatial partitioning for attack range checks
  - Add performance monitoring

**Risk 4: Balance Issues**
- **Impact:** Medium - Unfun gameplay
- **Probability:** High
- **Mitigation:**
  - Extensive playtesting
  - Configurable damage formulas
  - Stat normalization options
  - Separate PvP and PvE stat scaling

### 8.2 Security Risks

**Risk 1: Attack Spam**
- **Impact:** High - Server DoS
- **Probability:** High
- **Mitigation:**
  - Rate limiting on attack events (max 10/second)
  - Server-side cooldown enforcement
  - Disconnect repeat offenders
  - Log suspicious activity

**Risk 2: Invalid Target Attacks**
- **Impact:** Medium - Exploits
- **Probability:** Medium
- **Mitigation:**
  - Validate target exists
  - Validate target is in same room
  - Validate target is alive
  - Validate attack range server-side

**Risk 3: State Manipulation**
- **Impact:** Critical - Cheating
- **Probability:** Low
- **Mitigation:**
  - Never trust client-provided stats
  - Validate all state transitions
  - Checksum player state
  - Detect impossible stat values

---

## 9. Testing Strategy

### 9.1 Unit Tests

**PlayerStateManager Tests:**
```javascript
describe('PlayerStateManager', () => {
    test('saves and restores player state', () => {
        const manager = new PlayerStateManager();
        const player = createMockPlayer();
        
        manager.saveState(player);
        player.health = 0; // Modify state
        
        const restored = manager.restoreState(player, player.socketId);
        expect(restored).toBe(true);
        expect(player.health).toBe(100);
    });
    
    test('handles missing state gracefully', () => {
        const manager = new PlayerStateManager();
        const player = createMockPlayer();
        
        const restored = manager.restoreState(player, 'invalid-id');
        expect(restored).toBe(false);
    });
});
```

**Combat Mechanics Tests:**
```javascript
describe('PvP Combat', () => {
    test('calculates damage correctly', () => {
        const attacker = createMockPlayer({ attackPower: 10 });
        const target = createMockPlayer({ health: 100 });
        
        const damage = calculatePvPDamage(attacker, target);
        expect(damage).toBeGreaterThan(0);
        expect(damage).toBeLessThanOrEqual(attacker.attackPower * 1.2);
    });
    
    test('respects attack cooldown', () => {
        const player = createMockPlayer();
        const now = Date.now();
        
        player.pvpStats.lastAttackTime = now - 500;
        expect(canAttack(player, now)).toBe(false);
        
        player.pvpStats.lastAttackTime = now - 1500;
        expect(canAttack(player, now)).toBe(true);
    });
    
    test('validates attack range', () => {
        const attacker = createMockPlayer({ x: 0, y: 0 });
        const nearTarget = createMockPlayer({ x: 50, y: 0 });
        const farTarget = createMockPlayer({ x: 200, y: 0 });
        
        expect(isInAttackRange(attacker, nearTarget)).toBe(true);
        expect(isInAttackRange(attacker, farTarget)).toBe(false);
    });
});
```

### 9.2 Integration Tests

**Room Switching Test:**
```javascript
describe('Room Switching', () => {
    test('preserves player stats across room switch', async () => {
        const client = await createTestClient();
        await client.enterGame('pve');
        
        const initialStats = client.getPlayerStats();
        await client.switchRoom('pvp');
        const finalStats = client.getPlayerStats();
        
        expect(finalStats.health).toBe(initialStats.health);
        expect(finalStats.level).toBe(initialStats.level);
        expect(finalStats.attackPower).toBe(initialStats.attackPower);
    });
});
```

**Combat Flow Test:**
```javascript
describe('PvP Combat Flow', () => {
    test('complete attack-death-respawn cycle', async () => {
        const attacker = await createTestClient();
        const victim = await createTestClient();
        
        await attacker.enterGame('pvp');
        await victim.enterGame('pvp');
        
        // Position players close together
        await attacker.moveTo(100, 100);
        await victim.moveTo(150, 100);
        
        // Attack until death
        while (victim.health > 0) {
            await attacker.attack(victim.id);
            await wait(1000); // Cooldown
        }
        
        expect(victim.health).toBe(0);
        expect(victim.pvpStats.respawnTime).toBeTruthy();
        
        // Wait for respawn
        await wait(5000);
        expect(victim.health).toBe(victim.maxHealth);
        expect(victim.pvpStats.respawnTime).toBeNull();
    });
});
```

### 9.3 Load Testing

**Concurrent Players Test:**
```javascript
describe('Load Testing', () => {
    test('handles 20 concurrent PvP players', async () => {
        const clients = [];
        for (let i = 0; i < 20; i++) {
            const client = await createTestClient();
            await client.enterGame('pvp');
            clients.push(client);
        }
        
        // Simulate combat
        for (let i = 0; i < 100; i++) {
            const attacker = clients[Math.floor(Math.random() * 20)];
            const target = clients[Math.floor(Math.random() * 20)];
            if (attacker !== target) {
                await attacker.attack(target.id);
            }
            await wait(100);
        }
        
        // Verify server stability
        expect(server.isRunning()).toBe(true);
        expect(server.getTickRate()).toBeGreaterThan(25);
    });
});
```

---

## 10. Configuration

### 10.1 New Config Parameters

**Add to server/config.json:**
```json
{
    "pvp": {
        "attackRange": 100,
        "attackCooldown": 1000,
        "respawnTime": 5000,
        "damageVariance": 0.1,
        "maxPlayersPerPvPRoom": 10,
        "enableFriendlyFire": false,
        "enableCompanionsInPvP": false
    },
    "roomTypes": {
        "pve": {
            "mode": "idleclicker",
            "maxPlayers": 1
        },
        "pvp": {
            "mode": "pvparena",
            "maxPlayers": 10
        }
    }
}
```

---

## 11. File Structure

### New Files to Create:
```
server/
  ├── playerStateManager.js          (NEW)
  └── modes/
      └── pvparena.js                 (NEW)

client/
  └── pvparena.html                   (NEW)

test/
  ├── playerStateManager.test.js     (NEW)
  ├── pvpCombat.test.js              (NEW)
  └── roomSwitching.test.js          (NEW)
```

### Files to Modify:
```
server/
  ├── hostess.js                      (MODIFY - add room types)
  ├── game.js                         (MODIFY - add roomType)
  ├── messenger.js                    (MODIFY - add PvP handlers)
  ├── compressor.js                   (MODIFY - add PvP format)
  ├── config.json                     (MODIFY - add PvP config)
  └── entities/
      └── player.js                   (MODIFY - add pvpStats)

client/
  ├── idleclicker.html                (MODIFY - add PvP button)
  └── scripts/
      ├── client.js                   (MODIFY - add PvP handlers)
      └── draw.js                     (MODIFY - add combat visuals)
```

---

## 12. Success Metrics

### 12.1 Technical Metrics
- [ ] Room switching completes in < 500ms
- [ ] Combat events broadcast in < 50ms
- [ ] Server maintains 30 TPS with 20 concurrent PvP players
- [ ] Zero state loss during room switches
- [ ] Attack validation rejects 100% of invalid attacks

### 12.2 Gameplay Metrics
- [ ] Average combat duration: 30-60 seconds
- [ ] Death/respawn cycle feels fair (5s respawn)
- [ ] Attack range (100px) feels intuitive
- [ ] Damage scaling balanced across levels 1-50
- [ ] UI provides clear combat feedback

### 12.3 Quality Metrics
- [ ] 100% unit test coverage for new code
- [ ] Zero critical bugs in production
- [ ] < 5% player disconnect rate during room switch
- [ ] Positive player feedback on PvP balance

---

## 13. Future Enhancements

### Phase 5+ (Post-Launch)
1. **Ranked PvP System**
   - ELO rating system
   - Matchmaking by skill level
   - Leaderboards

2. **Team-Based Modes**
   - 2v2 or 3v3 arenas
   - Team stats and coordination
   - Friendly fire toggle

3. **PvP Rewards**
   - Gold rewards for kills
   - Exclusive PvP cosmetics
   - Achievement system

4. **Advanced Combat**
   - Special abilities (ultimates)
   - Dodge/block mechanics
   - Combo system

5. **Spectator Mode**
   - Watch ongoing PvP matches
   - Replay system
   - Tournament support

---

## 14. Conclusion

This design provides a comprehensive roadmap for integrating PvP combat into the idle clicker game while preserving the existing single-player experience. The multi-room architecture allows seamless switching between modes, and the server-authoritative combat system ensures fair gameplay.

**Key Success Factors:**
1. Robust state management prevents progression loss
2. Server-side validation prevents cheating
3. Clear UI/UX makes PvP accessible
4. Phased implementation reduces risk
5. Comprehensive testing ensures quality

**Next Steps:**
1. Review and approve this design document
2. Set up development environment
3. Begin Phase 1 implementation
4. Schedule weekly progress reviews

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-18  
**Author:** Bob (Plan Mode)  
**Status:** Ready for Review