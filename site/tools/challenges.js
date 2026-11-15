// Challenges robot: copies challenge dates to the database, reviews entries, publishes approved entries as vote pages,
// tells the owner about sponsor enquiries, and at the close of voting records the result and alerts the owner on Telegram.
// It never pays anyone: prizes are handed over by the owner or the sponsor.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const { SUPABASE_URL: SU, SUPABASE_SERVICE_KEY: SK, GEMINI_API_KEY: GK, TELEGRAM_BOT_TOKEN: TG, TELEGRAM_OWNER_ID: TO } = process.env;
if (!SU || !SK) { console.log('challenges: community not switched on yet'); process.exit(0); }
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'content-type': 'application/json' };
const db = async (p, o) => { const r = await fetch(`${SU}/rest/v1/${p}`, Object.assign({ headers: H }, o || {})); const t = await r.text(); if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status + ' ' + t.slice(0, 160)); return t ? JSON.parse(t) : null; };
const patch = (tbl, q, body) => db(`${tbl}?${q}`, { method: 'PATCH', body: JSON.stringify(body), headers: Object.assign({ Prefer: 'return=minimal' }, H) });
const tell = (text) => TG && TO ? fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TO, text }) }).catch(() => {}) : null;
async function gemini(prompt, image) {
  if (!GK) return null;
  const parts = [{ text: prompt }]; if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.b64 } });
  for (const m of ['gemini-flash-latest', 'gemini-flash-lite-latest']) {
    try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GK }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }), signal: AbortSignal.timeout(90000) }); const j = await r.json(); const t = j.candidates && j.candidates[0].content.parts.map((x) => x.text || '').join(''); if (t) return JSON.parse(t); } catch (e) {}
  }
  return null;
}
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const scrub = (s) => String(s).replace(/(\+?254|0)\s?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}/g, '07xx xxx xxx').replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]');
const CH = path.join(ROOT, 'content', 'challenges'), EN = path.join(ROOT, 'content', 'entries');
const challenges = fs.existsSync(CH) ? fs.readdirSync(CH).filter((f) => f.endsWith('.json')).map((f) => Object.assign({ _file: path.join(CH, f) }, JSON.parse(fs.readFileSync(path.join(CH, f), 'utf8')))).filter((c) => c.status !== 'draft') : [];

async function sync() {
  if (!challenges.length) return;
  await db('challenges', { method: 'POST', body: JSON.stringify(challenges.map((c) => ({ slug: c.slug, title: c.title, opens: c.opens, entries_close: c.entriesClose, voting_closes: c.votingCloses }))), headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, H) });
  // judges: only the scrambled code (hash) is ever stored; the codes themselves go privately to the owner
  const jrows = []; for (const c of challenges) for (const j of c.judges || []) if (j.codeHash) jrows.push({ challenge: c.slug, judge_name: j.name, code_hash: j.codeHash });
  if (jrows.length) await db('challenge_judges', { method: 'POST', body: JSON.stringify(jrows), headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, H) });
}

async function review() {
  for (const e of await db('entries?status=eq.pending&select=*&order=created_at.asc&limit=20')) {
    const c = challenges.find((x) => x.slug === e.challenge); if (!c) continue;
    let image = null;
    if (e.image_path) { try { const r = await fetch(`${SU}/storage/v1/object/public/story-images/${e.image_path}`); const buf = Buffer.from(await r.arrayBuffer()); image = { buf, mime: r.headers.get('content-type') || 'image/jpeg', b64: buf.toString('base64') }; } catch (x) {} }
    const v = await gemini(`You review entries for a public Kenyan online competition called "${c.title}". The brief: ${c.brief}
APPROVE if the entry genuinely answers the brief, is the entrant's own work, and is suitable for all ages. DECLINE if it is off topic, spam, copied, advertising, hateful, sexual, violent, shows the dead or injured, exposes a private person, contains phone numbers, or (for a photo) is a meme, a screenshot of someone else's post, or a watermarked stock image. A child may appear only in a wholesome family or school setting and never as the main subject alone.
You may fix spelling only. No dashes as punctuation. Return JSON {"approve":true|false,"reason":"short polite reason to the entrant if declined","title":"...","paragraphs":["..."]}
TITLE: ${e.title}
DESCRIPTION: ${e.description}`, image);
    if (!v) continue;
    if (v.approve !== true || (c.needsPhoto && !image)) { await patch('entries', `id=eq.${e.id}`, { status: 'rejected', reason: scrub(v.reason || (c.needsPhoto ? 'This challenge needs a photo of your work.' : 'Your entry did not meet the challenge rules.')).slice(0, 300), reviewed_at: new Date().toISOString() }); console.log('entry declined'); continue; }
    const prof = (await db(`profiles?id=eq.${e.author}&select=display_name,county,avatar_path,avatar_ok`))[0] || {};
    const key = crypto.createHash('sha1').update(e.author).digest('hex').slice(0, 6);
    const slug = slugify(v.title || e.title) + '-' + e.id.slice(0, 6);
    const rec = { slug, id: e.id, challenge: c.slug, title: (v.title || e.title).trim(), body: (v.paragraphs || [e.description]).map(scrub), author: prof.display_name || 'Entrant', county: prof.county || '', author_key: key, date: new Date().toISOString() };
    fs.mkdirSync(path.join(ROOT, 'static', 'img', 'entries'), { recursive: true });
    if (image) { const ext = /png/.test(image.mime) ? 'png' : /webp/.test(image.mime) ? 'webp' : 'jpg'; fs.writeFileSync(path.join(ROOT, 'static', 'img', 'entries', slug + '.' + ext), image.buf); rec.photo = `img/entries/${slug}.${ext}`; }
    if (prof.avatar_ok && prof.avatar_path) { try { const r = await fetch(`${SU}/storage/v1/object/public/avatars/${prof.avatar_path}`); const ext = /png/.test(r.headers.get('content-type') || '') ? 'png' : 'jpg'; fs.mkdirSync(path.join(ROOT, 'static', 'img', 'avatars'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'static', 'img', 'avatars', key + '.' + ext), Buffer.from(await r.arrayBuffer())); rec.avatar = `img/avatars/${key}.${ext}`; } catch (x) {} }
    fs.mkdirSync(EN, { recursive: true }); fs.writeFileSync(path.join(EN, slug + '.json'), JSON.stringify(rec, null, 1));
    await patch('entries', `id=eq.${e.id}`, { status: 'approved', slug, reviewed_at: new Date().toISOString() }); console.log('entry approved ' + slug);
  }
  for (const e of await db('entries?status=eq.withdrawn&slug=not.is.null&select=id,slug')) {
    for (const f of [path.join(EN, e.slug + '.json')].concat(['png', 'jpg', 'webp'].map((x) => path.join(ROOT, 'static', 'img', 'entries', e.slug + '.' + x))).concat(['cards', 'og'].map((d) => path.join(ROOT, 'static', 'img', d, e.slug + '.png')))) try { fs.unlinkSync(f); } catch (x) {}
    await patch('entries', `id=eq.${e.id}`, { slug: null }); console.log('entry withdrawn');
  }
}

async function leads() {
  for (const l of await db('sponsor_leads?notified=is.false&select=*&limit=20')) {
    await tell(`New sponsor enquiry for Tech na Pesa challenges\n\nCompany: ${l.company}\nContact: ${l.contact_name}\nPhone or email: ${l.phone_or_email}\n\n${l.message || ''}`);
    await patch('sponsor_leads', `id=eq.${l.id}`, { notified: true }); console.log('lead sent to owner');
  }
}

async function close() {
  for (const c of challenges) {
    if (c.result || Date.now() < Date.parse(c.votingCloses)) continue;
    const counts = await db(`vote_counts?challenge=eq.${c.slug}&select=entry_id,n&order=n.desc`);
    const entries = await db(`entries?challenge=eq.${c.slug}&status=eq.approved&select=id,slug,title,author`);
    const V = Object.fromEntries(counts.map((x) => [x.entry_id, x.n]));
    const crit = c.criteria && c.criteria.length ? c.criteria : null, judges = (c.judges || []).filter((x) => x.codeHash);
    const scores = judges.length ? await db(`scores?challenge=eq.${c.slug}&select=entry_id,judge_name,criterion,score`) : [];
    const maxV = Math.max(1, ...entries.map((e) => V[e.id] || 0)), w = judges.length ? (c.voteWeight == null ? 0.3 : c.voteWeight) : 1;
    const judgeScore = (id) => { // average over judges of the weighted criteria, as 0 to 100
      const by = {}; for (const r of scores.filter((x) => x.entry_id === id)) (by[r.judge_name] = by[r.judge_name] || {})[r.criterion] = r.score;
      const per = Object.values(by).map((m) => { let t = 0, ws = 0; for (const k of (crit || Object.keys(m).map((n) => ({ name: n, weight: 1 })))) if (m[k.name] != null) { t += m[k.name] * k.weight; ws += k.weight; } return ws ? t / ws * 10 : null; }).filter((x) => x != null);
      return per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0;
    };
    const ranked = entries.map((e) => { const n = V[e.id] || 0, J = judgeScore(e.id), P = n / maxV * 100; return { e, n, J: Math.round(J), final: Math.round((1 - w) * J + w * P) }; }).sort((a, b) => b.final - a.final || b.n - a.n);
    const pc = entries.map((e) => ({ e, n: V[e.id] || 0 })).sort((a, b) => b.n - a.n)[0];
    if (!ranked.length || (!judges.length && !ranked[0].n)) { c.result = { closed: new Date().toISOString(), none: true }; }
    else {
      const top = ranked[0], votes = await db(`votes?challenge=eq.${c.slug}&entry_id=eq.${top.e.id}&select=user_id`);
      const ids = votes.map((v) => v.user_id); const profs = ids.length ? await db(`profiles?id=in.(${ids.join(',')})&select=id,created_at`) : [];
      const fresh = profs.filter((p) => Date.parse(p.created_at) > Date.parse(c.opens)).length;
      const mail = async (a) => { try { const u = await (await fetch(`${SU}/auth/v1/admin/users/${a}`, { headers: H })).json(); return u.email || ''; } catch (x) { return ''; } };
      c.result = { closed: new Date().toISOString(), method: judges.length ? `judges ${Math.round((1 - w) * 100)}%, public votes ${Math.round(w * 100)}%` : 'public votes', top: ranked.slice(0, 5).map((r) => ({ slug: r.e.slug, votes: r.n, judges: r.J, final: r.final })), winner: top.e.slug, peoplesChoice: pc && pc.n ? pc.e.slug : null, verified: false };
      await tell(`Challenge closed: ${c.title}\n\nWinner (subject to your check): "${top.e.title}", final score ${top.final}/100 (judges ${top.J}, ${top.n} votes).\nWinner's email: ${await mail(top.e.author)}\n\nPeople's Choice: ${pc && pc.n ? '"' + pc.e.title + '" with ' + pc.n + ' votes. Email: ' + await mail(pc.e.author) : 'none'}\n\nFraud check: ${fresh} of the winner's ${top.n} voters created their accounts after the challenge opened.\nPrize: ${c.prize || 'see challenge'}${c.peoplesPrize ? '; People\'s Choice: ' + c.peoplesPrize : ''}${c.sponsor ? '. Sponsored by ' + c.sponsor.name : ''}.\nArrange the prizes with the sponsor once you are satisfied.`);
    }
    const out = Object.assign({}, c); delete out._file; fs.writeFileSync(c._file, JSON.stringify(out, null, 1)); console.log('challenge closed ' + c.slug);
  }
}

(async () => { await sync(); await review(); await leads(); await close(); console.log('challenges done'); })().catch((e) => { console.log('challenges error: ' + String(e.message).slice(0, 160)); process.exit(1); });
