'use strict';
// PvpWeeklyStats — one document per player per tier per ISO week.
// "ISO week" key: "YYYY-WW" (e.g. "2025-22").  A new document is upserted
// the first time a player records a kill/death in a given week+tier bucket.
// The rankings API queries this collection filtered to the current week.

const mongoose = require('mongoose');

const pvpWeeklyStatsSchema = new mongoose.Schema({
    // Player identity (mirrors PlayerData identifiers)
    userId:       { type: String, required: true, index: true },
    authProvider: { type: String, required: true, enum: ['discord', 'raid'] },
    username:     { type: String, required: true, trim: true, maxlength: 50 },

    // Which tier bracket (1 = levels 1-10, 2 = 11-20, …)
    tier:         { type: Number, required: true, min: 1, index: true },

    // ISO week key "YYYY-WW" so weekly resets happen automatically
    weekKey:      { type: String, required: true, index: true },

    kills:        { type: Number, default: 0, min: 0 },
    deaths:       { type: Number, default: 0, min: 0 }
}, {
    collection: 'pvpweeklystats'
});

// Compound unique index: one doc per player+tier+week
pvpWeeklyStatsSchema.index(
    { userId: 1, authProvider: 1, tier: 1, weekKey: 1 },
    { unique: true }
);

// Index for leaderboard queries (tier + week, sorted by kills)
pvpWeeklyStatsSchema.index({ tier: 1, weekKey: 1, kills: -1 });

// Return the ISO week key for a given Date (or now).
// Week starts Monday per ISO 8601.
pvpWeeklyStatsSchema.statics.currentWeekKey = function(date) {
    var d = date ? new Date(date) : new Date();
    // Shift to the nearest Thursday (ISO week belongs to the year of its Thursday)
    var day = d.getUTCDay() || 7; // Sun=0 → 7
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-' + String(weekNum).padStart(2, '0');
};

// Atomically increment kills and/or deaths for a player+tier+week bucket.
// Creates the document if it doesn't exist yet (upsert).
pvpWeeklyStatsSchema.statics.record = async function(opts) {
    // opts: { userId, authProvider, username, tier, kills=0, deaths=0 }
    var weekKey = this.currentWeekKey();
    return this.findOneAndUpdate(
        { userId: opts.userId, authProvider: opts.authProvider,
          tier: opts.tier, weekKey: weekKey },
        {
            $inc:    { kills: opts.kills || 0, deaths: opts.deaths || 0 },
            $setOnInsert: { username: opts.username }
        },
        { upsert: true, new: true }
    );
};

// Return the top `limit` players for a given tier+week, sorted by K/D ratio
// (kills desc as primary, deaths asc as secondary tiebreaker).
pvpWeeklyStatsSchema.statics.getLeaderboard = async function(tier, weekKey, limit) {
    limit = limit || 10;
    var docs = await this.find({ tier: tier, weekKey: weekKey })
        .sort({ kills: -1, deaths: 1 })
        .limit(limit)
        .lean();

    return docs.map(function(d) {
        var kd = d.deaths === 0
            ? (d.kills > 0 ? d.kills : 0)
            : (d.kills / d.deaths);
        return {
            username: d.username,
            tier:     d.tier,
            kills:    d.kills,
            deaths:   d.deaths,
            kd:       Math.round(kd * 100) / 100
        };
    });
};

const PvpWeeklyStats = mongoose.model('PvpWeeklyStats', pvpWeeklyStatsSchema);
module.exports = PvpWeeklyStats;
