# Idle Clicker Multiplayer Game

A multiplayer idle clicker RPG game built on the HTML Game Starter Pack engine. Fight monsters, hire companions, upgrade skills, and progress through endless tiers of increasing difficulty.

## Game Features

### Core Gameplay
- **Click-to-Attack**: Click to damage monsters and defeat them
- **Idle Companions**: Hire companions that automatically attack monsters
- **RPG Progression**: Level up through 10 levels per tier, earning skill points
- **Skill Tree**: Six upgradeable skills providing passive bonuses
- **Monster Scaling**: Monsters get progressively harder with each level and tier
- **Gold Economy**: Earn gold from defeating monsters to purchase companions
- **Health System**: Both players and monsters have health that depletes in combat

### Multiplayer Features
- **Per-Player Instances**: Each player fights their own monster
- **Real-time Synchronization**: All combat and progression synced across clients
- **Shared World**: See other players and their progress in the same game world

## How to Play

### Starting the Game

1. **Install Dependencies**:
   ```bash
   cd HTML-Game-Starter-Pack-master
   npm install
   ```

2. **Start the Server**:
   ```bash
   npm start
   ```

3. **Open the Game**:
   Navigate to `http://localhost:3000/idleclicker.html` in your browser

### Game Controls

- **Click the red circle** in the center to attack your monster
- **Use WASD or Arrow Keys** to move your character around the world
- **Click companion buttons** on the right panel to purchase companions
- **Click skill buttons** to upgrade skills (requires skill points)

### Progression System

#### Levels and Tiers
- Start at Level 1, Tier 0
- Defeat monsters to progress through levels 1-10
- At Level 10, you advance to the next tier and reset to Level 1
- Each tier completion awards 1 skill point
- Monster difficulty scales with level and tier

#### Combat Mechanics
- **Player Attacks**: Click to deal damage based on your attack power + click damage skill
- **Companion Attacks**: Companions automatically attack at their own speed
- **Monster Counter-Attacks**: Monsters attack you every 2 seconds
- **Victory**: Defeat the monster before it defeats you to earn 100% gold
- **Defeat**: If the monster defeats you, earn only 5% gold
- **Health Reset**: Your health resets to full after each monster

### Companions

Four companion types with different stats:

| Companion | Cost | Attack | Speed | Special |
|-----------|------|--------|-------|---------|
| Warrior   | 20g  | 2      | 1.0s  | -       |
| Archer    | 100g | 4      | 1.0s  | -       |
| Mage      | 400g | 16     | 2.0s  | -       |
| Priest    | 1000g | 20    | 1.0s  | Heals 5 HP |

**Cost Scaling**: Each additional companion of the same type costs 1.5x more

### Skill Tree

Six skills to upgrade with skill points:

| Skill | Cost | Max Level | Effect |
|-------|------|-----------|--------|
| Vitality | 1 SP | 25 | +20 max health per level |
| Strength | 1 SP | 25 | +2 attack power per level |
| Precision | 2 SP | 25 | +5% critical hit chance per level (double damage) |
| Leadership | 2 SP | 25 | +20% companion damage per level |
| Fortune | 2 SP | 25 | +10% gold earned per level |
| Regeneration | 2 SP | 25 | +1 health per second per level |

## Architecture

### Server-Side Components

#### Entities
- **Player** (`server/entities/player.js`): Extended with idle clicker stats (health, gold, level, tier, companions, skill tree)
- **Monster** (`server/entities/monster.js`): Stationary enemy with scaling stats based on level and tier
- **Companion Definitions** (`server/data/companions.js`): Static data for companion types
- **Skill Definitions** (`server/data/skills.js`): Static data for skill tree

#### Game Mode
- **Idle Clicker Mode** (`server/modes/idleclicker.js`): Core game logic
  - Lifecycle hooks: onStart, onStop, onPlayerJoin, onPlayerLeave, onTick, checkWin
  - Combat processing: companion attacks, monster attacks, health regeneration
  - Progression: level ups, tier advancement, skill point awards
  - Economy: gold rewards, companion purchases, skill upgrades

#### Communication
- **Messenger** (`server/messenger.js`): Socket event handlers for player actions
  - `playerClick`: Handle click attacks
  - `purchaseCompanion`: Process companion purchases
  - `upgradeSkill`: Process skill upgrades
- **Compressor** (`server/compressor.js`): Efficient wire protocol encoders
  - `playerIdleStats`: Encode player stats
  - `monsterState`: Encode monster state
  - `companionList`: Encode companion list
  - `skillTree`: Encode skill tree

### Client-Side Components

#### Rendering
- **Draw Functions** (`client/scripts/draw.js`):
  - `drawMonster`: Render monsters with health bars and level indicators
  - `drawPlayerHealth`: Render player health bars
  - `drawUI`: Render stats panel
  - `drawCombatLog`: Render combat events with fade-out

#### Communication
- **Client Handlers** (`client/scripts/client.js`):
  - Socket event handlers for combat events, stat updates, purchase/upgrade results
  - API functions: `sendPlayerClick()`, `purchaseCompanion()`, `upgradeSkill()`

#### UI
- **Game Interface** (`client/idleclicker.html`):
  - Canvas for game rendering
  - Click area for attacking
  - Control panel with companion and skill buttons

### Data Flow

```
Player Action (Click/Purchase/Upgrade)
  ↓
Client sends socket event
  ↓
Server validates and processes
  ↓
Game mode updates game state
  ↓
Server broadcasts updates
  ↓
Client receives and renders
```

## Game Balance

### Monster Scaling
- **Health**: 50 + (level + tier × 10) × 10
- **Attack**: 5 + (level + tier × 10) × 2
- **Gold Reward**: 10 × level × (1 + tier)

### Examples
- Level 1, Tier 0: 60 HP, 7 ATK, 10 gold
- Level 10, Tier 0: 150 HP, 25 ATK, 100 gold
- Level 1, Tier 1: 160 HP, 27 ATK, 20 gold
- Level 10, Tier 1: 250 HP, 45 ATK, 200 gold

## Development

### Project Structure
```
HTML-Game-Starter-Pack-master/
├── server/
│   ├── entities/
│   │   ├── player.js (extended)
│   │   └── monster.js (new)
│   ├── data/
│   │   ├── companions.js (new)
│   │   └── skills.js (new)
│   ├── modes/
│   │   └── idleclicker.js (new)
│   ├── messenger.js (extended)
│   ├── compressor.js (extended)
│   └── config.json (modified)
├── client/
│   ├── scripts/
│   │   ├── client.js (extended)
│   │   ├── draw.js (extended)
│   │   └── game.js (extended)
│   └── idleclicker.html (new)
└── IDLE_CLICKER_README.md (this file)
```

### Adding New Features

#### Adding a New Companion
1. Add definition to `server/data/companions.js`
2. Add button to `client/idleclicker.html`
3. No code changes needed - system is data-driven

#### Adding a New Skill
1. Add definition to `server/data/skills.js`
2. Add effect logic to `Player.spendSkillPoint()` if immediate effect
3. Add calculation logic where skill is used (e.g., in damage calculations)
4. Add button to `client/idleclicker.html`

#### Modifying Game Balance
- Edit scaling formulas in `Monster` constructor
- Edit companion stats in `server/data/companions.js`
- Edit skill effects in `server/data/skills.js`
- Edit gold rewards in `handleMonsterDeath()`

## Testing

### Local Testing
1. Start server: `npm start`
2. Open multiple browser tabs to `http://localhost:3000/idleclicker.html`
3. Each tab represents a different player
4. Test multiplayer isolation (each player fights their own monster)

### Test Scenarios
- Click attacks reduce monster health
- Companions auto-attack at correct intervals
- Monsters counter-attack and reduce player health
- Player death awards 5% gold
- Monster death awards 100% gold and levels up player
- Tier progression at level 10 awards skill point
- Companion purchases deduct gold and add companions
- Skill upgrades deduct skill points and apply effects
- Health regeneration works with skill tree

## Future Enhancements

### Potential Features
- **Persistent Progression**: Save player data to database
- **More Companions**: Additional companion types with unique abilities
- **Boss Battles**: Special monsters every 10 levels
- **Achievements**: Unlock rewards for milestones
- **Leaderboards**: Compare progress with other players
- **Equipment System**: Find and equip items for bonuses
- **Prestige System**: Reset for permanent bonuses
- **Mobile Support**: Touch controls and responsive UI

## Credits

Built on the [HTML Game Starter Pack](https://github.com/josephg/HTML-Game-Starter-Pack) by Joseph Gentle.

Idle Clicker game mode and features implemented as an extension of the base engine.

## License

Same license as the HTML Game Starter Pack (MIT License).