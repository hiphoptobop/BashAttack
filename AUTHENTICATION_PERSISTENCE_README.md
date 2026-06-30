# Authentication and Persistence System

This document describes the authentication and persistence system implemented for BashAttack.

## Overview

The system provides:
- **Two authentication methods**: Discord OAuth2 and raid.gamernight.net
- **MongoDB persistence**: Player data is automatically saved and loaded
- **Auto-save system**: Progress is saved every 30 seconds and on disconnect
- **Session management**: Secure session handling with express-session
- **Graceful fallbacks**: Game works without authentication in development mode

## Architecture

### Database Layer
- **MongoDB** with Mongoose ODM
- **PlayerData Model**: Stores all player progression data
- **Connection Manager**: Handles database connection with retry logic

### Authentication Layer
- **Passport.js**: Authentication middleware
- **Discord OAuth2**: Login with Discord accounts
- **raid.gamernight.net**: Custom authentication integration
- **Session Storage**: MongoDB-backed sessions via connect-mongo

### Persistence Layer
- **SaveManager**: Handles save/load operations
- **AutoSaveManager**: Periodic auto-save with throttling
- **Validation**: Data validation before saving

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/bashattack

# Discord OAuth2 (optional)
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback

# raid.gamernight.net (optional)
RAID_API_URL=https://raid.gamernight.net/api
RAID_API_KEY=your_raid_api_key

# Session
SESSION_SECRET=your_random_secret_here

# Server
NODE_ENV=development
PORT=3000
AUTO_SAVE_INTERVAL=30000
```

### 3. Start MongoDB

Ensure MongoDB is running:

```bash
# macOS with Homebrew
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### 4. Configure Discord OAuth2 (Optional)

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Add OAuth2 redirect URL: `http://localhost:3000/auth/discord/callback`
4. Copy Client ID and Client Secret to `.env`

### 5. Start the Server

```bash
npm start
```

## Usage

### For Players

1. **Login**: Navigate to `http://localhost:3000/login.html`
2. **Choose Authentication**:
   - Click "Login with Discord" for Discord OAuth2
   - Or use raid.gamernight.net credentials
3. **Play**: Your progress is automatically saved every 30 seconds
4. **Logout**: Use the logout button (to be implemented in UI)

### For Developers

#### Development Mode

In development mode (`NODE_ENV=development`):
- Authentication is optional
- Players can join without logging in
- Database connection failures are non-fatal
- Detailed logging is enabled

#### Production Mode

In production mode (`NODE_ENV=production`):
- Authentication is required for game access
- Database connection is required
- Security headers are enforced
- Sessions are secure (HTTPS only)

## API Endpoints

### Authentication

- `GET /auth/discord` - Initiate Discord OAuth2 flow
- `GET /auth/discord/callback` - Discord OAuth2 callback
- `POST /auth/raid/login` - Login with raid.gamernight.net
- `POST /auth/logout` - Logout current user
- `GET /api/auth/status` - Check authentication status

### Game

- `GET /play.html` - Main game page (requires auth in production)
- `GET /idleclicker.html` - Idle clicker mode (requires auth in production)

## Data Model

### PlayerData Schema

```javascript
{
  userId: String,           // User ID from auth provider
  authProvider: String,     // 'discord' or 'raid'
  username: String,         // Display name
  
  // Progression
  level: Number,
  tier: Number,
  experience: Number,
  gold: Number,
  skillPoints: Number,
  
  // Combat
  health: Number,
  maxHealth: Number,
  attackPower: Number,
  
  // Skills
  skillTree: {
    maxHealth: Number,
    attackPower: Number,
    companionDamage: Number,
    goldMultiplier: Number,
    clickDamage: Number,
    healthRegen: Number
  },
  
  // Companions
  companions: [{
    type: String,
    level: Number,
    lastAttackTime: Number
  }],
  
  // Statistics
  statistics: {
    totalKills: Number,
    totalDeaths: Number,
    monstersDefeated: Number,
    pvpKills: Number,
    pvpDeaths: Number,
    totalGoldEarned: Number,
    totalDamageDealt: Number,
    totalDamageTaken: Number,
    highestLevel: Number,
    highestTier: Number,
    playTimeSeconds: Number
  },
  
  // Timestamps
  lastLogin: Date,
  lastSave: Date,
  createdAt: Date,
  updatedAt: Date
}
```

## Save/Load Flow

### On Player Join

1. Player authenticates via Discord or raid.gamernight.net
2. Session is created with user information
3. Player joins game room
4. `spawnPlayer()` is called
5. Player data is loaded from database
6. Player entity is populated with saved data
7. Player is registered for auto-save

### During Gameplay

1. Auto-save runs every 30 seconds (configurable)
2. Player data is validated before saving
3. Save operations are throttled (minimum 5 seconds between saves)
4. Race conditions are prevented with active save tracking

### On Player Disconnect

1. Player is unregistered from auto-save
2. Final save is performed (forced, bypasses throttling)
3. Player is removed from room
4. Session persists for 7 days

## Security Features

### Authentication Security

- **Passport.js**: Industry-standard authentication
- **Session secrets**: Configurable via environment variables
- **Rate limiting**: 5 authentication attempts per 15 minutes
- **HTTPS enforcement**: In production mode
- **Secure cookies**: HttpOnly, SameSite=Lax

### Data Security

- **Input validation**: All player data is validated before saving
- **MongoDB injection prevention**: Mongoose schema validation
- **Session storage**: MongoDB-backed, not in-memory
- **Helmet.js**: Security headers for Express

### Game Security

- **Server-authoritative**: All game logic runs on server
- **Input validation**: Client inputs are validated
- **Anti-cheat**: Save data validation prevents tampering

## Troubleshooting

### Database Connection Issues

**Problem**: `MongoDB: Connection failed`

**Solutions**:
1. Ensure MongoDB is running: `brew services list` or `sudo systemctl status mongod`
2. Check connection string in `.env`
3. Verify MongoDB port (default: 27017)
4. Check firewall settings

### Discord OAuth2 Issues

**Problem**: `Discord OAuth2: Missing credentials`

**Solutions**:
1. Verify `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in `.env`
2. Check redirect URL matches Discord Developer Portal
3. Ensure application is not in development mode on Discord

### raid.gamernight.net Issues

**Problem**: `Raid Auth: Authentication failed`

**Solutions**:
1. Verify `RAID_API_URL` is correct
2. Check `RAID_API_KEY` if required
3. Ensure raid.gamernight.net API is accessible
4. Check network connectivity

### Save/Load Issues

**Problem**: Player data not saving

**Solutions**:
1. Check database connection
2. Verify player is authenticated
3. Check server logs for validation errors
4. Ensure auto-save manager is running

## Configuration

### config.json Settings

```json
{
  "persistence": {
    "enabled": true,
    "autoSaveInterval": 30000,
    "saveOnDisconnect": true,
    "loadOnConnect": true
  },
  "authentication": {
    "required": false,
    "allowGuests": true,
    "sessionDuration": 604800000
  }
}
```

### Environment Variables

- `MONGODB_URI`: MongoDB connection string
- `DISCORD_CLIENT_ID`: Discord application client ID
- `DISCORD_CLIENT_SECRET`: Discord application client secret
- `DISCORD_CALLBACK_URL`: Discord OAuth2 callback URL
- `RAID_API_URL`: raid.gamernight.net API endpoint
- `RAID_API_KEY`: raid.gamernight.net API key (if required)
- `SESSION_SECRET`: Secret for session encryption
- `NODE_ENV`: Environment mode (development/production)
- `PORT`: Server port (default: 3000)
- `AUTO_SAVE_INTERVAL`: Auto-save interval in milliseconds (default: 30000)

## Monitoring

### Server Logs

The system logs important events:

```
=== BashAttack Server Initialization ===
✓ Database connected
✓ Discord OAuth2 configured
✓ raid.gamernight.net integration configured
✓ Auto-save manager started
=== Server Ready ===
```

### Auto-Save Logs

```
AutoSaveManager: Registered client123 (discord:123456789)
AutoSaveManager: Saving 5 players...
SaveManager: Saved data for PlayerName - Level 10, Tier 2, Gold 5000
AutoSaveManager: Save cycle complete
```

### Authentication Logs

```
Discord OAuth2: Authenticating user PlayerName (123456789)
SaveManager: Loaded data for PlayerName - Level 10, Tier 2, Gold 5000
Authenticated connection: PlayerName (discord)
```

## Future Enhancements

- [ ] Leaderboards (already implemented in PlayerData model)
- [ ] Account linking (Discord + raid.gamernight.net)
- [ ] Data export/import
- [ ] Backup system
- [ ] Admin dashboard
- [ ] Player statistics API
- [ ] Achievement system
- [ ] Cloud save synchronization

## Support

For issues or questions:
1. Check server logs for error messages
2. Verify environment configuration
3. Ensure all dependencies are installed
4. Check MongoDB connection
5. Review this documentation

## License

Same as the main project (MIT)