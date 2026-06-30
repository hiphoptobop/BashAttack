'use strict';
// Client-side authentication handler

/**
 * Toggle raid.gamernight.net login form visibility
 */
function toggleRaidForm() {
    const form = document.getElementById('raidLoginForm');
    if (form) {
        form.classList.toggle('show');
    }
}

/**
 * Show error message
 * @param {String} message - Error message to display
 */
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorElement.classList.remove('show');
        }, 5000);
    }
}

/**
 * Show loading state
 * @param {Boolean} show - Whether to show or hide loading
 */
function showLoading(show) {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        if (show) {
            loadingElement.classList.add('show');
        } else {
            loadingElement.classList.remove('show');
        }
    }
}

/**
 * Handle raid.gamernight.net login form submission
 * @param {Event} event - Form submit event
 */
async function handleRaidLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/auth/raid/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Redirect to game
            window.location.href = '/play.html';
        } else {
            showError(data.error || 'Login failed. Please check your credentials.');
            showLoading(false);
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Network error. Please try again.');
        showLoading(false);
    }
}

/**
 * Check authentication status on page load
 */
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.authenticated) {
            // User is already authenticated, redirect to game
            console.log('User already authenticated:', data.user.username);
            window.location.href = '/play.html';
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
    }
}

/**
 * Parse URL parameters
 * @returns {Object} URL parameters as key-value pairs
 */
function getUrlParams() {
    const params = {};
    const searchParams = new URLSearchParams(window.location.search);
    for (const [key, value] of searchParams) {
        params[key] = value;
    }
    return params;
}

/**
 * Handle authentication errors from URL parameters
 */
function handleAuthErrors() {
    const params = getUrlParams();
    
    if (params.error) {
        let errorMessage = 'Authentication failed';
        
        switch (params.error) {
            case 'discord_failed':
                errorMessage = 'Discord authentication failed. Please try again.';
                break;
            case 'raid_failed':
                errorMessage = 'raid.gamernight.net authentication failed. Please check your credentials.';
                break;
            case 'session_expired':
                errorMessage = 'Your session has expired. Please log in again.';
                break;
            case 'unauthorized':
                errorMessage = 'You must be logged in to access the game.';
                break;
            default:
                errorMessage = params.message || 'Authentication failed. Please try again.';
        }
        
        showError(errorMessage);
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        checkAuthStatus();
        handleAuthErrors();
    });
} else {
    checkAuthStatus();
    handleAuthErrors();
}

// Made with Bob
