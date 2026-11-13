// Opportunity Desk by hand (for checks): node oppdesk/run.js probe | dry
// probe: reads every source and prints which ones answer and what passes the first sieve. Sends nothing, saves nothing.
// dry:   the whole morning search, printed here instead of sent to Telegram. Saves nothing.
// The real daily run is started by the main agent (agent/run.js) through engine.tick().
'use strict';
const E = require('./engine');
const mode = process.argv[2] || process.env.MODE || 'probe';
(async () => {
  const S = { seen: {}, items: [], inbox: [], health: {}, days: {} }; const P = E.PROFILE();
  if (mode === 'probe') {
    const { all } = await E.collect(S, console.log);
    const by = {}; for (const a of all) (by[a.source] = by[a.source] || []).push(a);
    for (const k of Object.keys(by)) console.log(`\n== ${k}\n` + by[k].slice(0, 3).map((x) => `  - ${x.title} | ${x.date ? new Date(x.date).toISOString().slice(0, 10) : 'no date'} | ${x.link.slice(0, 110)}`).join('\n'));
    const c = E.sieve(all, S, P); console.log(`\nPASSED THE FIRST SIEVE: ${c.length} of ${all.length}\n` + c.slice(0, 60).map((x) => `  * [${x.source}] ${x.title}`).join('\n'));
  } else {
    const out = []; const tg = { send: async (t, rows) => { out.push(t + (rows ? '\n[buttons: ' + rows[0].map((b) => b[0]).join(' | ') + ']' : '')); return 1; } };
    await E.scan(S, { tg, ask: E.__ask, log: console.log }).catch((e) => console.log('SCAN ERROR: ' + e.message));
    console.log('\n======== WHAT WOULD BE SENT ========\n' + out.join('\n\n--------\n\n'));
    if (process.env.DRAFT_FIRST === '1' && S.items[0]) { const d = await E.draft(S.items[0], P, E.__ask); console.log('\n======== SAMPLE DRAFT ========\nSubject: ' + d.subject + '\n\n' + d.letter + '\n\nATTACH: ' + d.attach.join('; ') + '\nGAPS: ' + d.gaps.join('; ') + '\nVIEW: ' + d.advice); }
  }
})().catch((e) => { console.log('ERROR: ' + e.message); process.exit(1); });
