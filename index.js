// Entry point — Enhanced with authentication and persistence system
// Supports Discord OAuth2 and raid.gamernight.net authentication
// Includes MongoDB persistence for player data
// Auto-save system for continuous progress tracking

require('dotenv').config();

var express = require('express');
var compression = require('compression');
var http = require('http');
var path = require('path');
var { Server } = require('socket.io');
var session = require('express-session');
var MongoStore = require('connect-mongo');
var passport = require('passport');
var helmet = require('helmet');

var app = express();
var server = http.createServer(app);
var io = new Server(server);

// Database and authentication modules
var database = require('./server/database/connection');
var discordAuth = require('./server/auth/discord');
var raidAuth = require('./server/auth/raid');
var authMiddleware = require('./server/auth/middleware');
var { autoSaveManager } = require('./server/persistence/saveManager');

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for Socket.IO compatibility
    crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - use memory store for now (MongoDB session store will be added after DB connection)
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
});

app.use(sessionMiddleware);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Serve the raw client as-is — no bundler, no build step. The browser loads the
// individual <script> tags in client/play.html directly (chaochao's dev mode).
app.use(express.static(path.join(__dirname, 'client')));
// The shared movement integrator lives outside client/ because the server requires
// it too (shared/movement.js). Expose it at /shared so the client can <script> it.
app.use('/shared', express.static(path.join(__dirname, 'shared')));
// Art assets (backgrounds, monster sprites) live at the project root under Art/.
// Expose them at /Art so the client can load them without path traversal.
app.use('/Art', express.static(path.join(__dirname, 'Art')));

var utils = require('./server/utils.js');
var messenger = require('./server/messenger.js');
var hostess = require('./server/hostess.js');
var c = utils.loadConfig();

// Authentication routes
const authRateLimiter = authMiddleware.createAuthRateLimiter();

// Discord OAuth2 routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/login.html?error=discord_failed' }),
    function(req, res) {
        res.redirect('/play.html');
    }
);

// raid.gamernight.net routes
app.post('/auth/raid/login', authRateLimiter, async function(req, res) {
    try {
        const { username, password } = req.body;
        const user = await raidAuth.handleRaidLogin(username, password);
        
        if (user) {
            req.login(user, function(err) {
                if (err) {
                    console.error('Login error:', err);
                    return res.status(500).json({ success: false, error: 'Login failed' });
                }
                res.json({ success: true, user: { username: user.username } });
            });
        } else {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Raid login error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Logout route
app.post('/auth/logout', function(req, res) {
    req.logout(function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

// Auth status check
app.get('/api/auth/status', function(req, res) {
    if (req.isAuthenticated()) {
        res.json({
            authenticated: true,
            user: {
                username: req.user.username,
                authProvider: req.user.authProvider
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// PvP Rankings API
const pvpRankingsRouter = require('./server/routes/pvpRankings');
app.use('/api/pvp/rankings', pvpRankingsRouter);

// Protect game routes (optional - can be disabled for development)
if (process.env.NODE_ENV === 'production') {
    app.get('/play.html', authMiddleware.requireAuth);
    app.get('/idleclicker.html', authMiddleware.requireAuth);
}

// The server sleeps while empty: no clients means nothing to simulate, so the
// tick loop isn't even scheduled. The first connection wakes it; the last
// disconnect puts it back to sleep.
var serverSleeping = true,
    clientCount = 0,
    serverTickSpeed = c.serverTickSpeed,
    serverUpdates = null;

// Initialize database and authentication
async function initializeServer() {
    console.log('=== BashAttack Server Initialization ===');
    
    // Connect to MongoDB
    const dbConnected = await database.connect();
    if (dbConnected) {
        console.log('✓ Database connected');
    } else {
        console.warn('⚠ Database unavailable - running without persistence');
    }
    
    // Configure authentication strategies
    const discordConfigured = discordAuth.configureDiscordAuth();
    if (discordConfigured) {
        console.log('✓ Discord OAuth2 configured');
    } else {
        console.warn('⚠ Discord OAuth2 not configured');
    }
    
    if (raidAuth.isRaidConfigured()) {
        console.log('✓ raid.gamernight.net integration configured');
    } else {
        console.warn('⚠ raid.gamernight.net not configured');
    }
    
    // Start auto-save manager
    autoSaveManager.start();
    console.log('✓ Auto-save manager started');
    
    console.log('=== Server Ready ===');
}

// Start server
server.listen(c.port, async function () {
    console.log('listening on *:' + c.port);
    await initializeServer();
    messenger.build(io);
});

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// Optional authentication for Socket.IO connections
io.use(authMiddleware.socketOptionalAuthMiddleware);

io.on('connection', function (client) {
    const user = authMiddleware.getUserFromSocket(client);
    if (user) {
        console.log('Authenticated connection:', user.username, '(' + user.authProvider + ')');
    }
    checkForWake();
    clientCount++;
    messenger.addMailBox(client.id, client);

    client.on('disconnect', async function () {
        // Unregister from auto-save (saves on disconnect)
        await autoSaveManager.unregister(client.id, true);
        
        hostess.kickFromRoom(client.id);
        messenger.removeMailBox(client.id);
        messenger.removeRoomMailBox(client.id);
        clientCount--;
        checkForSleep();
    });
    
    // Handle PvP attack requests from clients
    client.on('pvpAttack', function (data) {
        try {
            // Validate the request
            if (!data || !data.targetId) {
                console.log('Invalid pvpAttack request from ' + client.id);
                return;
            }
            
            // Get the player's current room using messenger's room mail list
            var roomSig = messenger.getRoomSigByClientId(client.id);
            if (!roomSig) {
                console.log('Player ' + client.id + ' not in a room');
                return;
            }
            
            var room = hostess.getRoomBySig(roomSig);
            if (!room) {
                console.log('Room not found: ' + roomSig);
                return;
            }
            
            // Only allow attacks in PvP rooms
            if (room.game.mode.name !== 'pvp') {
                console.log('Player ' + client.id + ' attempted attack in non-PvP room');
                return;
            }
            
            // The attacker's player ID is the same as their client ID
            var attackerId = client.id;
            
            // Verify attacker exists in the room
            if (!room.playerList[attackerId]) {
                console.log('Attacker not found in room: ' + attackerId);
                return;
            }
            
            // Handle the attack through the PvP mode
            var result = room.game.mode.handleAttack(room.game, attackerId, data.targetId);
            
            if (!result.success) {
                // Send error back to attacker only (don't broadcast failed attacks)
                client.emit('pvpAttackError', { error: result.error });
            }
            // Success case is already broadcast by the mode's handleAttack method
            
        } catch (error) {
            console.log('Error handling pvpAttack for ' + client.id + ': ' + error.message);
        }
    });
});

process.on('SIGINT', async function () {
    console.log('\nServer shutting down (Ctrl-C)');
    
    // Stop auto-save manager
    autoSaveManager.stop();
    console.log('Auto-save manager stopped');
    
    // Save all active players
    await autoSaveManager.saveAll();
    console.log('All player data saved');
    
    // Disconnect from database
    await database.disconnect();
    console.log('Database disconnected');
    
    process.exit();
});

// The fixed-timestep tick. getDT() yields the real seconds since the last tick,
// so the simulation is framed in real time; hostess fans the tick out to every
// live room (which simulates and broadcasts its snapshot).
function update() {
    if (serverSleeping) {
        return;
    }
    var dt = utils.getDT();
    hostess.updateRooms(dt);
}

function checkForWake() {
    if (serverSleeping) {
        console.log('Server wake');
        utils.getDT(); // reset the dt clock so the first tick isn't a huge delta
        serverSleeping = false;
        serverUpdates = setInterval(update, serverTickSpeed);
    }
}

function checkForSleep() {
    if (clientCount == 0) {
        console.log('Server sleep ZZZ..');
        serverSleeping = true;
        clearInterval(serverUpdates);
    }
}
