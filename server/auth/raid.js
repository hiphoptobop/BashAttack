'use strict';
// raid.gamernight.net custom authentication integration

const axios = require('axios');
const PlayerData = require('../database/models/PlayerData');

const RAID_API_URL = process.env.RAID_API_URL || 'https://raid.gamernight.net/api';
const RAID_API_KEY = process.env.RAID_API_KEY;

/**
 * Verify raid.gamernight.net authentication token
 * @param {String} token - Authentication token from raid.gamernight.net
 * @returns {Promise<Object|null>} User data or null if invalid
 */
async function verifyRaidToken(token) {
    if (!token) {
        return null;
    }

    try {
        // Make request to raid.gamernight.net API to verify token
        const response = await axios.post(`${RAID_API_URL}/auth/verify`, {
            token: token
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': RAID_API_KEY || ''
            },
            timeout: 5000
        });

        if (response.data && response.data.valid) {
            return {
                userId: response.data.userId,
                username: response.data.username,
                email: response.data.email
            };
        }

        return null;
    } catch (error) {
        console.error('Raid Auth: Token verification failed:', error.message);
        return null;
    }
}

/**
 * Authenticate user with raid.gamernight.net credentials
 * @param {String} username - Username
 * @param {String} password - Password
 * @returns {Promise<Object|null>} User data and token or null if invalid
 */
async function authenticateRaidUser(username, password) {
    if (!username || !password) {
        return null;
    }

    try {
        // Make request to raid.gamernight.net API to authenticate
        const response = await axios.post(`${RAID_API_URL}/auth/login`, {
            username: username,
            password: password
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': RAID_API_KEY || ''
            },
            timeout: 5000
        });

        if (response.data && response.data.success) {
            return {
                userId: response.data.userId,
                username: response.data.username,
                token: response.data.token,
                email: response.data.email
            };
        }

        return null;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('Raid Auth: Invalid credentials for user:', username);
        } else {
            console.error('Raid Auth: Authentication failed:', error.message);
        }
        return null;
    }
}

/**
 * Handle raid.gamernight.net login and create/update player data
 * @param {String} username - Username
 * @param {String} password - Password
 * @returns {Promise<Object|null>} Session user object or null
 */
async function handleRaidLogin(username, password) {
    try {
        // Authenticate with raid.gamernight.net
        const raidUser = await authenticateRaidUser(username, password);
        
        if (!raidUser) {
            return null;
        }

        console.log(`Raid Auth: Authenticating user ${raidUser.username} (${raidUser.userId})`);

        // Find or create player data
        const playerData = await PlayerData.findOrCreate(
            raidUser.userId,
            'raid',
            raidUser.username
        );

        // Create session user object
        const user = {
            id: playerData._id.toString(),
            userId: raidUser.userId,
            username: raidUser.username,
            authProvider: 'raid',
            raidToken: raidUser.token,
            raidProfile: {
                email: raidUser.email
            }
        };

        return user;
    } catch (error) {
        console.error('Raid Auth: Login error:', error);
        return null;
    }
}

/**
 * Handle raid.gamernight.net token-based authentication
 * @param {String} token - Authentication token
 * @returns {Promise<Object|null>} Session user object or null
 */
async function handleRaidTokenAuth(token) {
    try {
        // Verify token with raid.gamernight.net
        const raidUser = await verifyRaidToken(token);
        
        if (!raidUser) {
            return null;
        }

        console.log(`Raid Auth: Token authentication for user ${raidUser.username} (${raidUser.userId})`);

        // Find or create player data
        const playerData = await PlayerData.findOrCreate(
            raidUser.userId,
            'raid',
            raidUser.username
        );

        // Create session user object
        const user = {
            id: playerData._id.toString(),
            userId: raidUser.userId,
            username: raidUser.username,
            authProvider: 'raid',
            raidToken: token,
            raidProfile: {
                email: raidUser.email
            }
        };

        return user;
    } catch (error) {
        console.error('Raid Auth: Token authentication error:', error);
        return null;
    }
}

/**
 * Check if raid.gamernight.net integration is configured
 * @returns {Boolean}
 */
function isRaidConfigured() {
    return !!RAID_API_URL;
}

module.exports = {
    verifyRaidToken,
    authenticateRaidUser,
    handleRaidLogin,
    handleRaidTokenAuth,
    isRaidConfigured
};

// Made with Bob
