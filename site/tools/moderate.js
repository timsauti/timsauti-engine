// Review robot: checks reader stories and Scam Radar reports waiting in Supabase, publishes the good ones as pages, declines the rest
// with a short reason, and handles removal requests. Runs on GitHub every 30 minutes. Does nothing until the keys are set.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { SUPABASE_URL: SU, SUPABASE_SERVICE_KEY: SK, GEMINI_API_KEY: GK } = process.env;
if (!SU || !SK || !GK) { console.log('community not switched on yet (keys missing)'); process.exit(0); }
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'content-type': 'application/json' };
const db = async (p, o) => { const r = await fetch(`${SU}/rest/v1/${p}`, Object.assign({ headers: H }, o || {})); const t = await r.text(); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const patch = (tbl, id, body) => db(`${tbl}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: Object.assign({ Prefer: 'return=minimal' }, H) });
const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
async function gemini(prompt, image) {
  const parts = [{ text: prompt }]; if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.b64 } });
  for (const m of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GK }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }), signal: AbortSignal.timeout(90000) });
      const j = await r.json(); const t = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((x) => x.text || '').join('');
      if (t) return JSON.parse(t);
    } catch (e) { /* try next */ }
  }
  return null;
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const scrub = (s) => String(s).replace(/(\+?254|0)\s?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}/g, '07xx xxx xxx').replace(/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|co\.ke|ke|xyz|top|click|link|info|online|site|ly|me)\S*/gi, '[link removed]').replace(/\b\d{6,}\b/g, '[number removed]');

const RULES = `You are the strict editor of Tech na Pesa, a Kenyan website about tech, money, hustles and scams. A reader submitted the story below.
APPROVE only if ALL are true: it is a coherent first hand experience, lesson or practical tip about money, work, hustles, technology or scams in Kenya; written in English; at least 80 words; not copied from a news site.
DECLINE if ANY is true: it names, accuses or exposes a private individual (public institutions and companies may be named factually); it contains phone numbers, ID numbers or addresses; it advertises a business, links, referral codes, betting, forex or crypto signals, pyramid or investment schemes promising returns; hate, tribal or political incitement, insults; sexual content; graphic violence, the dead or injured; anything about a child that is not wholesome; medical claims; clearly false or misleading financial claims; spam or nonsense.
If approving, you may fix spelling and obvious grammar ONLY, keeping the writer's words and voice. Split the body into paragraphs. Write a one sentence summary (dek) in the writer's spirit, no new facts. Never add facts.
No dashes or hyphens as punctuation in anything you write.
Return JSON {"approve":true|false,"reason":"short polite reason if declined, written to the writer","title":"fixed title","dek":"one sentence","paragraphs":["..."],"question":"a natural, specific question for readers about the story, not asking them to like or share"}`;

async function stories() {
  const rows = await db('stories?status=eq.pending&select=*&order=created_at.asc&limit=15');
  for (const s of rows) {
    const prof = (await db(`profiles?id=eq.${s.author}&select=display_name,county`))[0] || {};
    let image = null;
    if (s.image_path) { try { const r = await fetch(`${SU}/storage/v1/object/public/story-images/${s.image_path}`); const buf = Buffer.from(await r.arrayBuffer()); image = { buf, mime: r.headers.get('content-type') || 'image/jpeg', b64: buf.toString('base64') }; } catch (e) {} }
    const v = await gemini(`${RULES}\n\nSECTION: ${s.category}\nTITLE: ${s.title}\nSTORY:\n${s.body}`);
    if (!v) { console.log('no verdict, will retry', s.id); continue; }
    let ok = v.approve === true && Array.isArray(v.paragraphs) && v.paragraphs.length > 0, reason = v.reason || 'Your story did not meet our community rules.';
    let useImage = false;
    if (ok && image) {
      const iv = await gemini('This photo was sent with a reader story to a public Kenyan news website. Is it safe and suitable? Fail it if it shows: readable phone numbers or ID numbers, a child\'s face, nudity, violence, the dead or injured, a weapon, a hateful symbol, or if it is a meme, a screenshot of someone else\'s post, or a watermarked stock photo. Return JSON {"ok":true|false,"why":"few words"}', image);
      useImage = !!(iv && iv.ok === true);
    }
    if (!ok) { await patch('stories', s.id, { status: 'rejected', reason: scrub(reason).slice(0, 300), reviewed_at: new Date().toISOString() }); console.log('declined', s.id); continue; }
    const slug = slugify(v.title || s.title) + '-' + s.id.slice(0, 6);
    const rec = { slug, title: (v.title || s.title).trim(), dek: v.dek || '', body: v.paragraphs.map(scrub), q: v.question || '', author: prof.display_name || 'A reader', county: prof.county || s.county || '', date: new Date().toISOString().slice(0, 10), cat: s.category, id: s.id, author_key: require('crypto').createHash('sha1').update(s.author).digest('hex').slice(0, 6) };
    if (useImage) { const ext = /png/.test(image.mime) ? 'png' : /webp/.test(image.mime) ? 'webp' : 'jpg'; fs.mkdirSync(path.join(ROOT, 'static', 'img', 'community'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'static', 'img', 'community', slug + '.' + ext), image.buf); rec.photo = `img/community/${slug}.${ext}`; }
    // profile photo: shown beside the writer's stories once it passes a quick check
    const prof2 = (await db(`profiles?id=eq.${s.author}&select=avatar_path`))[0] || {};
    if (prof2.avatar_path) {
      try {
        const ar = await fetch(`${SU}/storage/v1/object/public/avatars/${prof2.avatar_path}`); const abuf = Buffer.from(await ar.arrayBuffer()); const amime = ar.headers.get('content-type') || 'image/jpeg';
        const av = await gemini('This is a profile photo a reader chose for a public Kenyan community website. Is it suitable? Fail it if it shows nudity, violence, a weapon, a hateful symbol, readable phone or ID numbers, or a child alone as the main subject. A normal adult portrait, a group of adults, a logo or a picture of an object or place is fine. Return JSON {"ok":true|false}', { mime: amime, b64: abuf.toString('base64') });
        if (av && av.ok === true) { const ext = /png/.test(amime) ? 'png' : /webp/.test(amime) ? 'webp' : 'jpg'; fs.mkdirSync(path.join(ROOT, 'static', 'img', 'avatars'), { recursive: true }); for (const e of ['png', 'jpg', 'webp']) try { fs.unlinkSync(path.join(ROOT, 'static', 'img', 'avatars', rec.author_key + '.' + e)); } catch (x) {} fs.writeFileSync(path.join(ROOT, 'static', 'img', 'avatars', rec.author_key + '.' + ext), abuf); rec.avatar = `img/avatars/${rec.author_key}.${ext}`; }
      } catch (e) {}
    }
    fs.mkdirSync(path.join(ROOT, 'content', 'community'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'content', 'community', slug + '.json'), JSON.stringify(rec, null, 1));
    await patch('stories', s.id, { status: 'approved', slug, reviewed_at: new Date().toISOString() });
    console.log('approved', slug);
  }
  // removal requests: take the page down (files are kept out of the site, the row is marked removed)
  for (const s of await db('stories?status=eq.removal_requested&select=id,slug')) {
    if (s.slug) for (const f of [path.join(ROOT, 'content', 'community', s.slug + '.json')].concat(['png', 'jpg', 'webp'].map((e) => path.join(ROOT, 'static', 'img', 'community', s.slug + '.' + e))).concat(['cards', 'og'].map((d) => path.join(ROOT, 'static', 'img', d, s.slug + '.png')))) try { fs.unlinkSync(f); } catch (e) {}
    await patch('stories', s.id, { status: 'removed', reviewed_at: new Date().toISOString() }); console.log('removed', s.id);
  }
}

async function reports() {
  for (const r of await db('scam_reports?status=eq.pending&select=*&order=created_at.asc&limit=30')) {
    const v = await gemini(`A reader of a Kenyan scam awareness website reported this message as a scam:\n"""${r.message}"""\nDecide if it is plausibly a scam or fraud attempt aimed at Kenyans (not spam about the website, not abuse, not a real person's private chat). If yes, produce a public version: replace every phone number with 07xx xxx xxx, every personal name with [name], every link with [link removed], every account or till number with [number removed]; keep the rest word for word. Give a short kind label such as "Fake reversal", "Fake job", "Prize scam", "Loan scam", "Fake customer care", "Investment scam", "Phishing link". Return JSON {"scam":true|false,"kind":"...","public_text":"..."}`);
    if (!v) continue;
    if (v.scam === true && v.public_text) await patch('scam_reports', r.id, { status: 'approved', kind: String(v.kind || 'Reported scam').slice(0, 40), public_text: scrub(v.public_text).slice(0, 1200) });
    else await patch('scam_reports', r.id, { status: 'rejected' });
  }
}

(async () => { await stories(); await reports(); console.log('review done'); })().catch((e) => { console.log('review error: ' + String(e.message).slice(0, 200)); process.exit(1); });
