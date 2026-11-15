// Once a day in the evening, posts the best new reader story on the Tech na Pesa Facebook Page with the writer's name.
// Safety: does nothing unless the Page is really named Tech na Pesa, and never posts the same story twice.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), GV = 'v26.0', PAGE_ID = '570910356269659';
const { FB_USER_TOKEN: UT, SITE_URL, SUPABASE_URL: SU, SUPABASE_ANON_KEY: AK } = process.env;
const F = path.join(ROOT, 'content', 'data', 'featured.json');
const mask = (s) => String(s || '').replace(/EAA[A-Za-z0-9]{10,}/g, 'EAA***').replace(/access_token=[^&"\s]+/g, 'access_token=***');
const eat = new Date(Date.now() + 3 * 3600e3), today = eat.toISOString().slice(0, 10), hour = eat.getUTCHours();
const done = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : [];
if (!UT) { console.log('feature: no Facebook key'); process.exit(0); }
if (!process.env.FORCE && (hour < 18 || hour > 21 || done.some((d) => d.date === today))) { console.log('feature: not the time'); process.exit(0); }
(async () => {
  const acc = await (await fetch(`https://graph.facebook.com/${GV}/me/accounts?limit=100&fields=id,name,access_token`, { headers: { Authorization: 'Bearer ' + UT } })).json();
  const pg = (acc.data || []).find((x) => x.id === PAGE_ID);
  if (!pg) { console.log('feature: page not reachable ' + mask(JSON.stringify(acc.error || '')).slice(0, 120)); return; }
  if (!/^tech na pesa$/i.test(String(pg.name).trim())) { console.log('feature: page is not yet named Tech na Pesa, waiting'); return; }
  const dir = path.join(ROOT, 'content', 'community');
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
  const fresh = all.filter((s) => !done.some((d) => d.slug === s.slug) && Date.now() - Date.parse(String(s.date).slice(0, 10)) < 8 * 864e5);
  if (!fresh.length) { console.log('feature: no new reader story'); return; }
  let score = {};
  if (SU && AK) { try { const h = { apikey: AK, Authorization: 'Bearer ' + AK }; const sl = fresh.map((s) => s.slug).join(','); for (const [v, w] of [['like_counts', 1], ['rating_stats', 2], ['comment_counts', 1]]) for (const x of await (await fetch(`${SU}/rest/v1/${v}?slug=in.(${sl})&select=slug,n`, { headers: h })).json()) score[x.slug] = (score[x.slug] || 0) + x.n * w; } catch (e) {} }
  fresh.sort((a, b) => (score[b.slug] || 0) - (score[a.slug] || 0) || String(b.date).localeCompare(a.date));
  const s = fresh[0], url = (SITE_URL || '').replace(/\/$/, '') + `/community/${s.slug}/`;
  const first = (s.body || []).find((x) => typeof x === 'string') || s.dek || '';
  const caption = `From our Readers' Desk\n\n${s.title}\n\nBy ${s.author}${s.county ? ', ' + s.county : ''}\n\n${first}\n\nRead the full story, rate it and share your own on our website:\n${url}\n\n${s.q || 'Has something like this happened to you?'}`;
  const img = path.join(ROOT, 'static', 'img', 'og', s.slug + '.png'); if (!fs.existsSync(img)) { console.log('feature: no poster yet'); return; }
  const fd = new FormData(); fd.append('source', new Blob([fs.readFileSync(img)], { type: 'image/png' }), 'poster.png'); fd.append('caption', caption);
  const r = await fetch(`https://graph.facebook.com/${GV}/${PAGE_ID}/photos`, { method: 'POST', headers: { Authorization: 'Bearer ' + pg.access_token }, body: fd }); const j = await r.json();
  if (!r.ok) { console.log('feature: Facebook refused ' + mask(JSON.stringify(j.error || j)).slice(0, 160)); return; }
  done.push({ date: today, slug: s.slug, post: j.post_id || j.id }); fs.writeFileSync(F, JSON.stringify(done, null, 1)); console.log('feature: posted ' + s.slug);
})().catch((e) => console.log('feature error: ' + mask(e.message).slice(0, 120)));
