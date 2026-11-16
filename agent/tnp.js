// TECH na PESA link for the agent (runs hourly from .github/workflows/tnp-agent.yml).
// 1) Digital Growth: collects queued jobs from the platform, writes draft posts with designed graphics for staff to check,
//    and records every result or error back on the job. It never publishes to a client's Page.
// 2) Site sharing: when the owner has switched it on (Admin, Settings, social.share_mode = auto), shares new listings that
//    their owners allowed, and short promotions of the site's services, to the owner's Pages as link posts.
// Secrets come from the environment only and never reach the log. SELFTEST=1 writes sample drafts to data/tnp/selftest without touching anything.
'use strict';
const fs = require('fs'), path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');
const REF = process.env.SUPABASE_PROJECT_REF || 'kbaetbnzurntvhcqzihc';
const SB = `https://${REF}.supabase.co`;
const SITE = (process.env.TNP_SITE_URL || 'https://technapesa.pages.dev').replace(/\/$/, '');
const SELFTEST = process.env.SELFTEST === '1';
const PAUSED = fs.existsSync(path.join(ROOT, 'PAUSE'));
const GV = 'v26.0';
const FB_PAGES = { techpulse: { id: '570910356269659', mustBeNamed: /tech\s*na\s*pesa/i }, makasa: { id: '351919135654247' }, timsauti: { id: '394580017413619' }, sauti: { id: '1859768287449730' } };
const nowEAT = () => new Date(Date.now() + 3 * 3600000);
const mask = (s) => String(s || '').replace(/access_token=[^&"\s]+/g, 'access_token=***').replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***').replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'jwt***').replace(/sb_secret_[A-Za-z0-9_-]+/g, 'sb_secret_***');

// ---------- text rules (the same rules the agent follows on every Page) ----------
const BANNED = /\b(testament|whether|game[- ]?changer|unlock the power|delve|dive in|buckle up|revolutionise|supercharge|are you ready|in today's fast[- ]paced world)\b/i;
const BAIT = /\b(comment below|drop a comment|in the comments|tag (a|your)|share (this|with)|like (this|and share)|type (yes|amen))\b/i;
function clean(s) {
  return String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s*[–—]\s*/g, ', ').replace(/(\w)\s+-\s+(\w)/g, '$1, $2')
    .replace(/[ \t]+([.,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const ok = (s) => !BANNED.test(s) && !BAIT.test(s);

// ---------- Gemini (same free models as the agent) ----------
const MODELS = [process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
async function gemini(system, user) {
  let last;
  for (const m of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }) });
      const j = await r.json();
      if (!r.ok) { last = new Error('gemini ' + r.status); continue; }
      return JSON.parse(((j.candidates || [])[0].content.parts || []).map((x) => x.text || '').join('').replace(/^```json\s*|```\s*$/g, ''));
    } catch (e) { last = e; }
  }
  throw last || new Error('gemini unavailable');
}

// ---------- poster for client drafts (1080x1350, the agent's own fonts) ----------
const FONTS = path.join(ROOT, 'assets', 'fonts');
const FONT_OPTS = { fontFiles: fs.readdirSync(FONTS).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONTS, f)), loadSystemFonts: false, defaultFontFamily: 'Poppins' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLOURS = { teal: '#0d5c56', gold: '#d4a64a', navy: '#0b1d3a', blue: '#1565c0', green: '#1b7a43', red: '#b3261e', maroon: '#6d1b2a', purple: '#5a1f6f', pink: '#c2185b', orange: '#e0661b', yellow: '#f2c230', black: '#141414', brown: '#6b3e1f', grey: '#4a4f57', gray: '#4a4f57', white: '#ffffff' };
function palette(text) {
  const found = String(text || '').toLowerCase().match(/#[0-9a-f]{6}|[a-z]+/g) || [];
  const cols = found.map((w) => (w.startsWith('#') ? w : COLOURS[w])).filter((c) => c && c !== '#ffffff');
  return { bg: cols[0] || '#0b1d3a', accent: cols[1] || '#d4a64a' };
}
function measure(str, size, family, weight) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="0" y="200" font-family="${family}" font-size="${size}" font-weight="${weight}">${esc(str)}</text></svg>`;
  const bb = new Resvg(svg, { font: FONT_OPTS }).getBBox(); return bb ? bb.width : str.length * size * 0.55;
}
function wrap(text, size, maxW, family, weight) {
  const lines = []; let cur = '';
  for (const w of String(text).replace(/\s+/g, ' ').trim().split(' ')) { const t = cur ? cur + ' ' + w : w; if (!cur || measure(t, size, family, weight) <= maxW) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
}
function fit(text, maxW, maxH, family, weight, max = 104, min = 44) {
  for (let s = max; s >= min; s -= 4) { const l = wrap(text, s, maxW, family, weight); if (l.length * s * 1.15 <= maxH) return { s, l }; }
  const l = wrap(text, min, maxW, family, weight); return { s: min, l: l.slice(0, Math.floor(maxH / (min * 1.15))) };
}
function poster({ business, headline, sub, colours, photo }) {
  const W = 1080, H = 1350, p = palette(colours);
  // the client's own photo (owner rule: photos on posters where possible), darkened so the words stay readable
  const img = photo ? `<image href="data:${photo.type};base64,${photo.buf.toString('base64')}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${p.bg}" opacity="0.52"/><rect width="${W}" height="${H}" fill="#000000" opacity="0.2"/>` : '';
  const h = fit(String(headline || business).toUpperCase(), 900, 560, 'Montserrat', 900);
  const s = sub ? fit(sub, 880, 220, 'Poppins', 500, 44, 30) : null;
  const top = 380 + (560 - h.l.length * h.s * 1.15) / 2 + h.s;
  const hl = h.l.map((t, i) => `<text x="90" y="${top + i * h.s * 1.15}" font-family="Montserrat" font-weight="900" font-size="${h.s}" fill="#ffffff">${esc(t)}</text>`).join('');
  const sy = top + h.l.length * h.s * 1.15 + 40;
  const sl = s ? s.l.map((t, i) => `<text x="90" y="${sy + i * s.s * 1.3}" font-family="Poppins" font-weight="500" font-size="${s.s}" fill="#ffffff" opacity="0.9">${esc(t)}</text>`).join('') : '';
  const name = fit(business, 900, 70, 'Montserrat', 800, 46, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="#000000" stop-opacity="0.85"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="${p.bg}"/>${img || `<rect width="${W}" height="${H}" fill="url(#g)" opacity="0.55"/>`}
    <rect x="90" y="300" width="140" height="12" rx="6" fill="${p.accent}"/>
    ${hl}${sl}
    <rect x="0" y="${H - 170}" width="${W}" height="170" fill="#000000" opacity="0.28"/>
    <text x="90" y="${H - 72}" font-family="Montserrat" font-weight="800" font-size="${name.s}" fill="${p.accent}">${esc(name.l[0] || business)}</text>
  </svg>`;
  return new Resvg(svg, { font: FONT_OPTS, fitTo: { mode: 'width', value: W } }).render().asPng();
}

// ---------- platform access with the service key (fetched from Supabase at run time, never printed) ----------
let KEY = null;
async function serviceKey() {
  if (KEY) return KEY;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => []);
  const k = (Array.isArray(j) ? j : []).find((x) => x.name === 'service_role' || x.type === 'secret');
  if (!r.ok || !k || !k.api_key) throw new Error('could not get the platform key (' + r.status + ')');
  KEY = k.api_key; return KEY;
}
async function rest(p, opts = {}) {
  const k = await serviceKey();
  const r = await fetch(`${SB}/rest/v1/${p}`, Object.assign({}, opts, { signal: AbortSignal.timeout(60000),
    headers: Object.assign({ apikey: k, Authorization: 'Bearer ' + k, 'content-type': 'application/json', Prefer: 'return=representation' }, opts.headers || {}) }));
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) throw new Error('platform ' + r.status + ' ' + mask(typeof j === 'string' ? j : JSON.stringify(j)).slice(0, 200));
  return j;
}
async function upload(objectPath, png) {
  const k = await serviceKey();
  const r = await fetch(`${SB}/storage/v1/object/growth-assets/${objectPath}`, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { apikey: k, Authorization: 'Bearer ' + k, 'content-type': 'image/png', 'x-upsert': 'false' }, body: png });
  if (!r.ok) throw new Error('upload ' + r.status);
}
async function brandPhotos(clientId) {
  const k = await serviceKey();
  const r = await fetch(`${SB}/storage/v1/object/list/growth-assets`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { apikey: k, Authorization: 'Bearer ' + k, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: `${clientId}/brand/`, limit: 50 }) });
  const list = (await r.json().catch(() => [])).filter((f) => /\.(jpe?g|png)$/i.test(f.name || '') && !/logo/i.test(f.name) && (f.metadata || {}).size < 8e6);
  const out = [];
  for (const f of list.slice(0, 6)) {
    const g = await fetch(`${SB}/storage/v1/object/growth-assets/${clientId}/brand/${f.name}`, { headers: { apikey: k, Authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(60000) });
    if (g.ok) out.push({ buf: Buffer.from(await g.arrayBuffer()), type: /png$/i.test(f.name) ? 'image/png' : 'image/jpeg' });
  }
  return out;
}
const setting = async (key, dflt) => { const r = await rest(`site_settings?key=eq.${encodeURIComponent(key)}&select=value`); return r && r[0] ? r[0].value : dflt; };
const audit = (action, entity, id, after, note) => rest('audit_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ actor_kind: 'service', action, entity, entity_id: String(id), after: after || null, note: note || null }) });

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, o = process.env.TELEGRAM_OWNER_ID; if (!t || !o) return;
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: o, text: String(text).slice(0, 3900) }) }); } catch (e) {}
}

// ---------- 1) Digital Growth drafts ----------
const DRAFT_SYSTEM = `You write social media posts for a Kenyan small business, as its social media manager at TECH na PESA.
Rules:
- British English only. Warm, clear, specific to this business. No hype and no exaggerated claims.
- Use only facts in the brief. Never invent prices, offers, awards, customer names, testimonials, statistics, opening hours or results.
- Never ask people to comment, like, share, tag or type anything. End each caption with one natural, specific question, or with a simple way to reach the business (WhatsApp or call) if the brief gives a number.
- Plain text: no emojis, no hashtags except at most two at the very end, no bullet symbols, no dashes of any kind, no decorative punctuation.
- Never use these words: testament, whether, game changer, unlock, delve, dive in, buckle up, revolutionise, supercharge, are you ready.
- Each post covers a different angle: a product or service, a helpful tip for customers, behind the scenes, why choose the business, an upcoming offer only if the brief names one.
Return JSON: {"posts":[{"platform":"facebook","title":"calendar title, max 6 words","headline":"poster headline, max 7 words","sub":"poster sub line, max 14 words","caption":"the caption, 40 to 120 words"}]}`;

async function drafts(brief, count, instructions) {
  const plats = (brief.platforms && brief.platforms.length ? brief.platforms : ['facebook']);
  const user = `Business brief (JSON): ${JSON.stringify({ name: brief.business_name, category: brief.category, town: brief.town, county: brief.county, about: brief.description, products: brief.products, customers: brief.audience, goals: brief.objectives, offers_coming_up: brief.promotions })}
Write ${count} posts. Spread them across these platforms in turn: ${plats.join(', ')}.${instructions ? ' Staff instructions: ' + instructions : ''}`;
  let posts = [];
  for (let attempt = 0; attempt < 3 && posts.length < count; attempt++) {
    const out = await gemini(DRAFT_SYSTEM, user);
    for (const p of (out.posts || [])) {
      const caption = clean(p.caption), headline = clean(p.headline).replace(/[.!]+$/, ''), sub = clean(p.sub || '');
      if (caption.length < 40 || !ok(caption + ' ' + headline + ' ' + sub)) continue;
      posts.push({ platform: plats.includes(p.platform) ? p.platform : plats[posts.length % plats.length], title: clean(p.title).slice(0, 120) || headline.slice(0, 120), headline, sub, caption });
      if (posts.length >= count) break;
    }
  }
  return posts;
}

async function runJobs() {
  const jobs = await rest('agent_jobs?status=eq.queued&order=created_at.asc&limit=5&select=id,client_id,kind,payload,attempts');
  for (const j of jobs || []) {
    await rest(`agent_jobs?id=eq.${j.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', attempts: (j.attempts || 0) + 1, updated_at: new Date().toISOString() }) });
    try {
      let response;
      if (j.kind === 'content_request') {
        const c = (await rest(`growth_clients?id=eq.${j.client_id}&select=id,status,business_name,brand_colours`))[0];
        if (!c || !['approved', 'trial_active', 'subscribed'].includes(c.status)) response = { note: 'client not active; nothing written' };
        else {
          const count = Math.max(1, Math.min(10, Number(j.payload.count) || 3));
          const posts = await drafts(j.payload, count, j.payload.instructions || '');
          const ids = []; const start = nowEAT(); start.setUTCHours(12 - 3, 30, 0, 0);
          const photos = await brandPhotos(c.id).catch(() => []);
          for (let i = 0; i < posts.length; i++) {
            const p = posts[i];
            const png = poster({ business: c.business_name, headline: p.headline, sub: p.sub, colours: c.brand_colours, photo: photos.length ? photos[i % photos.length] : null });
            const file = `${c.id}/content/agent-${j.id}-${i + 1}.png`;
            await upload(file, png);
            const when = new Date(start.getTime() + (i + 1) * 2 * 86400000).toISOString();   // a suggestion: every second day at 12:30, staff can change it
            const row = (await rest('content_items', { method: 'POST', body: JSON.stringify({ client_id: c.id, platform: p.platform, title: p.title, caption: p.caption, media_paths: [file], scheduled_for: when, status: 'draft', source: 'agent' }) }))[0];
            ids.push(row.id);
          }
          response = { drafts: ids.length, content_items: ids };
          if (ids.length) await telegram(`TECH na PESA: the agent wrote ${ids.length} draft post${ids.length > 1 ? 's' : ''} for ${c.business_name}. Check them in Admin, Digital Growth, then send them to the client.`);
        }
      } else {
        response = { note: 'recorded by the agent; no automatic action for ' + j.kind };   // pause, resume, end and set up need no automatic step today
      }
      await rest(`agent_jobs?id=eq.${j.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'acknowledged', response, error: null, updated_at: new Date().toISOString() }) });
      if (j.client_id) await rest(`growth_clients?id=eq.${j.client_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ agent_status: 'acknowledged' }) });
      console.log(`job ${j.id} ${j.kind}: done`);
    } catch (e) {
      const failed = (j.attempts || 0) + 1 >= 3;
      await rest(`agent_jobs?id=eq.${j.id}`, { method: 'PATCH', body: JSON.stringify({ status: failed ? 'failed' : 'queued', error: mask(e.message).slice(0, 300), updated_at: new Date().toISOString() }) });
      if (failed && j.client_id) await rest(`growth_clients?id=eq.${j.client_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ agent_status: 'failed' }) });
      console.log(`job ${j.id} ${j.kind}: ${failed ? 'failed' : 'will retry'}`);
      if (failed) await telegram(`TECH na PESA: an agent job failed three times (${j.kind}). Work it by hand in Admin, Digital Growth, Agent jobs.`);
    }
  }
}

// ---------- 2) site content to the owner's Pages ----------
const PROMOS = [
  { key: 'directory', path: '/businesses/', brief: 'The TECH na PESA business directory: find businesses across all 47 counties by category and county, then call, WhatsApp or send an enquiry in one tap.' },
  { key: 'list-free', path: '/account/businesses/', brief: 'Business owners can list their business free on TECH na PESA, with photos, products, prices, opening hours, a WhatsApp button and enquiries from customers. Every listing is checked before it goes live.' },
  { key: 'digital-growth', path: '/digital-growth/', brief: 'TECH na PESA Digital Growth: professional social media management for Kenyan businesses with a 14 day free trial. The business approves every post before it goes out. Nothing is charged when the trial ends.' },
  { key: 'business-connect', path: '/business-connect/', brief: 'TECH na PESA Business Connect: practical help to get a business found online, including Google Business Profile, WhatsApp Business set up and product catalogues.' },
];
const SHARE_SYSTEM = `You write Facebook posts for the TECH na PESA Page (technology, money and business growth for Kenyans).
Rules: British English only. Friendly, plain and specific. Use only the facts given; never invent prices, offers, reviews, numbers or claims.
Never ask people to comment, like, share, tag or type anything. End with one natural, specific question. No emojis, no dashes of any kind, no bullet symbols, at most two hashtags at the end.
Never use: testament, whether, game changer, unlock, delve, dive in, buckle up, revolutionise, supercharge, are you ready.
The link is added under your text automatically; do not write a web address.
Return JSON: {"caption":"40 to 90 words"}`;

async function pageToken(pageId) {
  const r = await fetch(`https://graph.facebook.com/${GV}/me/accounts?limit=100&fields=id,name,access_token`, { headers: { Authorization: 'Bearer ' + (process.env.FB_USER_TOKEN || '') }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({})); const m = (j.data || []).find((x) => x.id === pageId);
  return m ? { token: m.access_token, name: m.name } : null;
}

async function runShares() {
  if (PAUSED) { console.log('shares: agent paused'); return; }
  const mode = await setting('social.share_mode', 'off');
  if (mode !== 'auto') { console.log('shares: switched off'); return; }
  const h = nowEAT().getUTCHours(); if (h < 8 || h > 20) { console.log('shares: outside posting hours'); return; }
  const pages = await setting('social.share_pages', ['techpulse']); const perDay = Number(await setting('social.shares_per_day', 2)) || 2;
  for (const key of pages) {
    const fbp = FB_PAGES[key]; if (!fbp) continue;
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const recent = await rest(`social_shares?page_key=eq.${key}&status=eq.posted&posted_at=gte.${since}&select=posted_at&order=posted_at.desc`);
    if (recent.length >= perDay) { console.log(`shares ${key}: daily limit reached`); continue; }
    if (recent[0] && Date.now() - Date.parse(recent[0].posted_at) < 4 * 3600000) { console.log(`shares ${key}: too soon after the last one`); continue; }
    // pick: a new listing whose owner allowed sharing, otherwise a promotion not used on this Page for 7 days
    const done = new Set((await rest(`social_shares?page_key=eq.${key}&kind=eq.listing&status=in.(planned,posted)&select=ref`)).map((x) => x.ref));
    const listings = (await rest('businesses?status=eq.published&share_ok=is.true&select=id,slug,name,tagline,description,town,category_id&order=published_at.asc&limit=50')).filter((b) => !done.has(b.id));
    let item;
    if (listings.length) {
      const b = listings[0]; const cat = b.category_id ? ((await rest(`categories?id=eq.${b.category_id}&select=name`))[0] || {}).name : '';
      item = { kind: 'listing', ref: b.id, link: `${SITE}/b/${b.slug}`, brief: `Introduce a business just listed on TECH na PESA, so people nearby know about it. Name: ${b.name}. Category: ${cat || 'business'}. Town: ${b.town || 'Kenya'}. In their words: ${b.tagline || ''} ${String(b.description || '').slice(0, 500)}` };
    } else {
      const week = new Date(Date.now() - 7 * 86400000).toISOString();
      const used = new Set((await rest(`social_shares?page_key=eq.${key}&kind=eq.promo&status=eq.posted&posted_at=gte.${week}&select=ref`)).map((x) => x.ref));
      const promoGap = await rest(`social_shares?page_key=eq.${key}&kind=eq.promo&status=eq.posted&posted_at=gte.${new Date(Date.now() - 3 * 86400000).toISOString()}&select=id`);
      const pr = PROMOS.find((p) => !used.has(p.key));
      if (!pr || promoGap.length) { console.log(`shares ${key}: nothing new to share`); continue; }
      item = { kind: 'promo', ref: pr.key, link: SITE + pr.path, brief: pr.brief };
    }
    const pg = await pageToken(fbp.id);
    if (!pg) { console.log(`shares ${key}: no posting key for the Page`); continue; }
    if (fbp.mustBeNamed && !fbp.mustBeNamed.test(pg.name)) {
      console.log(`shares ${key}: the Page is not renamed yet, nothing posted`);
      if (h === 9) await telegram('TECH na PESA: site sharing is on, but the Rentnyumba.com Page has not been renamed to TECH na PESA yet, so nothing is posted there. Rename it on Facebook and sharing starts on the next hourly run.');
      continue;
    }
    let caption = '';
    for (let i = 0; i < 3 && !caption; i++) { const c = clean((await gemini(SHARE_SYSTEM, item.brief)).caption || ''); if (c.length >= 40 && ok(c) && !/https?:\/\//.test(c)) caption = c; }
    if (!caption) { console.log(`shares ${key}: no caption passed the checks`); continue; }
    const row = (await rest('social_shares', { method: 'POST', body: JSON.stringify({ kind: item.kind, ref: item.ref, page_key: key, link: item.link, caption }) }))[0];
    try {
      const r = await fetch(`https://graph.facebook.com/${GV}/${fbp.id}/feed`, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { Authorization: 'Bearer ' + pg.token }, body: new URLSearchParams({ message: caption, link: item.link }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) throw new Error('facebook ' + r.status + ' ' + mask(JSON.stringify(j)).slice(0, 200));
      await rest(`social_shares?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'posted', fb_post_id: j.id, posted_at: new Date().toISOString() }) });
      await audit('social.shared', 'social_share', row.id, { page: key, kind: item.kind, ref: item.ref, fb_post_id: j.id });
      console.log(`shares ${key}: posted a ${item.kind}`);
    } catch (e) {
      await rest(`social_shares?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: mask(e.message).slice(0, 300) }) });
      console.log(`shares ${key}: failed`);
      await telegram('TECH na PESA: a site share to Facebook failed. Details are in Admin, Social sharing.');
    }
  }
}

async function selftest() {
  const out = path.join(ROOT, 'data', 'tnp', 'selftest'); fs.mkdirSync(out, { recursive: true });
  const brief = { business_name: 'Grace Bakery Kangundo', category: 'Retail', town: 'Kangundo', county: 'Machakos', description: 'Fresh bread, cakes and pastries baked daily in Kangundo town since 2019. Birthday and wedding cakes made to order.', products: 'Bread, birthday cakes, wedding cakes, pastries', audience: 'Families and event planners in Kangundo and Tala', objectives: 'More cake orders on WhatsApp', promotions: '', platforms: ['facebook', 'instagram'] };
  const posts = await drafts(brief, 3, 'Sample run');
  posts.forEach((p, i) => fs.writeFileSync(path.join(out, `draft-${i + 1}.png`), poster({ business: brief.business_name, headline: p.headline, sub: p.sub, colours: 'pink and gold' })));
  fs.writeFileSync(path.join(out, 'drafts.json'), JSON.stringify(posts, null, 1));
  const share = clean((await gemini(SHARE_SYSTEM, PROMOS[2].brief)).caption || '');
  fs.writeFileSync(path.join(out, 'share.json'), JSON.stringify({ caption: share, passes: ok(share) }, null, 1));
  const key = await serviceKey().then(() => 'platform key ok').catch((e) => 'platform key: ' + mask(e.message));
  const pg = await pageToken(FB_PAGES.techpulse.id).then((p) => (p ? `page key ok, page name ${p.name}` : 'no page key')).catch(() => 'page check failed');
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), drafts: posts.length, key, page: pg }, null, 1));
  console.log(`selftest: ${posts.length} drafts, ${key}, ${pg.replace(/page name .*/, 'page found')}`);
}

module.exports = { poster, clean, ok, palette };
if (require.main === module) (async () => {
  try {
    if (SELFTEST) return await selftest();
    if (PAUSED) console.log('agent paused: no shares; drafts still prepared for staff');
    await runJobs();
    await runShares();
  } catch (e) { console.log('tnp: ' + mask(e.message)); process.exitCode = 1; }
})();
