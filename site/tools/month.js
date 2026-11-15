// Story of the Month: in the first days of each month, picks last month's best rated reader story (at least 5 ratings),
// records it for the website and tells the owner on Telegram so he can send the KSh 500 prize. Never pays anyone itself.
'use strict';
const fs = require('fs'), path = require('path');
const { SUPABASE_URL: SU, SUPABASE_SERVICE_KEY: SK, TELEGRAM_BOT_TOKEN: TG, TELEGRAM_OWNER_ID: TO } = process.env;
const F = path.join(__dirname, '..', 'content', 'data', 'winners.json');
if (!SU || !SK) { console.log('prize: community not switched on yet'); process.exit(0); }
const H = { apikey: SK, Authorization: 'Bearer ' + SK };
const eat = new Date(Date.now() + 3 * 3600e3), day = eat.getUTCDate();
const prev = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - 1, 1)), month = prev.toISOString().slice(0, 7);
const start = month + '-01T00:00:00+03:00', end = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1)).toISOString().slice(0, 10) + 'T00:00:00+03:00';
const list = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : [];
if (day > 5 || list.some((w) => w.month === month)) { console.log('prize: nothing to do'); process.exit(0); }
const tell = (text) => TG && TO ? fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TO, text }) }).catch(() => {}) : null;
(async () => {
  const q = async (p) => (await fetch(`${SU}/rest/v1/${p}`, { headers: H })).json();
  const stories = await q(`stories?status=eq.approved&reviewed_at=gte.${encodeURIComponent(start)}&reviewed_at=lt.${encodeURIComponent(end)}&select=id,slug,title,author`);
  if (!Array.isArray(stories) || !stories.length) { list.push({ month, none: true }); fs.writeFileSync(F, JSON.stringify(list, null, 1)); await tell(`Tech na Pesa Story of the Month for ${month}: no reader stories were published, so there is no winner and no prize to pay.`); return; }
  const stats = await q(`rating_stats?slug=in.(${stories.map((s) => s.slug).join(',')})&select=slug,avg,n`);
  const likes = await q(`like_counts?slug=in.(${stories.map((s) => s.slug).join(',')})&select=slug,n`);
  const L = Object.fromEntries((likes || []).map((x) => [x.slug, x.n]));
  const ranked = (stats || []).filter((x) => x.n >= 5).sort((a, b) => b.avg - a.avg || b.n - a.n || (L[b.slug] || 0) - (L[a.slug] || 0));
  if (!ranked.length) { list.push({ month, none: true }); fs.writeFileSync(F, JSON.stringify(list, null, 1)); await tell(`Tech na Pesa Story of the Month for ${month}: no story reached 5 ratings, so there is no winner this month.`); return; }
  const top = ranked[0], s = stories.find((x) => x.slug === top.slug);
  const file = path.join(__dirname, '..', 'content', 'community', top.slug + '.json'); const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  let email = ''; try { const u = await (await fetch(`${SU}/auth/v1/admin/users/${s.author}`, { headers: H })).json(); email = u.email || ''; } catch (e) {}
  list.push({ month, slug: top.slug, title: s.title, author: rec.author || '', county: rec.county || '', avg: Number(top.avg), n: top.n, prize: 500 });
  fs.writeFileSync(F, JSON.stringify(list, null, 1));
  await tell(`Tech na Pesa Story of the Month for ${month}\n\n"${s.title}"\nBy ${rec.author || 'a reader'}${rec.county ? ', ' + rec.county : ''}\nRated ${top.avg} stars by ${top.n} readers.\n\nWinner's email: ${email || 'not found'}\nPlease contact them to confirm their M-PESA number, then send the KSh 500 prize yourself. The website already shows them as the winner.`);
  console.log('prize: winner chosen for ' + month);
})().catch((e) => { console.log('prize error: ' + String(e.message).slice(0, 120)); });
