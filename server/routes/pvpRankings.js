'use strict';
// PvP Rankings API routes
// GET /api/pvp/rankings          — returns this week's top 10 per tier (all tiers)
// GET /api/pvp/rankings?tier=2   — returns top 10 for tier 2 only
// GET /api/pvp/rankings?week=2025-22 — historical week lookup

const express = require('express');
const router = express.Router();
const PvpWeeklyStats = require('../database/models/PvpWeeklyStats');
const { isDbConnected } = require('../database/connection');

// How many tiers to return when no specific tier is requested
const MAX_TIERS = 10;

router.get('/', async function(req, res) {
    if (!isDbConnected()) {
        return res.status(503).json({ error: 'Database unavailable' });
    }

    try {
        var weekKey = req.query.week || PvpWeeklyStats.currentWeekKey();
        var requestedTier = req.query.tier ? parseInt(req.query.tier, 10) : null;

        if (requestedTier) {
            // Single tier
            var entries = await PvpWeeklyStats.getLeaderboard(requestedTier, weekKey, 10);
            return res.json({ weekKey, tier: requestedTier, entries });
        }

        // All tiers — find which tiers have data this week then fetch each
        var tiersWithData = await PvpWeeklyStats.distinct('tier', { weekKey });
        tiersWithData.sort(function(a, b) { return a - b; });
        if (tiersWithData.length > MAX_TIERS) {
            tiersWithData = tiersWithData.slice(0, MAX_TIERS);
        }

        var results = await Promise.all(
            tiersWithData.map(function(tier) {
                return PvpWeeklyStats.getLeaderboard(tier, weekKey, 10)
                    .then(function(entries) { return { tier, entries }; });
            })
        );

        return res.json({ weekKey, tiers: results });
    } catch (err) {
        console.error('Rankings API error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
