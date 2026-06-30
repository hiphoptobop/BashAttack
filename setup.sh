#!/bin/bash

# BashAttack Setup Script
# This script helps set up the authentication and persistence system

set -e

echo "=================================="
echo "BashAttack Setup Script"
echo "=================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✓ Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✓ npm version: $(npm --version)"

# Check if MongoDB is installed
if ! command -v mongod &> /dev/null; then
    echo "⚠️  MongoDB is not installed or not in PATH."
    echo "   You can:"
    echo "   - Install MongoDB locally"
    echo "   - Use Docker: docker run -d -p 27017:27017 --name mongodb mongo:latest"
    echo "   - Use a cloud MongoDB service (MongoDB Atlas)"
    echo ""
else
    echo "✓ MongoDB is installed"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your credentials:"
    echo "   - MongoDB connection string"
    echo "   - Discord OAuth2 credentials (optional)"
    echo "   - raid.gamernight.net credentials (optional)"
    echo "   - Session secret (REQUIRED - change from default)"
    echo ""
else
    echo "✓ .env file already exists"
fi

# Check if MongoDB is running
echo ""
echo "Checking MongoDB connection..."
if command -v mongosh &> /dev/null; then
    if mongosh --eval "db.version()" --quiet &> /dev/null; then
        echo "✓ MongoDB is running and accessible"
    else
        echo "⚠️  MongoDB is not running or not accessible"
        echo "   Start MongoDB with: brew services start mongodb-community (macOS)"
        echo "   Or: sudo systemctl start mongod (Linux)"
        echo "   Or: docker run -d -p 27017:27017 --name mongodb mongo:latest (Docker)"
    fi
elif command -v mongo &> /dev/null; then
    if mongo --eval "db.version()" --quiet &> /dev/null; then
        echo "✓ MongoDB is running and accessible"
    else
        echo "⚠️  MongoDB is not running or not accessible"
    fi
else
    echo "⚠️  MongoDB client not found, skipping connection check"
fi

echo ""
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your credentials"
echo "2. Ensure MongoDB is running"
echo "3. Start the server: npm start"
echo "4. Open http://localhost:3000/login.html"
echo ""
echo "For more information, see AUTHENTICATION_PERSISTENCE_README.md"
echo ""

# Made with Bob
