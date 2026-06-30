# Testing Guide - Authentication & Persistence System

This guide provides step-by-step instructions for testing the authentication and persistence system.

## Prerequisites

Before testing, ensure:
- [ ] MongoDB is installed and running
- [ ] Dependencies are installed (`npm install`)
- [ ] `.env` file is configured
- [ ] Server starts without errors (`npm start`)

## Test Scenarios

### 1. Basic Server Startup

**Test**: Server initializes correctly

**Steps**:
1. Start the server: `npm start`
2. Check console output

**Expected Output**:
```
listening on *:3000
=== BashAttack Server Initialization ===
✓ Database connected
✓ Discord OAuth2 configured (or warning if not configured)
✓ raid.gamernight.net integration configured (or warning)
✓ Auto-save manager started
=== Server Ready ===
```

**Pass Criteria**: Server starts without errors, database connects successfully

---

### 2. Login Page Access

**Test**: Login page loads correctly

**Steps**:
1. Open browser to `http://localhost:3000/login.html`
2. Verify page loads

**Expected Result**:
- Login page displays with BashAttack logo
- "Login with Discord" button visible
- "Login with raid.gamernight.net" button visible
- Form fields hidden initially

**Pass Criteria**: Page loads without errors, all UI elements present

---

### 3. Discord OAuth2 Flow (If Configured)

**Test**: Discord authentication works

**Steps**:
1. Navigate to `http://localhost:3000/login.html`
2. Click "Login with Discord"
3. Authorize on Discord (if prompted)
4. Wait for redirect

**Expected Result**:
- Redirects to Discord authorization page
- After authorization, redirects back to `/play.html`
- Console shows: `Discord OAuth2: Authenticating user [username]`
- Console shows: `Authenticated connection: [username] (discord)`

**Pass Criteria**: Successfully authenticates and redirects to game

---

### 4. raid.gamernight.net Authentication (If Configured)

**Test**: raid.gamernight.net login works

**Steps**:
1. Navigate to `http://localhost:3000/login.html`
2. Click "Login with raid.gamernight.net"
3. Enter valid credentials
4. Click Login

**Expected Result**:
- Form expands to show username/password fields
- After submission, redirects to `/play.html`
- Console shows: `Raid Auth: Authenticating user [username]`
- Console shows: `Authenticated connection: [username] (raid)`

**Pass Criteria**: Successfully authenticates and redirects to game

---

### 5. Unauthenticated Access (Development Mode)

**Test**: Game works without authentication in development

**Steps**:
1. Ensure `NODE_ENV=development` in `.env`
2. Navigate directly to `http://localhost:3000/play.html`

**Expected Result**:
- Game loads successfully
- Player can join and play
- No authentication required

**Pass Criteria**: Game is accessible without login in development mode

---

### 6. New Player Data Creation

**Test**: New player data is created on first login

**Steps**:
1. Login with a new account (never used before)
2. Check server console
3. Check MongoDB database

**Expected Result**:
- Console shows: `Created new player data for [username]`
- Database contains new PlayerData document
- Player starts with default values (Level 1, 0 gold, etc.)

**Pass Criteria**: New player record created in database

**Verification**:
```bash
# Connect to MongoDB
mongosh bashattack

# Check player data
db.playerdata.find().pretty()
```

---

### 7. Player Data Loading

**Test**: Existing player data loads on login

**Steps**:
1. Login with an account that has existing data
2. Check server console
3. Verify player stats in game

**Expected Result**:
- Console shows: `Loading player data for [username]`
- Console shows: `Player data loaded successfully`
- Console shows: `Loaded data for [username] - Level X, Tier Y, Gold Z`
- Game displays correct player stats

**Pass Criteria**: Player data loads from database correctly

---

### 8. Auto-Save Functionality

**Test**: Player data auto-saves periodically

**Steps**:
1. Login and play for 60+ seconds
2. Make progress (gain gold, level up, etc.)
3. Watch server console

**Expected Result**:
- Every 30 seconds: `AutoSaveManager: Saving X players...`
- For each player: `SaveManager: Saved data for [username] - Level X, Tier Y, Gold Z`
- `AutoSaveManager: Save cycle complete`

**Pass Criteria**: Auto-save runs every 30 seconds, data is saved

---

### 9. Save on Disconnect

**Test**: Player data saves when disconnecting

**Steps**:
1. Login and play
2. Make some progress
3. Close browser tab or disconnect
4. Check server console

**Expected Result**:
- Console shows: `AutoSaveManager: Saving on disconnect for [clientId]`
- Console shows: `SaveManager: Saved data for [username]`
- Console shows: `AutoSaveManager: Unregistered [clientId]`

**Pass Criteria**: Data saves when player disconnects

---

### 10. Data Persistence Across Sessions

**Test**: Player data persists between sessions

**Steps**:
1. Login and play, note current stats (gold, level, etc.)
2. Disconnect/logout
3. Wait 10 seconds
4. Login again with same account
5. Verify stats match previous session

**Expected Result**:
- All stats (gold, level, tier, skills, companions) match previous session
- No data loss

**Pass Criteria**: All player data persists correctly

---

### 11. Multiple Players Simultaneously

**Test**: Multiple players can play and save simultaneously

**Steps**:
1. Open multiple browser windows/tabs
2. Login with different accounts in each
3. Play in all windows simultaneously
4. Check auto-save logs

**Expected Result**:
- All players can play without interference
- Auto-save shows: `AutoSaveManager: Saving X players...`
- Each player's data saves independently

**Pass Criteria**: Multiple players work correctly, no data conflicts

---

### 12. Database Connection Failure Handling

**Test**: Server handles database unavailability gracefully

**Steps**:
1. Stop MongoDB: `brew services stop mongodb-community` (or equivalent)
2. Start server: `npm start`
3. Try to login

**Expected Result**:
- Server starts with warning: `⚠ Database unavailable - running without persistence`
- Game still works (in development mode)
- No crashes or errors
- Data doesn't save (expected)

**Pass Criteria**: Server runs without database, no crashes

---

### 13. Invalid Credentials Handling

**Test**: Invalid login attempts are handled properly

**Steps**:
1. Navigate to login page
2. Try raid.gamernight.net login with invalid credentials
3. Check response

**Expected Result**:
- Error message displays: "Invalid credentials"
- No server crash
- Can retry login

**Pass Criteria**: Invalid credentials rejected gracefully

---

### 14. Session Persistence

**Test**: Sessions persist across server restarts

**Steps**:
1. Login to game
2. Note session cookie in browser
3. Stop server (Ctrl+C)
4. Restart server
5. Refresh game page

**Expected Result**:
- Session remains valid
- Player stays logged in
- No need to re-authenticate

**Pass Criteria**: Sessions persist in MongoDB

---

### 15. Graceful Shutdown

**Test**: Server shuts down cleanly, saving all data

**Steps**:
1. Have multiple players logged in and playing
2. Press Ctrl+C to stop server
3. Check console output

**Expected Result**:
```
Server shutting down (Ctrl-C)
Auto-save manager stopped
AutoSaveManager: Saving X players...
SaveManager: Saved data for [username1]
SaveManager: Saved data for [username2]
All player data saved
Database disconnected
```

**Pass Criteria**: All player data saved before shutdown

---

## Performance Tests

### 16. Save Performance

**Test**: Saves complete quickly

**Steps**:
1. Have 10+ players logged in
2. Trigger auto-save
3. Measure time

**Expected Result**:
- Save cycle completes in < 2 seconds
- No lag or performance issues

**Pass Criteria**: Saves are fast and non-blocking

---

### 17. Load Performance

**Test**: Player data loads quickly on join

**Steps**:
1. Login with account that has lots of data
2. Measure time from login to game start

**Expected Result**:
- Data loads in < 1 second
- Game starts immediately after load

**Pass Criteria**: Loading is fast and doesn't block gameplay

---

## Security Tests

### 18. Session Security

**Test**: Sessions are secure

**Steps**:
1. Login and inspect cookies in browser DevTools
2. Check cookie attributes

**Expected Result**:
- Cookie has `HttpOnly` flag
- Cookie has `SameSite=Lax`
- In production: Cookie has `Secure` flag

**Pass Criteria**: Session cookies are properly secured

---

### 19. Data Validation

**Test**: Invalid data is rejected

**Steps**:
1. Manually modify player data in MongoDB to invalid values
2. Try to save that player's data
3. Check logs

**Expected Result**:
- Console shows: `SaveManager: Invalid player data, save aborted`
- Invalid data is not saved
- Player data remains valid

**Pass Criteria**: Data validation prevents corruption

---

## Troubleshooting Common Issues

### Issue: "MongoDB: Connection failed"
**Solution**: Ensure MongoDB is running, check connection string in `.env`

### Issue: "Discord OAuth2: Missing credentials"
**Solution**: Add Discord credentials to `.env` or skip Discord testing

### Issue: "Player data not loading"
**Solution**: Check database connection, verify player exists in database

### Issue: "Auto-save not running"
**Solution**: Check server logs, ensure auto-save manager started

### Issue: "Session expired"
**Solution**: Sessions expire after 7 days, re-login required

---

## Test Checklist

Use this checklist to track testing progress:

- [ ] Server starts successfully
- [ ] Login page loads
- [ ] Discord OAuth2 works (if configured)
- [ ] raid.gamernight.net login works (if configured)
- [ ] Unauthenticated access works (dev mode)
- [ ] New player data created
- [ ] Existing player data loads
- [ ] Auto-save runs every 30 seconds
- [ ] Save on disconnect works
- [ ] Data persists across sessions
- [ ] Multiple players work simultaneously
- [ ] Database failure handled gracefully
- [ ] Invalid credentials rejected
- [ ] Sessions persist across restarts
- [ ] Graceful shutdown saves all data
- [ ] Save performance acceptable
- [ ] Load performance acceptable
- [ ] Session cookies secure
- [ ] Data validation works

---

## Reporting Issues

If you encounter issues during testing:

1. Check server console for error messages
2. Check browser console for client errors
3. Verify MongoDB is running and accessible
4. Check `.env` configuration
5. Review `AUTHENTICATION_PERSISTENCE_README.md`
6. Check MongoDB data: `mongosh bashattack` then `db.playerdata.find().pretty()`

---

## Success Criteria

The system is considered fully functional when:

✅ All 19 test scenarios pass
✅ No data loss occurs
✅ Performance is acceptable
✅ Security measures are in place
✅ Error handling is graceful
✅ Documentation is complete

---

**Last Updated**: 2026-06-20