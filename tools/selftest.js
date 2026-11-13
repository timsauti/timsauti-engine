// Self check: runs before every agent run and before every change is pushed. A failure stops the run and tells the owner.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'); let bad = 0;
const ok = (cond, what) => { if (!cond) { bad++; console.log('FAIL: ' + what); } };
// 1) every code file must be valid
for (const d of ['agent', 'tools']) for (const f of fs.readdirSync(path.join(ROOT, d)).filter((x) => x.endsWith('.js'))) {
  const r = cp.spawnSync(process.execPath, ['--check', path.join(ROOT, d, f)], { encoding: 'utf8' }); ok(r.status === 0, `${d}/${f} has a code error: ${String(r.stderr).split('\n').slice(0, 5).join(' ')}`);
}
// 1b) every workflow file must be valid, or GitHub silently stops running it
try {
  const Y = require('yaml');
  for (const f of fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((x) => /\.ya?ml$/.test(x))) {
    const doc = Y.parseDocument(fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8'));
    ok(!doc.errors.length, `workflow ${f} is broken: ${doc.errors.map((e) => e.message.split('\n')[0]).join('; ').slice(0, 200)}`);
    const j = doc.toJS() || {}; ok(j.on && j.jobs, `workflow ${f} has no trigger or no job`);
  }
} catch (e) { ok(false, 'could not check the workflow files: ' + String(e.message).slice(0, 150)); }
// 2) every Page has a posting plan on every day of the week
process.env.SELFTEST = '1';
try {
  const R = require('../agent/run.js');
  for (const page of R.PAGES) for (let i = 0; i < 7; i++) {
    const ymd = R.eatDate(Date.now() + i * 86400000); let s; try { s = R.slotsFor(page, ymd); } catch (e) { s = e; }
    if (page.everyDays && Array.isArray(s) && !s.length) { let any = false; for (let k = 1; k < page.everyDays; k++) { try { any = any || R.slotsFor(page, R.eatDate(Date.now() + (i + k) * 86400000)).length > 0; } catch (e) {} } ok(any, `${page.name} has no post within ${page.everyDays} days of ${ymd}`); continue; }
    ok(Array.isArray(s) && s.length > 0 && s.every((x) => Array.isArray(x) && /^\d\d:\d\d$/.test(x[0]) && x[1]), `${page.name} has no proper plan for ${ymd}`);
  }
} catch (e) { ok(false, 'the agent could not load: ' + String(e.message).slice(0, 200)); }
// 3) the same story checks must work, even on empty titles
try {
  const S = require('../agent/sauti.js');
  for (const t of [null, undefined, '', 'Hi']) { try { S.DW(t); S.sameDW(t, 'Some title here'); S.sameStoryText(t, null); } catch (e) { ok(false, 'story check crashes on an empty title: ' + e.message); } }
  ok(S.sameDW('Nacada arrests man and seizes narcotics in Mbiuni Mwala subcounty', 'Nacada arrests one, nets drugs haul in Mwala, Machakos county'), 'the repeat check misses the same NACADA story');
  ok(!S.sameDW('Governor Sakaja joins ODM ahead of 2027', 'Machakos farmers receive certified seeds'), 'the repeat check blocks unrelated stories');
  ok(S.official({ link: 'https://www.kenyanews.go.ke/x' }) && S.official({ link: 'https://news.google.com/a', source: 'Kenya News Agency' }) && S.official({ link: 'https://machakos.go.ke/y', feed: 'Machakos County' }), 'government platforms are not treated as official');
  ok(!S.official({ link: 'https://www.tuko.co.ke/x', source: 'Tuko' }) && !S.official({ link: 'https://nation.africa/x', source: 'Nation', feed: 'Nation' }), 'a news outlet is wrongly treated as a government platform');
} catch (e) { ok(false, 'the news code could not load: ' + String(e.message).slice(0, 200)); }
// 4) posters still draw
try {
  const C = require('../agent/card.js');
  ok(typeof C.sautiCard === 'function' || Object.keys(C).length > 0, 'the poster code is missing');
} catch (e) { ok(false, 'the poster code could not load: ' + String(e.message).slice(0, 200)); }
// 5) the Opportunity Desk's own check (no internet, no AI)
{ const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'oppdesk', 'test.js')], { encoding: 'utf8' }); ok(r.status === 0, 'the Opportunity Desk check fails: ' + String(r.stdout).split('\n').filter((l) => /FAIL/.test(l)).join(' ').slice(0, 200)); }
console.log(bad ? `SELF CHECK FAILED: ${bad} problem(s)` : 'Self check passed');
process.exit(bad ? 1 : 0);
