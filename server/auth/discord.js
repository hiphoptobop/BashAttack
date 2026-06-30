'use strict';
// Discord OAuth2 authentication strategy

const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const PlayerData = require('../database/models/PlayerData');

function buildDiscordAvatarUrl(profile) {
    if (!profile || !profile.id || !profile.avatar) {
        return null;
    }
    return 'https://cdn.discordapp.com/avatars/' + profile.id + '/' + profile.avatar + '.png';
}

/**
 * Configure Discord OAuth2 strategy
 */
function configureDiscordAuth() {
    const clientID = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const callbackURL = process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';

    if (!clientID || !clientSecret) {
        console.warn('Discord OAuth2: Missing credentials. Discord authentication will be disabled.');
        return false;
    }

    passport.use(new DiscordStrategy({
        clientID: clientID,
        clientSecret: clientSecret,
        callbackURL: callbackURL,
        scope: ['identify', 'email']
    },
    async function(accessToken, refreshToken, profile, done) {
        try {
            // Extract user information from Discord profile
            const userId = profile.id;
            const username = profile.username;
            
            console.log(`Discord OAuth2: Authenticating user ${username} (${userId})`);
            
            // Find or create player data
            const playerData = await PlayerData.findOrCreate(userId, 'discord', username);
            
            // Create session user object
            const user = {
                id: playerData._id.toString(),
                userId: userId,
                username: username,
                authProvider: 'discord',
                avatarUrl: buildDiscordAvatarUrl(profile),
                discordProfile: {
                    discriminator: profile.discriminator,
                    avatar: profile.avatar,
                    email: profile.email
                }
            };
            
            return done(null, user);
        } catch (error) {
            console.error('Discord OAuth2: Authentication error:', error);
            return done(error, null);
        }
    }));

    console.log('Discord OAuth2: Strategy configured');
    return true;
}

/**
 * Serialize user for session storage
 */
passport.serializeUser(function(user, done) {
    done(null, {
        id: user.id,
        userId: user.userId,
        username: user.username,
        authProvider: user.authProvider,
        avatarUrl: user.avatarUrl || null
    });
});

/**
 * Deserialize user from session storage
 */
passport.deserializeUser(function(sessionUser, done) {
    done(null, sessionUser);
});

module.exports = {
    configureDiscordAuth
};

// Made with Bob
