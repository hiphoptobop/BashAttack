'use strict';
// MongoDB connection manager with graceful error handling and reconnection logic

const mongoose = require('mongoose');

let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY = 5000; // 5 seconds

// Connection options for production-ready setup
const connectionOptions = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

/**
 * Connect to MongoDB with retry logic
 * @returns {Promise<boolean>} True if connected, false otherwise
 */
async function connect() {
    if (isConnected) {
        console.log('MongoDB: Already connected');
        return true;
    }

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bashattack';

    try {
        console.log('MongoDB: Attempting connection...');
        await mongoose.connect(mongoUri, connectionOptions);
        isConnected = true;
        connectionAttempts = 0;
        console.log('MongoDB: Connected successfully');
        
        // Set up connection event handlers
        setupEventHandlers();
        
        return true;
    } catch (error) {
        connectionAttempts++;
        console.error(`MongoDB: Connection failed (attempt ${connectionAttempts}/${MAX_RETRY_ATTEMPTS}):`, error.message);
        
        if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
            console.log(`MongoDB: Retrying in ${RETRY_DELAY / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return connect();
        } else {
            console.error('MongoDB: Max retry attempts reached. Running without persistence.');
            return false;
        }
    }
}

/**
 * Set up MongoDB connection event handlers
 */
function setupEventHandlers() {
    mongoose.connection.on('disconnected', () => {
        console.log('MongoDB: Disconnected');
        isConnected = false;
    });

    mongoose.connection.on('error', (error) => {
        console.error('MongoDB: Error:', error.message);
        isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
        console.log('MongoDB: Reconnected');
        isConnected = true;
    });
}

/**
 * Disconnect from MongoDB gracefully
 * @returns {Promise<void>}
 */
async function disconnect() {
    if (!isConnected) {
        return;
    }

    try {
        await mongoose.connection.close();
        isConnected = false;
        console.log('MongoDB: Disconnected gracefully');
    } catch (error) {
        console.error('MongoDB: Error during disconnect:', error.message);
    }
}

/**
 * Check if MongoDB is connected
 * @returns {boolean}
 */
function isDbConnected() {
    return isConnected && mongoose.connection.readyState === 1;
}

/**
 * Get the mongoose instance for direct access if needed
 * @returns {mongoose}
 */
function getMongoose() {
    return mongoose;
}

module.exports = {
    connect,
    disconnect,
    isDbConnected,
    getMongoose
};

// Made with Bob
