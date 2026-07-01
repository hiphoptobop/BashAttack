'use strict';
// Authentication middleware for Express routes and Socket.IO connections

const rateLimit = require('express-rate-limit');

/**
 * Middleware to check if user is authenticated
 * Redirects to login page if not authenticated
 */
function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    
    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    // For page requests, redirect to login
    res.redirect('/login.html');
}

/**
 * Middleware to check if user is authenticated (for API routes)
 * Returns 401 JSON response if not authenticated
 */
function requireAuthAPI(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    
    res.status(401).json({ error: 'Authentication required' });
}

/**
 * Middleware to pass through if authenticated, otherwise continue
 * Useful for optional authentication
 */
function optionalAuth(req, res, next) {
    // Just continue regardless of auth status
    next();
}

/**
 * Socket.IO middleware to authenticate connections
 * Checks session for authenticated user
 */
function socketAuthMiddleware(socket, next) {
    const session = socket.request.session;
    
    if (!session) {
        console.log('Socket connection rejected: No session');
        return next(new Error('Authentication required'));
    }
    
    // Check if user is authenticated in session
    if (session.passport && session.passport.user) {
        socket.user = session.passport.user;
        console.log(`Socket authenticated: ${socket.user.username} (${socket.user.authProvider})`);
        return next();
    }
    
    // Allow unauthenticated connections in development mode
    if (process.env.NODE_ENV === 'development') {
        console.log('Socket connection allowed (development mode, no auth)');
        socket.user = null;
        return next();
    }
    
    console.log('Socket connection rejected: Not authenticated');
    return next(new Error('Authentication required'));
}

/**
 * Socket.IO middleware for optional authentication
 * Allows connections but attaches user if authenticated
 */
function socketOptionalAuthMiddleware(socket, next) {
    const session = socket.request.session;
    
    if (session && session.passport && session.passport.user) {
        socket.user = session.passport.user;
        console.log(`Socket authenticated: ${socket.user.username} (${socket.user.authProvider})`);
    } else {
        socket.user = null;
        console.log('Socket connection (unauthenticated)');
    }
    
    next();
}

/**
 * Create rate limiter for authentication endpoints
 * Prevents brute force attacks
 */
function createAuthRateLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 requests per window
        message: 'Too many authentication attempts, please try again later',
        standardHeaders: true,
        legacyHeaders: false,
    });
}

/**
 * Middleware to attach user info to request for logging
 */
function attachUserInfo(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.userInfo = {
            id: req.user.id,
            username: req.user.username,
            authProvider: req.user.authProvider
        };
    } else {
        req.userInfo = null;
    }
    next();
}

/**
 * Get user from socket connection
 * @param {Socket} socket - Socket.IO socket
 * @returns {Object|null} User object or null
 */
function getUserFromSocket(socket) {
    return socket.user || null;
}

/**
 * Check if socket is authenticated
 * @param {Socket} socket - Socket.IO socket
 * @returns {Boolean}
 */
function isSocketAuthenticated(socket) {
    return !!(socket.user && socket.user.id);
}

module.exports = {
    requireAuth,
    requireAuthAPI,
    optionalAuth,
    socketAuthMiddleware,
    socketOptionalAuthMiddleware,
    createAuthRateLimiter,
    attachUserInfo,
    getUserFromSocket,
    isSocketAuthenticated
};

// Made with Bob
