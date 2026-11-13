// TIMSAUTI OPPORTUNITY DESK (owner, 12 Nov 2026)
// Every morning: reads public tender, NGO and grant sources, keeps the notices that fit the owner's training and
// consultancy work, checks each strong match on its own page, and sends the best to the owner on Telegram with
// two buttons: "Draft my response" and "Not for me". A draft is written only from oppdesk/profile.json.
// The owner can also send any opportunity he finds himself (for example on LinkedIn) as a Telegram message
// starting "Opp:" and the desk assesses it the same way. LinkedIn itself is never read automatically.
// The desk matches each notice to the right bidder: Timsauti Ltd (company) or Timothy Muli Makasa (individual).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'oppdesk'), FILE = path.join(DIR, 'store.json');
const PROFILE = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'profile.json'), 'utf8'));
const SOURCES = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_AGE_DAYS = 21, MAX_ASSESS = 45, MAX_VERIFY = 6, MAX_SEND = 6, MIN_FIT = 60;

// ---------- small helpers ----------
const ent = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, ', ').replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch (e) { return ' '; } }).replace(/&amp;/g, '&');
const strip = (h) => ent(String(h || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const idOf = (link, title) => crypto.createHash('sha1').update(String(link || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() || norm(title)).digest('hex').slice(0, 10);
const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s*[–—]\s*/g, ', ').replace(/\s+,/g, ',').replace(/[ \t]+/g, ' ').trim();
const eat = (ms) => new Date((ms || Date.now()) + 3 * 3600000);   // Nairobi time
const dayOf = (ms) => eat(ms).toISOString().slice(0, 10);
const nice = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return isNaN(d) ? iso : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const mask = (s) => String(s || '').replace(/key=[^&"\s]+/g, 'key=***').replace(/AIza[\w-]{20,}/g, 'AIza***');

// ---------- records ----------
function load() { let s = {}; try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
  s.seen = s.seen || {}; s.items = s.items || []; s.inbox = s.inbox || []; s.health = s.health || {}; s.days = s.days || {}; return s; }
function save(s) { const cut = Date.now() - 120 * 86400000;
  for (const k of Object.keys(s.seen)) if (s.seen[k] < cut) delete s.seen[k];
  s.items = s.items.filter((x) => x.found > cut || ['WANTED', 'DRAFTED'].includes(x.status)).slice(-400);
  for (const k of Object.keys(s.days)) if (k < dayOf(cut)) delete s.days[k];
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); }

// ---------- Gemini (free plan; its own key if GEMINI_OPPDESK_KEY is set) ----------
const G = { base: 'https://generativelanguage.googleapis.com/v1beta', models: [process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'] };
const gkeys = () => [process.env.GEMINI_OPPDESK_KEY, process.env.GEMINI_BETDESK_KEY, process.env.GEMINI_API_KEY].filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);   // its own key first, then the spare key, then the main one: each has its own free daily allowance
async function gemini(p) {
  if (!gkeys().length) throw new Error('GEMINI_API_KEY missing'); let last;
  for (const key of gkeys()) for (const m of G.models) {
    try {
      const r = await fetch(`${G.base}/models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: 'user', parts: [{ text: p.user }] }], generationConfig: { temperature: p.temp === undefined ? 0.2 : p.temp, responseMimeType: 'application/json' } }) });
      const j = await r.json(); if (!r.ok) { last = new Error(r.status === 429 ? 'the free AI allowance for today is used up' : 'gemini ' + m + ' ' + r.status + ' ' + JSON.stringify(j.error || j).slice(0, 160)); continue; }
      const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('');
      return JSON.parse(t.replace(/^```json\s*|```\s*$/g, ''));
    } catch (e) { last = e; }
  }
  throw last || new Error('gemini failed');
}
async function geminiSearch(question) {
  for (const key of gkeys()) for (const m of G.models) {
    try {
      const r = await fetch(`${G.base}/models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }) });
      const j = await r.json(); if (!r.ok) continue;
      const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join(''); if (t) return t;
    } catch (e) {}
  }
  return '';
}

// ---------- reading the sources ----------
async function get(url, ms) { const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, application/json, text/html;q=0.9, */*;q=0.8', 'accept-language': 'en-KE,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(ms || 25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status); return { text: await r.text(), url: r.url }; }
function parseFeed(xml) { const out = []; const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) { const tag = (t) => { const m = b.match(new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>', 'i')); return m ? m[1] : ''; };
    let link = strip(tag('link')); if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = ent(m[1]); }
    const date = Date.parse(strip(tag('pubDate') || tag('updated') || tag('published') || tag('dc:date'))) || 0;
    out.push({ title: strip(tag('title')).slice(0, 220), link, summary: strip(tag('description') || tag('summary') || tag('content:encoded') || tag('content')).slice(0, 900), date }); }
  return out; }
// a JSON list of tenders: finds the first array of records anywhere near the top and reads the usual field names
function parseJson(text, src) { const j = JSON.parse(text); let arr = Array.isArray(j) ? j : null;
  if (!arr) for (const k of Object.keys(j)) { if (Array.isArray(j[k])) { arr = j[k]; break; } if (j[k] && Array.isArray(j[k].data)) { arr = j[k].data; break; } }
  const f = (o, names) => { for (const n of names) if (o[n] !== undefined && o[n] !== null && typeof o[n] !== 'object') return String(o[n]); return ''; };
  return (arr || []).filter((o) => o && typeof o === 'object').map((o) => { const pe = (o.pe && (o.pe.name || o.pe.pe_name)) || f(o, ['pe_name', 'procuring_entity', 'entity', 'organization', 'organisation']);
    const id = f(o, ['id', 'tender_id', 'tender_ref', 'ref']); const close = f(o, ['close_at', 'closing_date', 'close_date', 'deadline', 'closedate']);
    return { title: clean(f(o, ['title', 'tender_title', 'name', 'description'])).slice(0, 220), link: f(o, ['url', 'link', 'tender_url']) || (src.item ? src.item.replace('{id}', id) : 'https://tenders.go.ke/tenders/' + id),
      summary: clean([pe && 'Procuring entity: ' + pe, f(o, ['procurement_method', 'method']) && 'Method: ' + f(o, ['procurement_method', 'method']), close && 'Closes: ' + close, f(o, ['tender_ref', 'ref_no']) && 'Reference: ' + f(o, ['tender_ref', 'ref_no'])].filter(Boolean).join('. ')).slice(0, 600),
      date: Date.parse(f(o, ['published_at', 'publish_date', 'created_at', 'pub_date']).replace(' ', 'T')) || 0, closeHint: close }; }); }
// a plain web page of notices: every link with a real title on it is a possible notice
function parseLinks(html, base, src) { const out = []; const seen = new Set(); const want = src.linkText ? new RegExp(src.linkText, 'i') : null, href = src.linkHref ? new RegExp(src.linkHref, 'i') : null;
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) { const title = strip(m[2]).replace(/^Title\s+/i, ''); if (title.length < 25 || title.length > 400) continue;
    let link; try { link = new URL(ent(m[1]), base).href; } catch (e) { continue; } if (!/^https?:/.test(link) || seen.has(link)) continue;
    if ((want && !want.test(title)) || (href && !href.test(link))) continue; seen.add(link); out.push({ title: title.slice(0, 220), link, summary: '', date: 0 }); }
  return out; }
// the government tenders portal: asked one word at a time, slowly, because it turns away quick callers
async function readTenders(src) { const out = []; let okAny = false, lastErr = '', misses = 0;
  for (const w of src.words) { let done = false; if (misses >= 2 && !okAny) break;   // the portal is down: stop asking
    for (let k = 0; k < 2 && !done; k++) { try { const j = (await get(src.url + encodeURIComponent(w), 25000)).text; for (const it of parseJson(j, src)) out.push(it); okAny = true; done = true; } catch (e) { lastErr = e.message; await new Promise((r) => setTimeout(r, 7000)); } }
    if (!done) misses++; await new Promise((r) => setTimeout(r, 2600)); }
  if (!okAny) throw new Error(lastErr || 'no answer'); return out; }
async function gnResolve(link) {   // Google News hides the real page behind its own link; this asks Google for the real address
  try { const id = (String(link || '').match(/news\.google\.[^/]+\/(?:rss\/)?articles\/([^?/#]+)/) || [])[1]; if (!id) return null; const HB = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' };
    const h = await (await fetch('https://news.google.com/articles/' + id + '?hl=en-KE&gl=KE&ceid=KE:en', { headers: HB, signal: AbortSignal.timeout(20000) })).text();
    const sg = (h.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (h.match(/data-n-a-ts="([^"]+)"/) || [])[1]; if (!sg || !ts) return null;
    const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
    const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', { method: 'POST', headers: Object.assign({}, HB, { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }), body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])), signal: AbortSignal.timeout(20000) });
    const t = await r.text(); try { const arr = JSON.parse(t.split('\n\n')[1]); const u = JSON.parse(arr[0][2])[1]; if (/^https?:\/\//.test(u)) return u; } catch (e) {}
    const m = t.match(/garturlres\\+",\\+"(https?:[^"\\]+)/); return m ? m[1] : null; } catch (e) { return null; } }
async function readSource(src) {
  if (src.type === 'links') { const p = await get(src.url, 30000); return parseLinks(p.text, p.url, src); }
  if (src.type === 'tenders') return readTenders(src);
  if (src.type === 'rss') return parseFeed((await get(src.url)).text);
  if (src.type === 'bing') return parseFeed((await get('https://www.bing.com/search?format=rss&count=30&setlang=en&cc=KE&q=' + encodeURIComponent(src.q))).text);
  if (src.type === 'json') return parseJson((await get(src.url)).text, src);
  if (src.type === 'search') {   // Google Search through Gemini: only the links are kept, and every one is checked on its own page later
    const today = nice(dayOf());
    const t = await geminiSearch(`Today is ${today}. Use Google Search to find ${src.q}. Only notices that are still open today and were published in the last 30 days. Give up to 10. For each one write a single line in exactly this form and nothing else:\nTITLE | ORGANISATION | FULL WEB ADDRESS OF THE NOTICE ITSELF\nDo not include job boards' front pages, expired notices or anything you could not open.`);
    return t.split('\n').map((l) => l.replace(/^[\s*\d.)-]+/, '').split('|').map((x) => x.trim())).filter((p) => p.length >= 3 && /^https?:\/\//i.test(p[p.length - 1])).map((p) => ({ title: clean(p[0]).slice(0, 220), link: p[p.length - 1].replace(/[)\].,]+$/, ''), summary: 'Organisation: ' + clean(p[1]), date: 0, fromSearch: true }));
  }
  throw new Error('unknown source type ' + src.type);
}
async function collect(S, log) {
  const sources = SOURCES(); const all = []; const report = [];
  const res = await Promise.all(sources.map(async (src) => { try { const must = src.must ? new RegExp(src.must, 'i') : null; const raw = (await readSource(src)).filter((x) => x.title && x.link); const items = raw.filter((x) => !must || must.test(x.title + ' ' + x.summary)); return { src, items, raw: raw.length }; } catch (e) { return { src, err: mask(String(e.message)).slice(0, 120) }; } }));
  for (const r of res) { const h = S.health[r.src.name] = S.health[r.src.name] || { fails: 0 };
    if (r.err || !r.raw) { h.fails++; h.last = r.err || 'no items'; report.push(`${r.src.name}: FAILED (${h.last})`); continue; }
    h.fails = 0; h.lastOk = Date.now(); h.last = r.items.length + ' items'; report.push(`${r.src.name}: ${r.items.length} items`);
    for (const it of r.items) all.push(Object.assign(it, { source: r.src.name })); }
  if (log) log(report.join('\n'));
  return { all, report, okCount: res.filter((r) => !r.err && r.raw).length, total: sources.length };
}
// a cheap first sieve before any AI is used: fresh, not seen before, and about the owner's kind of work
function sieve(all, S, P) {
  const want = P.wanted.map(norm), not = P.notWanted.map(norm); const out = []; const got = new Set(); const cut = Date.now() - MAX_AGE_DAYS * 86400000;
  const direct = (x) => (/news\.google\./.test(x.link) ? 1 : 0);
  for (const it of all.slice().sort((a, b) => direct(a) - direct(b))) { if (direct(it)) it.title = it.title.replace(/\s+-\s+[^-]{2,40}$/, ''); it.id = idOf(it.link, it.title); const tkey = 't:' + norm(it.title).slice(0, 70);
    if (S.seen[it.id] || S.seen[tkey] || got.has(it.id) || got.has(tkey)) continue; got.add(it.id); got.add(tkey); it.tkey = tkey;
    if (it.date && it.date < cut) { S.seen[it.id] = Date.now(); continue; }
    const t = ' ' + norm(it.title) + ' ', b = ' ' + norm(it.title + ' ' + it.summary) + ' ';
    if (not.some((w) => t.includes(' ' + w + ' ')) || !want.some((w) => b.includes(' ' + w + ' '))) { S.seen[it.id] = Date.now(); continue; }
    out.push(it); }
  return out.sort((a, b) => (b.date || 0) - (a.date || 0));
}

// ---------- judging ----------
const profileText = (P) => `COMPANY: ${P.company.name}. ${P.company.about}\nTraining areas: ${P.company.training.join('; ')}.\nServices: ${P.company.services.join('; ')}.\nTrack record: ${P.company.record.join('; ')}.\n\nINDIVIDUAL: ${P.person.name}. ${P.person.about}\nTraining and facilitation record: ${(P.person.record || []).join('; ')}.\nEducation: ${P.person.education.join('; ')}.\nMemberships and leadership: ${P.person.credentials.join('; ')}.\nExperience: ${P.person.experience.join('; ')}.\nSkills: ${P.person.skills.join('; ')}.${P.person.languages ? '\nLanguages: ' + P.person.languages + '.' : ''}${P.person.tools ? '\nTools: ' + P.person.tools + '.' : ''}\n\nBase: ${P.location}\nLimits: ${P.notes}`;
async function assess(cands, P, ask) {
  if (!cands.length) return [];
  const list = cands.map((c, i) => `${i + 1}. ${c.title}\n   Source: ${c.source}. ${c.summary || ''}`.slice(0, 700)).join('\n');
  const d = await ask({ system: 'You screen tenders, consultancy calls, facilitator calls and grants for a small Kenyan training and communications firm and its founder. You are strict and honest: most notices are NOT a fit. Output only JSON.',
    user: `Today is ${nice(dayOf())}.\n\nWHO IS BIDDING\n${profileText(P)}\n\nNOTICES\n${list}\n\nFor every notice give a fit score from 0 to 100 for this bidder. Score 75 or more only when the work asked for is plainly within the training areas, services or skills above AND a bidder based in Kenya can apply. Score below 40 for salaried full time jobs, internships, scholarships, supply of goods, works, clinical, legal, audit, engineering or software work, notices for other countries only, and anything already closed. A salaried job is never a fit; a short term consultancy or a call for trainers is. Be realistic about size: this is a small firm, so for a large national or international tender that would normally go to a big established agency, give at most 70 and say so in \"why\". In \"why\" state only what the notice and the profile say; do not add places, numbers or strengths that are not written there.\n"as" says who should bid: "company" when a firm is asked for or either may apply, "person" when an individual consultant or facilitator is asked for.\nReturn JSON: {"results":[{"n":1,"fit":0,"as":"company or person","kind":"Tender | Consultancy | Call for trainers | Grant | Partnership | Job | Other","why":"one plain sentence, at most 22 words, on why it fits or does not","deadline":"the closing date only if the notice text above states it, else empty"}]}` });
  const out = [];
  for (const r of (d.results || [])) { const c = cands[Number(r.n) - 1]; if (!c) continue;
    out.push(Object.assign({}, c, { fit: Math.max(0, Math.min(100, Math.round(Number(r.fit) || 0))), as: /person/i.test(r.as) ? 'person' : 'company', kind: clean(r.kind || 'Other').slice(0, 30), why: clean(r.why || '').slice(0, 220), deadline: clean(r.deadline || '').slice(0, 60) })); }
  return out;
}
// opens the notice itself and reads the facts from it; a deadline counts as confirmed only when the page carries the quoted words
async function verify(it, ask) {
  if (it.closeHint && /^\d{4}-\d\d-\d\d/.test(it.closeHint)) {   // the portal's own record states the closing date
    it.deadlineISO = it.closeHint.slice(0, 10); it.deadline = nice(it.deadlineISO) + (/\d\d:\d\d/.test(it.closeHint) ? ' at ' + it.closeHint.slice(11, 16) : ''); it.deadlineConfirmed = true; it.closed = it.deadlineISO < dayOf();
    it.organisation = (String(it.summary).match(/Procuring entity: ([^.]+)/) || [])[1] || ''; it.howToApply = 'Download the tender document from the portal page and follow it.'; it.pageText = it.title + '. ' + it.summary; it.checked = 'page read'; return it; }
  if (/news\.google\./.test(it.link)) { const real = await gnResolve(it.link); if (real) it.link = real; else { it.checked = 'the notice sits behind a Google link; open it to read the details'; return it; } }
  let page; try { page = await get(it.link, 30000); } catch (e) { it.checked = 'could not open the page (' + mask(String(e.message)).slice(0, 60) + ')'; return it; }
  if (/\.pdf($|\?)/i.test(page.url) || /^%PDF/.test(page.text)) { it.checked = 'the notice is a PDF file; open the link to read it'; it.link = page.url; return it; }
  const text = strip(page.text); it.link = /news\.google\.com|bing\.com\/ck/.test(it.link) ? page.url : it.link;
  if (text.length < 400) { it.checked = 'the page did not show its text to the agent; open the link'; return it; }
  it.pageText = text.slice(0, 14000);
  let d; try { d = await ask({ system: 'You read one tender or consultancy notice and report only what the page says. Never guess. Output only JSON.',
    user: `Today is ${nice(dayOf())}. Notice title: ${it.title}\n\nPAGE TEXT\n${it.pageText}\n\nReturn JSON: {"isNotice":true or false (false if this page is a list of many notices, a home page, a login page or unrelated),"closed":true or false (true only if the page says it is closed or the deadline has passed),"deadline":"closing date as written on the page, else empty","deadlineISO":"YYYY-MM-DD or empty","deadlineQuote":"the exact words from the page that state the closing date, copied letter for letter, at most 25 words, else empty","organisation":"who issued it, else empty","whoCanApply":"at most 25 words, from the page, else empty","asks":["up to 5 short points on what the bidder must have or submit, from the page"],"howToApply":"at most 30 words, from the page, else empty","budget":"only if the page states one, else empty"}` }); }
  catch (e) { it.checked = 'the page opened but could not be read by the AI today'; return it; }
  it.isNotice = d.isNotice !== false; it.closed = d.closed === true;
  it.organisation = clean(d.organisation || '').slice(0, 120); it.whoCanApply = clean(d.whoCanApply || '').slice(0, 220); it.howToApply = clean(d.howToApply || '').slice(0, 260); it.budget = clean(d.budget || '').slice(0, 80);
  it.asks = (Array.isArray(d.asks) ? d.asks : []).map((x) => clean(x).slice(0, 140)).filter(Boolean).slice(0, 5);
  const q = norm(d.deadlineQuote || ''); const iso = /^\d{4}-\d\d-\d\d$/.test(d.deadlineISO || '') && !isNaN(Date.parse(d.deadlineISO)) ? d.deadlineISO : '';
  if (iso && q.length > 8 && norm(text).includes(q)) { it.deadline = clean(d.deadline || nice(iso)).slice(0, 60); it.deadlineISO = iso; it.deadlineConfirmed = true; if (iso < dayOf()) it.closed = true; }
  else if (d.deadline) { it.deadline = clean(d.deadline).slice(0, 60); it.deadlineConfirmed = false; }
  it.checked = 'page read'; return it;
}

// ---------- Telegram messages ----------
const who = (it, P) => (it.as === 'person' ? P.person.name : P.company.name);
function card(it, P, n) {
  const L = [`${n ? n + '. ' : ''}${it.title}`];
  if (it.organisation) L.push('From: ' + it.organisation);
  L.push(`Fit: ${it.fit} out of 100. Bid as: ${who(it, P)}`);
  L.push('Type: ' + it.kind);
  L.push('Deadline: ' + (it.deadline ? it.deadline + (it.deadlineConfirmed ? ' (read on the notice itself)' : ' (not confirmed, check the notice)') : 'not stated, check the notice'));
  if (it.deadlineISO && it.deadlineConfirmed) { const left = Math.round((Date.parse(it.deadlineISO) - Date.parse(dayOf())) / 86400000); L[L.length - 1] += left === 0 ? '. CLOSES TODAY' : left === 1 ? '. Closes tomorrow' : `. ${left} days left`; }
  if (it.budget) L.push('Budget stated: ' + it.budget);
  L.push('Why: ' + it.why);
  if (it.whoCanApply) L.push('Who can apply: ' + it.whoCanApply);
  if (it.asks && it.asks.length) L.push('They ask for:\n' + it.asks.map((a, i) => `  ${i + 1}) ${a}`).join('\n'));
  if (it.howToApply) L.push('How to apply: ' + it.howToApply);
  if (it.checked && it.checked !== 'page read') L.push('Note: ' + it.checked + '.');
  if (/tenders\.go\.ke/.test(it.link)) L.push('Note: a government tender. Read the tender document for the mandatory requirements (registration, tax compliance, bid security, past contracts) before you decide.');
  L.push('Found on: ' + it.source); L.push(it.link);
  return L.join('\n');
}
const buttons = (it) => [[['Draft my response', 'ow|opp|' + it.id], ['Not for me', 'ox|opp|' + it.id]]];
const keep = (it) => { const o = Object.assign({}, it); delete o.summary; o.pageText = (it.pageText || it.summary || '').slice(0, 6000); return o; };

// ---------- the morning scan ----------
async function scan(S, { tg, ask, log }) {
  const P = PROFILE(); const today = dayOf();
  const { all, report, okCount, total } = await collect(S, log);
  const cands = sieve(all, S, P).slice(0, MAX_ASSESS);
  if (log) log(`read ${all.length} notices from ${okCount} of ${total} sources; ${cands.length} new ones passed the first sieve`);
  let judged = []; if (cands.length) judged = await assess(cands, P, ask);
  for (const c of cands) { S.seen[c.id] = Date.now(); if (c.tkey) S.seen[c.tkey] = Date.now(); }   // judged once; never shown or paid for again
  const strong = judged.filter((x) => x.fit >= MIN_FIT && !/^job$/i.test(x.kind)).sort((a, b) => b.fit - a.fit).slice(0, MAX_VERIFY);
  for (const it of strong) await verify(it, ask);
  const good = strong.filter((x) => !x.closed && x.isNotice !== false).slice(0, MAX_SEND);
  if (log) { log(judged.sort((a, b) => b.fit - a.fit).slice(0, 15).map((x) => `${x.fit} ${x.kind} | ${x.title} | ${x.why}`).join('\n')); }
  const head = `OPPORTUNITY DESK, ${nice(today)}\nRead ${all.length} notices from ${okCount} of ${total} sources. New since yesterday: ${cands.length}. Worth your time: ${good.length}.`;
  if (!good.length) await tg.send(head + '\nNothing today that truly fits your training and consultancy work. I only send what is worth a bid.');
  else { await tg.send(head + '\nTap "Draft my response" on any you want and the draft follows within the hour.');
    let n = 0; for (const it of good) { n++; const mid = await tg.send(card(it, P, n), buttons(it)); S.items.push(Object.assign(keep(it), { found: Date.now(), status: 'SENT', msg: mid || null })); } }
  S.days[today] = { read: all.length, sources: okCount + '/' + total, fresh: cands.length, sent: good.length };
  const dead = Object.keys(S.health).filter((k) => S.health[k].fails >= 7 && S.health[k].fails % 7 === 0);
  if (dead.length) await tg.send('OPPORTUNITY DESK: these sources have not answered for a week: ' + dead.join('; ') + '. Tell Claude to replace them.');
  return { head, good, report };
}

// ---------- what the owner sends in himself ("Opp: ...") ----------
function inbox(text) { const t = String(text || '').replace(/^\s*opp(ortunity)?\s*[:,]\s*/i, '').trim(); if (t.length < 15) return false;
  const S = load(); S.inbox.push({ text: t.slice(0, 6000), at: Date.now() }); save(S); return true; }
async function doInbox(S, { tg, ask }) {
  const P = PROFILE();
  for (const m of S.inbox.splice(0, 3)) {
    try {
      const link = (m.text.match(/https?:\/\/\S+/) || [])[0]; const li = link && /linkedin\.com|lnkd\.in/i.test(link);
      const first = m.text.replace(/https?:\/\/\S+/g, '').trim();
      let it = { title: clean(first.split('\n')[0] || 'Opportunity you sent').slice(0, 160), link: link || '', summary: first.slice(0, 1500), source: 'Sent by you', id: idOf(link, first) };
      const j = await assess([it], P, ask); it = j[0] || Object.assign(it, { fit: 0, as: 'company', kind: 'Other', why: 'The AI could not judge this one today.' });
      if (link && !li) await verify(it, ask); else { it.pageText = first; it.checked = li ? 'LinkedIn pages cannot be opened by the agent, so this is judged only on the words you sent' : 'judged on the words you sent'; }
      if (!it.pageText || it.pageText.length < first.length) it.pageText = (first + '\n' + (it.pageText || '')).slice(0, 14000);
      const verdict = it.closed ? 'This one looks closed.' : it.fit >= 75 ? 'Worth a bid.' : it.fit >= MIN_FIT ? 'Possible, read it closely first.' : 'I would skip this one.';
      const mid = await tg.send('YOUR OPPORTUNITY, CHECKED\nVerdict: ' + verdict + '\n\n' + card(it, P), buttons(it));
      S.items.push(Object.assign(keep(it), { found: Date.now(), status: 'SENT', msg: mid || null })); S.seen[it.id] = Date.now();
    } catch (e) { await tg.send('OPPORTUNITY DESK: I could not check the opportunity you sent (' + mask(String(e.message)).slice(0, 100) + '). Send it again later.'); }
  }
}

// ---------- drafting ----------
async function draft(it, P, ask) {
  const me = it.as === 'person' ? 'the individual, ' + P.person.name : 'the company, ' + P.company.name;
  const d = await ask({ temp: 0.5, system: 'You write expressions of interest and cover letters for a Kenyan training and communications firm and its founder. You are precise and honest. You use ONLY the facts in the bidder profile; you never invent clients, numbers, years, staff, certificates, prices or past projects. Output only JSON.',
    user: `Today is ${nice(dayOf())}.\n\nBIDDER PROFILE\n${profileText(P)}\nContact: ${it.as === 'person' && P.person.contact ? P.person.contact : P.company.contact}\n\nTHE OPPORTUNITY\nTitle: ${it.title}\n${it.organisation ? 'Issued by: ' + it.organisation + '\n' : ''}${it.deadline ? 'Deadline: ' + it.deadline + '\n' : ''}Notice text:\n${(it.pageText || '').slice(0, 9000)}\n\nWrite the response from ${me}.\nRules: British English as used in Kenya. Formal, warm and direct. 280 to 420 words. No dashes of any kind, no bullet symbols, no emojis, never the words "testament" or "whether". Address the issuing organisation by name if known, otherwise "Dear Sir or Madam". Open with the opportunity's exact title. Show fit by matching what the notice asks for to true items in the profile. For past employers state only the employer's name and the role if the profile gives one; do not describe duties, projects or achievements there that the profile does not state. Do not use puffed words such as extensive, vast, unmatched or proven track record. A bid from the company may also cite the founder's own training record, saying plainly that he delivered it. Never name referees; where the notice asks for them write [add your referees]. The letter never mentions the bidder's limits, weaknesses or anything from the Limits line; those belong only under gaps. Where the notice asks for something the profile does not show (a fee, a specific certificate, years of experience, a similar past assignment, registration documents), do NOT claim it: put a short note in square brackets for the owner to fill, like [state your daily rate], and list it under gaps. Close with the contact line and the bidder's name; for the company sign as Timothy Muli Makasa, Founder and Director, Timsauti Ltd.\nReturn JSON: {"subject":"email subject line","letter":"the full letter, paragraphs separated by blank lines","attach":["ONLY documents the notice text above names, in its own terms, up to 8; if the notice text names none, return an empty list"],"gaps":["requirements in the notice that the profile does not clearly meet, plainly stated, up to 6; empty if none"],"advice":"one honest sentence: bid or not, and the single thing that would most strengthen the bid"}` });
  const letter = clean(String(d.letter || '').replace(/\r/g, '')).replace(/ ?\n ?/g, '\n'); if (letter.length < 500) throw new Error('weak draft');
  return { subject: clean(d.subject || it.title).slice(0, 160), letter: String(d.letter || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.split('\n').map((l) => clean(l)).filter(Boolean).join('\n')).filter(Boolean).join('\n\n'), attach: (d.attach || []).map((x) => clean(x).slice(0, 160)).slice(0, 8), gaps: (d.gaps || []).map((x) => clean(x).slice(0, 200)).slice(0, 6), advice: clean(d.advice || '').slice(0, 300) };
}
async function doDrafts(S, { tg, ask }) {
  const P = PROFILE();
  for (const it of S.items.filter((x) => x.status === 'WANTED').slice(0, 2)) {
    try {
      const d = await draft(it, P, ask); it.draft = d; it.status = 'DRAFTED'; it.draftedAt = Date.now();
      await tg.send(`DRAFT RESPONSE: ${it.title}\nBid as: ${who(it, P)}${it.deadline ? '\nDeadline: ' + it.deadline : ''}\n${it.link}\n\nSubject: ${d.subject}`);
      await tg.send(d.letter);
      const tail = [];
      tail.push(d.attach.length ? 'ATTACH (as named in the notice):\n' + d.attach.map((a, i) => `${i + 1}) ${a}`).join('\n') : 'ATTACH: the notice text I could read does not list the documents. Open the full notice or tender document for the list.');
      tail.push(d.gaps.length ? 'GAPS TO DEAL WITH BEFORE YOU SEND (I did not claim these for you):\n' + d.gaps.map((a, i) => `${i + 1}) ${a}`).join('\n') : 'GAPS: none that I could see.');
      if (d.advice) tail.push('MY VIEW: ' + d.advice);
      tail.push('Read the full notice before sending. Fill every part in [square brackets].');
      await tg.send(tail.join('\n\n'));
    } catch (e) { it.tries = (it.tries || 0) + 1; if (it.tries >= 3) { it.status = 'SENT'; await tg.send(`OPPORTUNITY DESK: I could not write the draft for "${it.title}" after three tries (${mask(String(e.message)).slice(0, 80)}). Tap the button again later.`); } }
  }
}
// deadline reminders for what the owner chose: three days before and the day before
async function doReminders(S, { tg }) {
  const today = dayOf();
  for (const it of S.items.filter((x) => ['WANTED', 'DRAFTED'].includes(x.status) && x.deadlineISO && x.deadlineISO >= today)) {
    const left = Math.round((Date.parse(it.deadlineISO) - Date.parse(today)) / 86400000); const mark = left <= 1 ? 'r1' : left <= 3 ? 'r3' : null;
    if (mark && !it[mark]) { it[mark] = Date.now(); await tg.send(`DEADLINE REMINDER: "${it.title}" closes ${left === 0 ? 'TODAY' : left === 1 ? 'tomorrow' : 'in ' + left + ' days'} (${it.deadline}).\n${it.link}`); }
  }
}

// ---------- called by the main agent on every run ----------
function decide(id, want) { const S = load(); const it = S.items.find((x) => x.id === id); if (!it) return null;
  if (want) { if (it.status === 'DRAFTED') return 'DRAFTED'; it.status = 'WANTED'; it.tries = 0; } else if (it.status !== 'DRAFTED') it.status = 'DISMISSED';
  save(S); return it.status; }
async function tick({ tg, ask, log, force }) {
  ask = ask || gemini; const S = load(); const now = eat(); const today = dayOf(); const hour = now.getUTCHours();
  try {
    S.tries = S.tries || {};
    if (force || (!S.days[today] && hour >= 6 && hour < 21 && (S.tries[today] || 0) < 6)) {
      S.tries = { [today]: (S.tries[today] || 0) + 1 }; save(S);
      try { await scan(S, { tg, ask, log }); } catch (e) { if (log) log('scan failed: ' + mask(e.message)); if (S.tries[today] >= 6) { S.days[today] = { failed: mask(String(e.message)).slice(0, 120) }; await tg.send('OPPORTUNITY DESK: today\'s search failed six times (' + mask(String(e.message)).slice(0, 100) + '). It will try again tomorrow.'); } }
      save(S);
    }
    if (S.inbox.length) { await doInbox(S, { tg, ask }); save(S); }
    if (S.items.some((x) => x.status === 'WANTED')) { await doDrafts(S, { tg, ask }); save(S); }
    await doReminders(S, { tg }); save(S);
  } catch (e) { save(S); throw e; }
}
module.exports = { __ask: gemini, parseLinks, tick, decide, inbox, scan, collect, sieve, assess, verify, draft, card, parseFeed, parseJson, load, save, PROFILE, SOURCES, strip, idOf };
