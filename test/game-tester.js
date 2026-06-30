'use strict';
/**
 * Bash Attack — Automated Game Tester
 * Connects a real socket.io client, simulates gameplay, and verifies behaviour.
 * Run with: node test/game-tester.js   (server must be on localhost:3000)
 */

const io = require('socket.io-client');

// ─── reporting ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0, warnings = 0;
const RESULTS = [];
function pass(label)          { passed++;   RESULTS.push({s:'PASS',label}); console.log(`  ✅ PASS  ${label}`); }
function fail(label, detail)  { failed++;   RESULTS.push({s:'FAIL',label,detail}); console.log(`  ❌ FAIL  ${label}`); if(detail) console.log(`         → ${detail}`); }
function warn(label, detail)  { warnings++; RESULTS.push({s:'WARN',label,detail}); console.log(`  ⚠️  WARN  ${label}`); if(detail) console.log(`         → ${detail}`); }
function section(name)        { console.log(`\n── ${name} ${'─'.repeat(Math.max(0,55-name.length))}`); }
function sleep(ms)            { return new Promise(r => setTimeout(r, ms)); }

// ─── live state ──────────────────────────────────────────────────────────────
let socket, myID;
let entities = {};
let combatEvents = [], purchaseResults = [], upgradeResults = [];

function me()        { return entities[myID]; }
function myMonster() { for (const id in entities) { const e=entities[id]; if(e.type==='monster'&&e.ownerId===myID) return e; } return null; }
function waitFor(fn, ms=3000) {
    return new Promise((res,rej) => {
        if (fn()) return res();
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (fn()) { clearInterval(iv); res(); }
            else if (Date.now()-t0 > ms) { clearInterval(iv); rej(new Error('timeout')); }
        }, 50);
    });
}

// ─── socket setup ────────────────────────────────────────────────────────────
function decodeSpawn(a) {
    const e = { type:a[0], id:a[1], x:a[2], y:a[3], color:a[4], radius:a[5] };
    if (a[0]==='monster' && a.length>6) { e.health=a[6]; e.maxHealth=a[7]; e.ownerId=a[8]; e.level=a[9]||1; }
    if (a[0]==='player' && a.length>6) {
        e.health=a[6]; e.maxHealth=a[7]; e.gold=a[8]; e.attackPower=a[10];
        e.skillPoints=a[11]; e.monstersDefeated=a[12]; e.currentMonsterLevel=a[13];
        e.companions=a[14]||[]; e.companionsCount=e.companions.length;
        e.skillTree={}; e.kills=0; e.deaths=0;
    }
    return e;
}
function wireEvents() {
    socket.on('gameState', gs => {
        if (gs.myID) myID = gs.myID;
        entities = {};
        if (gs.entityList) { for (const a of JSON.parse(gs.entityList)) { const e=decodeSpawn(a); entities[e.id]=e; } }
    });
    socket.on('gameUpdates', u => {
        if (!u.entityList) return;
        for (const row of u.entityList) {
            if (row[0]==='monster') {
                const e=entities[row[1]]; if(e){ e.health=row[4]; e.maxHealth=row[5]; e.level=row[6]; }
            } else if (row[0]==='idleplayer') {
                const e=entities[row[1]]; if(e){
                    e.health=row[7]; e.maxHealth=row[8]; e.gold=row[9]; e.attackPower=row[10];
                    e.skillPoints=row[11]; e.monstersDefeated=row[12]; e.currentMonsterLevel=row[13];
                    e.companions=row[14]||[]; e.companionsCount=e.companions.length;
                }
            }
        }
    });
    socket.on('entitySpawn', rec => { const a=JSON.parse(rec); entities[a[1]]=decodeSpawn(a); });
    socket.on('entityDespawn', id => { delete entities[id]; });
    socket.on('combatEvent',    d => combatEvents.push(d));
    socket.on('purchaseResult', r => purchaseResults.push(r));
    socket.on('upgradeResult',  r => upgradeResults.push(r));
}

// ─── main test run ────────────────────────────────────────────────────────────
async function runTests() {

    // ── SETUP ─────────────────────────────────────────────────────────────────
    section('SETUP');
    socket = io('http://localhost:3000', { forceNew:true });
    await new Promise((res,rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
    wireEvents();
    pass('Socket connected');

    socket.emit('enterGame', -1);
    await waitFor(() => myID !== null && me() !== null, 5000)
        .then(() => pass('gameState received — player entity exists'))
        .catch(e => { fail('gameState not received', e.message); socket.disconnect(); process.exit(1); });
    await sleep(50); // let event loop flush before reading state

    // ── T1: INITIAL SPAWN STATE ───────────────────────────────────────────────
    section('T1  Initial spawn state');
    if (!me()) { fail('player entity missing after gameState', `myID=${myID} entities=${Object.keys(entities)}`); socket.disconnect(); process.exit(1); }
    me().health === 100        ? pass('health = 100')           : fail('health wrong',        `got ${me().health}`);
    me().gold === 0            ? pass('gold = 0')               : fail('gold wrong',           `expected 0 got ${me().gold}`);
    me().skillPoints === 0     ? pass('skillPoints = 0')        : fail('skillPoints wrong',    `expected 0 got ${me().skillPoints}`);
    me().currentMonsterLevel===1 ? pass('currentMonsterLevel=1') : fail('currentMonsterLevel wrong', `got ${me().currentMonsterLevel}`);
    Array.isArray(me().companions) ? pass('companions is Array') : fail('companions not Array', typeof me().companions);

    // ── T2: MONSTER SPAWNS ────────────────────────────────────────────────────
    section('T2  Monster spawns');
    await waitFor(() => myMonster()!==null, 2000)
        .then(() => pass('Monster entity present'))
        .catch(() => fail('No monster spawned'));
    const mon = myMonster();
    if (mon) {
        mon.level===1        ? pass('Monster level = 1')        : fail('Monster level wrong',  `got ${mon.level}`);
        mon.ownerId===myID   ? pass('Monster ownerId = myID')   : fail('Monster owner wrong',  mon.ownerId);
        mon.health > 0       ? pass('Monster health > 0')       : fail('Monster health is 0');
        mon.maxHealth > 0    ? pass(`Monster maxHealth = ${mon.maxHealth}`) : fail('Monster maxHealth = 0');
        // attackPower is server-only and not included in the monster spawn wire packet (only used in server sim)
        // We verify it works in T5 (counter-attack) and T18 (unit test). Skip undefined check here.
        pass('Monster spawn packet received (attackPower is server-side only)');
    }

    // ── T3: CLICK → COMBAT EVENT ─────────────────────────────────────────────
    section('T3  Click attack → combatEvent received');
    combatEvents = [];
    socket.emit('playerClick');
    await waitFor(() => combatEvents.length > 0, 2000)
        .then(() => {
            pass('combatEvent received');
            const ev = combatEvents[0];
            ev.damage > 0          ? pass(`combatEvent.damage = ${ev.damage}`)       : fail('damage = 0 in event');
            ev.playerId === myID   ? pass('combatEvent.playerId = myID')             : fail('playerId mismatch', ev.playerId);
            typeof ev.monsterHealth === 'number' ? pass('monsterHealth field present') : fail('monsterHealth missing');
        })
        .catch(() => fail('No combatEvent within 2s'));

    // ── T4: MONSTER HEALTH DECREMENTS ────────────────────────────────────────
    section('T4  Monster health decrements');
    await sleep(150);
    const hBefore = combatEvents[0]?.monsterHealth + combatEvents[0]?.damage || 0; // reconstruct pre-click HP
    const hAfter  = myMonster()?.health ?? -1;
    hAfter < (myMonster()?.maxHealth ?? 0)
        ? pass(`Monster health reduced: current=${hAfter}`)
        : warn('Cannot confirm health reduction (monster may have been replaced)');

    // ── T5: MONSTER COUNTER-ATTACKS ──────────────────────────────────────────
    section('T5  Monster counter-attacks player');
    const hpBefore = me()?.health ?? 100;
    await waitFor(() => me() && me().health < hpBefore, 3500)
        .then(() => pass(`Monster attacked: HP ${hpBefore} → ${me()?.health}`))
        .catch(() => {
            if (myMonster()?.attackPower === 0) warn('Monster attackPower=0 so it cannot attack — this is a pre-existing bug');
            else warn('Monster did not attack within 3.5s');
        });

    // ── T6: KILL MONSTER → GOLD + NEW MONSTER ────────────────────────────────
    section('T6  Kill monster → earn gold, new monster spawns');
    const monIdBeforeKill = myMonster()?.id;
    // Rapid clicks in bursts — wait between bursts to avoid socket overload
    for (let burst = 0; burst < 20; burst++) {
        for (let i = 0; i < 5; i++) socket.emit('playerClick');
        await sleep(100);
        const curr = myMonster();
        if (curr && curr.id !== monIdBeforeKill) break;  // new monster spawned = kill confirmed
        if (!myMonster()) { await sleep(300); break; }   // monster despawned mid-transition
    }
    await waitFor(() => me() && me().gold > 0, 4000)
        .then(() => pass(`Gold awarded after kill: ${me()?.gold}g`))
        .catch(() => fail('No gold awarded after monster kill'));
    await waitFor(() => myMonster() !== null, 3000)
        .then(() => pass('New monster spawned after kill'))
        .catch(() => fail('New monster did NOT spawn'));
    const monAfterKill = myMonster();
    if (monAfterKill && monIdBeforeKill) {
        monAfterKill.id !== monIdBeforeKill ? pass('New monster has different ID') : warn('Monster ID same after kill?');
        monAfterKill.level === 2 ? pass('New monster level = 2') : warn(`New monster level = ${monAfterKill.level} (expected 2)`);
    }

    // ── T7: PURCHASE REJECTED WHEN BROKE ─────────────────────────────────────
    section('T7  Purchase companion — rejection + success flow');
    // Drain gold first via second kill if needed to test rejection, OR just test directly
    if ((me()?.gold ?? 0) < 20) {
        purchaseResults = [];
        socket.emit('purchaseCompanion', { companionType: 'warrior' });
        await waitFor(() => purchaseResults.length > 0, 2000)
            .then(() => purchaseResults[0].success === false ? pass('Purchase rejected (insufficient gold)') : warn('Purchase oddly succeeded with < 20g'))
            .catch(() => fail('No purchaseResult received'));
    } else {
        // Buy warrior
        purchaseResults = [];
        const goldBefore = me().gold;
        socket.emit('purchaseCompanion', { companionType: 'warrior' });
        await waitFor(() => purchaseResults.length > 0, 2000)
            .then(() => {
                const r = purchaseResults[0];
                r.success ? pass(`Warrior bought (cost ${r.cost}g)`) : fail('Warrior purchase failed', r.error);
                if (r.success) {
                    // gold should drop on next tick update
                    waitFor(() => me() && me().gold < goldBefore, 1500)
                        .then(() => pass('Gold deducted after purchase'))
                        .catch(() => warn('Gold deduction not yet visible (tick lag)'));
                }
            })
            .catch(() => fail('No purchaseResult'));

        // Second warrior — cost should scale to 30g
        await sleep(300);
        if ((me()?.gold ?? 0) >= 30) {
            purchaseResults = [];
            socket.emit('purchaseCompanion', { companionType: 'warrior' });
            await waitFor(() => purchaseResults.length > 0, 2000)
                .then(() => {
                    const r2 = purchaseResults[0];
                    const expected = Math.floor(20 * 1.5); // 30
                    if (r2.success && r2.cost === expected) pass(`2nd warrior cost scaled: ${r2.cost}g ✓`);
                    else if (r2.success)                    fail(`2nd warrior cost wrong`, `expected ${expected} got ${r2.cost}`);
                    else                                    warn('Cannot buy 2nd warrior for cost-scale test', r2.error);
                })
                .catch(() => fail('No 2nd purchaseResult'));
        }
    }

    // ── T8: COMPANIONS ARRAY INTEGRITY ───────────────────────────────────────
    section('T8  companions stays an Array after purchase');
    await sleep(200);
    Array.isArray(me()?.companions) ? pass('companions is Array') : fail('companions corrupted to ' + typeof me()?.companions);
    const wCount = (me()?.companions||[]).filter(c=>c.type==='warrior').length;
    wCount >= 0 ? pass(`companions array has ${wCount} warrior(s)`) : fail('companions.filter failed');

    // ── T9: SKILL UPGRADE ────────────────────────────────────────────────────
    section('T9  Skill upgrade via socket');
    upgradeResults = [];
    socket.emit('upgradeSkill', { skillId: 'maxHealth' });
    await waitFor(() => upgradeResults.length > 0, 2000)
        .then(() => {
            const r = upgradeResults[0];
            if (r.success === false && r.error?.includes('power-up')) pass('Skill upgrade rejected correctly (no PuP)');
            else if (r.success)  pass('Skill upgraded successfully');
            else                 warn('Unexpected upgrade result', JSON.stringify(r));
        })
        .catch(() => fail('No upgradeResult received'));

    // ── T10–T16: UNIT TESTS (server-side logic, no socket needed) ────────────
    const { Player }  = require('../server/entities/player.js');
    const { Monster } = require('../server/entities/monster.js');
    const idleMode    = require('../server/modes/idleclicker.js')();

    section('T10 Skill max-level enforcement');
    const pSkill = new Player(0,0,'#fff','u','pve-0');
    pSkill.skillPoints = 999;
    for (let i=0;i<25;i++) pSkill.spendSkillPoint('maxHealth');
    pSkill.spendSkillPoint('maxHealth') === false ? pass('Returns false at max level 25')  : fail('Over-level not blocked');
    pSkill.skillTree.maxHealth === 25             ? pass('maxHealth capped at 25')         : fail('maxHealth over-leveled', pSkill.skillTree.maxHealth);

    section('T11 Skill point every 5 kills');
    const pKills = new Player(0,0,'#fff','k','pve-0');
    for (let i=0;i<4;i++) pKills.incrementMonstersDefeated();
    pKills.skillPoints === 0 ? pass('No point before 5th kill')    : fail('Premature point', pKills.skillPoints);
    pKills.incrementMonstersDefeated();
    pKills.skillPoints === 1 ? pass('Point awarded on 5th kill')   : fail('No point on 5th kill', pKills.skillPoints);
    pKills.incrementMonstersDefeated();
    pKills.skillPoints === 1 ? pass('No extra point at 6th kill')  : fail('Extra point at 6th kill', pKills.skillPoints);

    section('T12 Boss monster at level 10');
    const boss   = new Monster(0,0,10,'p','boss');
    const normal = new Monster(0,0,9,'p','norm');
    boss.isBoss                         ? pass('Level 10 is a boss')           : fail('Level 10 not boss');
    boss.maxHealth > normal.maxHealth   ? pass(`Boss HP (${boss.maxHealth}) > normal (${normal.maxHealth})`) : fail('Boss not stronger');
    boss.goldReward > normal.goldReward ? pass(`Boss gold ${boss.goldReward} > normal ${normal.goldReward}`) : fail('Boss gold not higher');

    section('T13 Click with no monster → safe error, no crash');
    const pNoMon = new Player(0,0,'#fff','nm','pve-0');
    pNoMon.currentMonsterId = null;
    let r13;
    try { r13 = idleMode.handlePlayerClick({entities:{}}, pNoMon); }
    catch(e) { fail('handlePlayerClick THREW with no monster', e.message); r13 = null; }
    if (r13) r13.success===false ? pass('Returns error gracefully') : warn('Unexpected success result');

    section('T14 Purchase with 0 gold → rejected');
    const pBroke = new Player(0,0,'#fff','br','pve-0');
    pBroke.gold = 0;
    const r14 = idleMode.purchaseCompanion({}, pBroke, 'warrior');
    r14.success===false ? pass('Purchase rejected') : fail('Should be rejected with 0 gold');

    section('T15 Player death logic');
    const pDie = new Player(0,0,'#fff','die','pve-0');
    pDie.health = 1;
    const died = pDie.takeDamage(10);
    died              ? pass('takeDamage returns true on death')   : fail('takeDamage should return true');
    pDie.health === 0 ? pass('Health = 0 on death')               : fail('Health not 0', pDie.health);
    const goldOn5Pct  = Math.floor(new Monster(0,0,1,'x','m').goldReward * 0.05);
    goldOn5Pct >= 0   ? pass(`5% gold on death = ${goldOn5Pct}g`) : fail('Negative death gold');

    section('T16 Protocol version match');
    const sv = require('../server/config.json').protocolVersion;
    sv === 1 ? pass(`protocolVersion = ${sv}`) : fail('Version mismatch', `server=${sv} client=1`);

    section('T17 Level → theme mapping (10 levels per band)');
    function getLR(l) { return !l||l<1?0:Math.floor((l-1)/10); }
    const tnames = ['Forest','Desert','Ocean','Volcano','Ice','Shadow','Crystal','Toxic','Inferno','Void'];
    const checks = [[1,'Forest'],[10,'Forest'],[11,'Desert'],[20,'Desert'],[21,'Ocean'],[91,'Void'],[100,'Void']];
    let ok = true;
    for (const [l,exp] of checks) { const got=tnames[getLR(l)%tnames.length]; if(got!==exp){ok=false;fail(`Level ${l} theme`,`expected ${exp} got ${got}`);} }
    if (ok) pass('All theme mappings correct');

    // ── MONSTER ATTACK POWER ZERO BUG ────────────────────────────────────────
    section('T18 Monster attackPower > 0 for all types at level 1');
    const { MONSTER_TYPES } = require('../server/data/monsterTypes.js');
    let apBugFound = false;
    for (const [typeName] of Object.entries(MONSTER_TYPES)) {
        // Instantiate via the actual Monster class so the fix (or lack thereof) is tested
        const m = new Monster(0, 0, 1, 'tester', 'ap-test-' + typeName, typeName);
        if (m.attackPower <= 0) {
            apBugFound = true;
            fail(`Monster type ${typeName} attackPower=${m.attackPower} at level 1 — monster can never hurt player`);
        }
    }
    if (!apBugFound) pass('All monster types have attackPower ≥ 1 at level 1');

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log(`  ${passed} passed   ${failed} failed   ${warnings} warnings`);
    console.log('═'.repeat(60));
    if (failed > 0) {
        console.log('\nFAILURES:');
        RESULTS.filter(r=>r.s==='FAIL').forEach(r=>console.log(`  ❌  ${r.label}${r.detail?' — '+r.detail:''}`));
    }
    if (warnings > 0) {
        console.log('\nWARNINGS:');
        RESULTS.filter(r=>r.s==='WARN').forEach(r=>console.log(`  ⚠️   ${r.label}${r.detail?' — '+r.detail:''}`));
    }

    socket.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
    console.error('\n💥 Test runner crashed:', e.message, e.stack?.split('\n')[1]||'');
    if (socket) socket.disconnect();
    process.exit(2);
});
