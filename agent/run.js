// Timsauti Facebook agent, cloud version (runs on GitHub every hour; no laptop needed).
// Each run, for each Page: 1) post the one item whose time has come, live, and confirm Facebook's reply;
// 2) write and design upcoming posts for today and tomorrow. State lives in data/<page>/posts.json.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { renderCard, photoFrame, sautiCard, workCard, threadCard } = require('./card');
const SAUTI = require('./sauti');
const X = require('./extras');

const ROOT = path.join(__dirname, '..');
const NOW = Date.now();
const DRY = process.env.DRY_RUN === '1';
const PAUSED = fs.existsSync(path.join(ROOT, 'PAUSE'));
const GV = 'v26.0';
const TOPICS = JSON.parse(fs.readFileSync(path.join(__dirname, 'topics.json'), 'utf8'));
const GEMINI = { base: 'https://generativelanguage.googleapis.com/v1beta', models: [process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'] };   // each model has its own free daily allowance

// Times are Nairobi time (UTC+3). The hourly run posts each item within the hour after its slot.
const PAGES = [
  { key: 'timsauti', name: 'Timsauti Digital Agency', pageId: '394580017413619', token: process.env.TIMSAUTI_PAGE_TOKEN,
    // one post a day at 1pm as a Reel (the owner agreed, 1 Nov); real work sent on Telegram goes first.
    // 3 Nov (owner): market what Timsauti does: services four days a week (Sun, Mon, Thu, Fri), a tip on Tuesday, threads Wednesday and Saturday
    slots: [['13:00', 'B']], week: { 0: [['13:00', 'C']], 1: [['13:00', 'C']], 2: [['13:00', 'B']], 3: [['13:00', 'T']], 4: [['13:00', 'C']], 5: [['13:00', 'C']], 6: [['13:00', 'T']] }, reelSlot: '13:00', tags: ['Timsauti', 'TimsautiDigitalAgency'] },
  { key: 'makasa', name: 'Timothy Makasa', pageId: '351919135654247', token: process.env.MAKASA_PAGE_TOKEN,
    // one quality post every two days (owner, 10 Nov; before that two a day from 2 Nov), at 7pm, the Page's best hour.
    // The kind of post takes turns: life lesson, business idea, life lesson, a thread with its points in the comments.
    everyDays: 2, phase: 1, time: '19:00', cycle: ['W', 'M', 'W', 'K', 'W', 'T'],   // W: wit card in his name (owner, 12 Nov), every other post, so his photos do not repeat
    slots: [['19:00', 'M']], reelSlot: '19:00', tags: ['Makasa', 'AuthorMakasa', 'MakasatheAuthor', 'TimSauti'] },
  // Sauti Media: news slots (N, A, S) carry only approved news or the owner's tips; P, Q, O, G are written by the agent (questions only)
  { key: 'sauti', name: 'Sauti Media', pageId: '1859768287449730', token: process.env.SAUTI_PAGE_TOKEN,
    // News goes out as soon as it is ready, 6am to 10:30pm, at the pace in STATE.sautiPace, never faster than the weekly ceiling STATE.sautiCap (2 Nov: 1 story a run, 60 minutes apart, at most 10 a day).
    // One feature a day at 1pm, and a morning question at 7:30am (weekly review 2 Nov: morning questions drew about four times the interactions of evening ones).
    // D did you know, B business tip, W personality of the week, P "what do you know about" (weekly), Q question
    dailyMax: 60, minGapMin: 0,
    slots: [['07:30', 'Q'], ['13:00', 'D']],
    // a public education thread every day at 1pm (owner, 2 Nov); Personality of the Week moves to Wednesday 3pm
    // Friday 7pm: the weekly DEBATE (owner, 4 Nov: intriguing debates on the day people are least busy) in place of Talk of the Day
    // weekly review 9 Nov: the 6pm evening question (V) is dropped; its posts reached 167 to 932 people against about 800 for a news story
    // and 1,500 to 6,500 for the 7:30am question, while news after 6pm did best of any time of day (median 976). Evenings now carry news.
    // English Corner (owner, 14 Nov): one common English error made right, a clean white card, every day at 10:30
    week: { 0: [['08:00', 'G'], ['13:00', 'T'], ['19:00', 'R'], ['10:30', 'E']], 1: [['13:00', 'T'], ['07:30', 'Q'], ['10:30', 'E']], 2: [['13:00', 'T'], ['07:30', 'Q'], ['10:30', 'E']], 3: [['13:00', 'T'], ['15:00', 'W'], ['07:30', 'Q'], ['10:30', 'E']],
      4: [['13:00', 'T'], ['07:30', 'Q'], ['10:30', 'E']], 5: [['13:00', 'T'], ['07:30', 'Q'], ['19:00', 'X'], ['10:30', 'E']], 6: [['13:00', 'T'], ['07:30', 'Q'], ['10:30', 'E']] }, tags: ['sautimedia'] }
];
const NEWS_SLOTS = { W: 'D' };   // a news or profile slot with nothing approved gets this instead

const iso = (t) => new Date(t).toISOString();
const eatDate = (t) => new Date(t + 3 * 3600000).toISOString().slice(0, 10);
const slotTime = (ymd, hm) => Date.parse(ymd + 'T' + hm + ':00+03:00');
const slotsFor = (page, ymd) => { if (page.everyDays) { const n = Math.round(Date.parse(ymd + 'T00:00:00Z') / 86400000); return n % page.everyDays === page.phase ? [[page.time, page.cycle[Math.floor(n / page.everyDays) % page.cycle.length]]] : []; }   // a Page that posts every second day has no slot on its rest day
  const wd = new Date(ymd + 'T12:00:00Z').getUTCDay(); return (page.week && page.week[wd]) || (page.sunday && wd === 0 ? page.sunday : page.slots); }   // a day missing from the week plan uses the normal slots;   // Sunday is lighter on Timsauti
const dataDir = (k) => path.join(ROOT, 'data', k);
const load = (k) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(k), 'posts.json'), 'utf8')); } catch (e) { return []; } };
const save = (k, posts) => fs.writeFileSync(path.join(dataDir(k), 'posts.json'), JSON.stringify(posts, null, 1));
const audit = (k, o) => fs.appendFileSync(path.join(dataDir(k), 'audit.jsonl'), JSON.stringify(Object.assign({ ts: iso(Date.now()) }, o)) + '\n');
const mask = (s) => String(s || '').replace(/access_token=[^&"\s]+/g, 'access_token=***').replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- text rules ----------
const BANNED = /\b(testament|whether|game[- ]?changer|unlock the power|delve|dive in|buckle up|revolutionise|supercharge|are you ready|in today's fast[- ]paced world)\b/i;
// common Kiswahili and Sheng words: the owner wants English only (1 Nov 2026)
const SWAHILI = /\b(mambo|vipi|habari|wasee|wakenya|sana|hii|hiyo|yetu|yenu|karibu|asante|twende|pole pole|jameni|sasa|niaje|ndio|hapana|kwa sababu|mtaa|utueleze|tukusikie|zenu|chini|uko|mko|wapi|leo|jana|kesho|watu|mama mboga)\b/i;
function clean(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[^.!?\n]*timsauti\.com[^.!?\n]*[.!?]?/gi, '')   // the website is not active: drop any sentence that mentions it
    .replace(/(https?:\/\/)?(www\.)?timsauti\.com/gi, '')
    .replace(/[ \t]+([.,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const SYSTEM_T = `You are the content writer for TIMSAUTI DIGITAL AGENCY (Timsauti Ltd), a digital marketing, PR, communication, branding and content agency in Machakos Town, Kenya. You write Facebook posts for Kenyan business owners, entrepreneurs, professionals and marketers.
Rules:
- British English only, never Kiswahili or Sheng. Natural, professional, warm and specific. No hype, no exaggerated claims.
- Never ask readers to comment, like, share, tag, type or vote (no "tell us in the comments", "drop a comment", "share with a friend"): Facebook treats that as engagement bait and cuts reach. End instead with a natural, specific question people will want to answer, such as "Which school are you wishing the best as KCSE kicks off today?"
- Plain text only: no emojis, no bullet symbols, no long dashes, no decorative punctuation. Short paragraphs.
- Never use: "in today's fast-paced world", "game-changer", "unlock the power", "delve", "dive in", "buckle up", "revolutionise", "supercharge", "are you ready", "testament", "whether".
- Never invent facts, figures, quotations, sources, clients, testimonials, awards, results, percentages, studies or credentials.
- Never greet by time of day.
- Education posts (B): one practical takeaway the reader can use without buying anything. No statistics. End with one short, genuine question inviting business owners to share their experience (never ask for likes, shares or tags).
- Services posts (C): a clear business benefit; no invented clients or results; no guarantees. End with: Call or message us on 0733 566 667 or 0728 245 824. Never mention a website.
- Engagement posts (D): one genuine, useful question. No bait.
- Do not put URLs or hashtags inside "caption".
- Output ONLY one JSON object.`;
const MK_STYLE = fs.readFileSync(path.join(__dirname, 'makasa_style.txt'), 'utf8');
const SYSTEM_M = `You write Facebook posts for the Page of TIMOTHY MAKASA (Timothy Muli Makasa): a Kenyan storyteller, author, preacher, customer relations trainer and marketing consultant from Machakos, Ukambani. His followers are Kenyan adults: believers, young professionals, parents, students and business people.
Write exactly the way he writes. Study these real posts of his, which his followers loved (learn the voice, structure and rhythm; never copy them):
-----
${MK_STYLE}
-----
His style:
- A short bold TITLE in capital letters on the first line, then on the next line: As written by Timothy Makasa
- Then the piece in short paragraphs, warm and conversational, like he is talking to friends, in English only (never Kiswahili or Sheng words or greetings). Vary how posts open: sometimes a question, sometimes a scene, sometimes a short bold statement, only now and then "Good people" or "Let me tell you". Never open two posts in a row the same way. British English only.
- Rooted in real Kenyan and Ukambani life: Machakos, Kitui, Makueni, Tala, Kangundo, matatus, market days, shambas, church, school, family, chamas, hustling.
- End with one warm natural question people will want to answer from their own experience (for example "Who taught you this lesson?", "What would you add?", "Who do you know who lives like this?"). Questions that invite real sharing are good. No "type Amen", no "like and share".
Honesty rules (very important):
- Never invent events in Timothy's own life. Do not write "I", "yesterday I", "when I was in" about things that did not happen. Write as a reflection, teaching or observation ("Many of us", "Picture a mama mboga at the stage", "There is a man in the Bible"), or retell a Bible story, a proverb or a general Kenyan scene.
- Never write "(True Story)" unless the owner's own notes are provided.
- Never invent statistics, quotes from real people, news or events. No politics, no medical claims, no financial promises.
- Scripture: quote word for word only when certain of the King James wording; otherwise paraphrase and give the reference. Never attack any church or religion.
- Business ideas: practical and honest; never promise income, never give prices or profit figures, never recommend borrowing, betting, forex, crypto or pyramid schemes.
- Never ask readers to comment, like, share, tag, type or vote (no "tell us in the comments", "drop a comment", "share with a friend"): Facebook treats that as engagement bait and cuts reach. End instead with a natural, specific question people will want to answer, such as "Which school are you wishing the best as KCSE kicks off today?"
- Plain text only: no emojis, no bullet symbols, no long dashes, no hyphens used as dashes. Never use the words "testament" or "whether". Never greet by time of day.
- Output ONLY one JSON object.`;
const ANGLES = { B: ['a short checklist written as plain sentences', 'one common mistake and how to fix it', 'a quick before and after example from a Kenyan small business', 'a myth versus reality explanation', 'three practical steps'], C: ['the problem a business owner faces, then how the service helps', 'what a client actually receives from this service', 'a practical sign that a business needs this service', 'how the service saves the owner time'], D: ['an open question', 'a simple either or question', 'a short scenario followed by a question'] };

function prompt(page, cat, topic, recent) {
  const avoid = recent.length ? '\n\nRecent posts (do not repeat their ideas or wording):\n' + recent.map((h) => '- ' + h).join('\n') : '';
  if (page.key === 'timsauti') {
    const label = { B: 'marketing and business education', C: 'Timsauti services and expertise', D: 'audience engagement' }[cat];
    return { system: SYSTEM_T, user: `Category ${cat}: ${label}. Topic: ${topic}. Angle: ${pick(ANGLES[cat])}.${avoid}
Return JSON: {"headline":"opening line, max 120 characters","caption":"full post text, 300 to 900 characters","hashtags":["at most two, without #"],"poster":{"headline":"bold poster headline, 3 to 6 words, no numbers or prices","highlight":"one or two words from that headline to show in red","subtitle":"short line, max 10 words","points":["2 or 3 short points, max 4 words each, no numbers"]},"risk_level":"low|medium|high"}` };
  }
  const label = { M: 'LIFE LESSON: a reflection on life, purpose, discipline, money, family, friendship or work, told through a relatable Kenyan scene', F: 'FAITH: a deep, encouraging Bible truth, told through a Bible story or an everyday Kenyan picture, with the scripture reference', K: 'BUSINESS IDEA: one practical, low capital business idea a Kenyan can start, explained simply and honestly in his storytelling voice' }[cat];
  const shape = '{"title":"the bold title in capital letters, 3 to 9 words","body":"' + (cat === 'K' ? '800 to 1500 characters: the idea and the everyday need it meets; who it suits; how to start small; three practical first steps written as sentences; one honest risk and how to manage it' : '600 to 1300 characters') + ', in short paragraphs, ending with one warm question inviting comments","reference":"' + (cat === 'F' ? 'the Bible reference' : '') + '","hashtags":["at most one"],"risk_level":"low|medium|high"}';
  return { system: SYSTEM_M, user: `Write one ${label}. Theme: ${topic}.${avoid}\nReturn JSON: ${shape}` };
}

async function gemini(p) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('GEMINI_API_KEY missing');
  let last;
  for (const m of GEMINI.models) {
    try {
      const r = await fetch(`${GEMINI.base}/models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: 'user', parts: [{ text: p.user }].concat(p.audio ? [{ inline_data: { mime_type: p.audio.mime, data: p.audio.data } }] : []) }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }) });
      const j = await r.json();
      if (!r.ok) { last = new Error('gemini ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); continue; }
      const t = (((j.candidates || [])[0] || {}).content || {}).parts.map((x) => x.text || '').join('');
      return JSON.parse(t.replace(/^```json\s*|```\s*$/g, ''));
    } catch (e) { last = e; }
  }
  throw last;
}

// research with Google Search (Gemini grounding): a plain factual brief with the sources it used
async function geminiSearch(question) {
  const key = process.env.GEMINI_API_KEY; if (!key) return { text: '', links: [] };
  for (const m of GEMINI.models) {
    try {
      const r = await fetch(`${GEMINI.base}/models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }) });
      const j = await r.json(); if (!r.ok) { geminiSearch.last = (m + ' ' + r.status + ' ' + JSON.stringify(j.error || j)).slice(0, 300); continue; }
      const c = (j.candidates || [])[0] || {}; const text = ((c.content || {}).parts || []).map((x) => x.text || '').join('');
      const links = (((c.groundingMetadata || {}).groundingChunks) || []).map((g) => g.web && (g.web.title || g.web.uri)).filter(Boolean).slice(0, 6);
      geminiSearch.last = m + ' ok, text ' + text.length + ', finish ' + c.finishReason; if (text) return { text, links };
    } catch (e) {}
  }
  return { text: '', links: [] };
}

// ---------- pictures ----------
const PEOPLE = path.join(__dirname, 'assets', 'people');
const MK_PHOTOS = path.join(ROOT, 'photos', 'makasa');
function leastUsed(dir, posts, prefix, ok) {
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f) && !/^profile\./i.test(f) && (!ok || ok(f)));
  const cnt = {}; for (const p of posts) { const id = p.image && p.image.photoId; if (id && id.startsWith(prefix)) cnt[id.slice(prefix.length)] = (cnt[id.slice(prefix.length)] || 0) + 1; }
  const least = Math.min(...files.map((f) => cnt[f] || 0)); return pick(files.filter((f) => (cnt[f] || 0) === least));
}
function design(page, post, posts) {
  const out = path.join(dataDir(page.key), 'images'); fs.mkdirSync(out, { recursive: true });
  if (post.english) {   // English Corner: a clean white card by design (owner, 14 Nov), the one Sauti graphic without a photo
    const file = path.join(out, post.id + '.png'); fs.writeFileSync(file, require('./card').englishCard(post.english));
    return { file: path.relative(ROOT, file), photoId: null, layout: 'english' };
  }
  if (post.wit) {   // Makasa wit card (owner, 12 Nov): text on a note card, signed with his name
    const file = path.join(out, post.id + '.png'); fs.writeFileSync(file, require('./card').witCard({ lines: post.wit }));
    return { file: path.relative(ROOT, file), photoId: null, layout: 'wit' };
  }
  let png, photoId = null, layout;
  if (page.key === 'sauti') {
    const s = post.sauti || {}; layout = 'sauti';
    // owner rule (3 Nov): nine in ten posts carry a photo; a story with no photo of its own takes a fitting photo from the topic bank
    // owner rule (4 Nov): no graphic without a photo. A named leader gets their own photo; anything else a fitting topic photo
    if (!s.photo && !s.designed) { try { const bp = SAUTI.bankPhoto([s.card, post.headline].join(' '), dataDir('sauti')); if (bp && !(s.avoid || []).includes(path.basename(bp.file))) { s.photo = path.relative(ROOT, bp.file); s.credit = bp.credit || ''; s.wide = bp.wide || null; post.sauti = s; } } catch (e) {} }
    if (!s.photo && !s.designed) {
      // owner rule (10 Nov): no photo over and over. The photo least recently on a poster wins, and one on the last 200 posters is not repeated while another fits
      const tp = SAUTI.topicPhoto([s.photoHint || '', s.label, s.card, post.headline, post.caption].join(' '), dataDir('sauti'), { ago: SAUTI.recentUse(dataDir('sauti'), posts.filter((q) => q !== post)), avoid: s.avoid || [] });
      if (tp) { s.photo = path.relative(ROOT, tp.file); s.credit = tp.credit; s.photoFits = !!tp.fits; post.sauti = s; }
    }
    const logo = undefined;   // the cleaned logo in agent/assets/sauti_logo.png
    png = sautiCard({ label: s.label, text: s.card || post.headline, sub: s.sub, highlight: s.highlight, wide: s.photo ? s.wide || null : null, bg: s.photo ? path.join(ROOT, s.photo) : null, credit: s.photo ? s.credit : '', logo });
  } else if (page.key === 'timsauti') {
    const f = leastUsed(PEOPLE, posts, 'lib:'); photoId = 'lib:' + f; layout = 'clean';
    const P = post.poster || { headline: post.headline.split(' ').slice(0, 7).join(' '), points: [] };
    png = renderCard({ layout: 'clean', text: P.headline, poster: P, seed: post.id, bg: path.join(PEOPLE, f) });
  } else {
    // his real photo, as it is: the words live in the caption (this is what his followers respond to)
    const f = leastUsed(MK_PHOTOS, posts, 'own:', (x) => { try { const e = JSON.parse(fs.readFileSync(path.join(MK_PHOTOS, 'faces.json'), 'utf8'))[x]; return !!e && !e.skip; } catch (e) { return false; } }); photoId = 'own:' + f; layout = 'photo';
    let faces = {}; try { faces = JSON.parse(fs.readFileSync(path.join(MK_PHOTOS, 'faces.json'), 'utf8')); } catch (e) {}
    const framed = photoFrame(path.join(MK_PHOTOS, f), faces[f]);   // never let Facebook crop it: we frame it ourselves around his face
    if (!framed) throw new Error('No safe framing for ' + f + ': photo skipped so his head is never cut');
    png = framed.png || framed;
    const ext = '.png';
    const file = path.join(out, post.id + ext); fs.writeFileSync(file, png);
    return { file: path.relative(ROOT, file), photoId, layout, sha: crypto.createHash('sha256').update(png).digest('hex') };
  }
  const buf = png.png || png; const file = path.join(out, post.id + '.png'); fs.writeFileSync(file, buf);
  return { file: path.relative(ROOT, file), photoId, layout, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

function composeMessage(page, p) {
  const extra = (p.hashtags || []).map((h) => String(h).replace(/[^\p{L}\p{N}_]/gu, '')).filter((h) => h && !page.tags.some((b) => b.toLowerCase() === h.toLowerCase())).slice(0, 2);
  return clean(p.caption) + '\n\n' + page.tags.concat(extra).map((h) => '#' + h).join(' ');
}

// ---------- writing ----------
async function writeSauti(page, posts, slotAt, cat) {
  let item = null, own = null, real = cat;
  if (cat === 'Q') {   // the morning local question (owner, 6 Nov: "best food spot in Machakos" worked; ask such questions for Machakos, Makueni and Kitui in turn)
    if (slotAt - Date.now() > 3 * 3600000) return null;   // full runs are 5 hours apart (free GitHub minutes), so decide within 3 hours
    const COUNTIES = ['Machakos', 'Makueni', 'Kitui']; const county = COUNTIES[Math.floor(Date.parse(eatDate(slotAt) + 'T12:00:00Z') / 86400000) % 3];
    const past = posts.filter((p) => p.category === 'Q').slice(-30).map((p) => p.headline);
    const d = await gemini({ system: SAUTI.SYSTEM_S, user: `Write Sauti Media's morning LOCAL QUESTION for ${county} County. It is a light, fun, proudly local question that people from ${county} love to answer from their own experience, like "Which spot serves the best food in Machakos town?", "Where is the best nyama choma in ${county}?", "Which is the most beautiful scenic spot in ${county}?", "Which market in ${county} has the best prices?", "Which ${county} town has the friendliest people?", "Which local dish from ${county} should every visitor try?", "Which school in ${county} produced the best athletes?", "Which ${county} road needs urgent repair?", "Where do young people in ${county} go to unwind on weekends?". Name real kinds of places, never invent business names. Avoid anything political, sad or divisive. Do not repeat these recent questions: ${past.join(' | ') || 'none'}.
Rules: English only. A short warm opening of one or two sentences that sets the scene in ${county}, then the question as the last line. 40 to 90 words. Never ask readers to comment, like, share or tag. No dashes, no emojis, never "testament" or "whether".
Return JSON: {"card":"the question for the poster, at most 10 words, ending with ?","caption":"the post","photo_topic":"one of: food, market, nature, town, school, road, sport, people"}` });
    const pt = ({ food: 'business market', market: 'business market', nature: 'farming', town: 'business', school: 'education school', road: 'transport road', sport: 'business', people: 'business market' })[String(d.photo_topic || '').toLowerCase()] || 'business';   // the topic bank's nearest everyday Kenya photos; never Parliament for a fun question
    own = { topic: 'local question ' + county + ' ' + clean(d.card || ''), label: county.toUpperCase() + ' ASKS', card: clean(d.card || ''), sub: '', highlight: true, caption: clean(d.caption || ''), photoHint: pt };
    if (!own.card || own.caption.length < 60) own = null;
  }
  if (NEWS_SLOTS[cat]) {
    if (slotAt - Date.now() > 90 * 60000) return null;   // decide news slots close to their time, so fresh approved news can take them
    item = SAUTI.takeApproved(dataDir('sauti'), cat === 'W' ? ['profile'] : ['tip', 'news']);
    if (!item) real = NEWS_SLOTS[cat];
  }
  if (real === 'R') {   // Sunday evening: the week's biggest local stories in one post
    if (slotAt - Date.now() > 4.5 * 3600000) return null;
    const week = posts.filter((p) => p.fromNews && p.status === 'PUBLISHED' && Date.now() - Date.parse(p.publishedAt) < 7 * 86400000)
      .sort((a, b) => ((b.metrics && b.metrics.score) || 0) - ((a.metrics && a.metrics.score) || 0)).slice(0, 8);
    if (week.length < 3) real = 'Q';
    else {
      const d = await gemini({ system: SAUTI.SYSTEM_S, user: `Write "UKAMBANI THIS WEEK", a Sunday evening roundup of the 5 biggest stories Sauti Media covered this week, using ONLY these posts (one short line each, most important first, no new facts):\n${week.map((p, i) => (i + 1) + '. ' + String(p.caption).slice(0, 400)).join('\n')}\nReturn JSON: {"caption":"a one line opening, then the 5 stories numbered 1 to 5, each one short line, then one line inviting readers to share which story mattered most to them","card":"UKAMBANI THIS WEEK"}` });
      own = { topic: 'roundup ' + eatDate(slotAt), label: 'This week', card: clean(d.card || 'Ukambani this week'), sub: 'The 5 stories that mattered', caption: clean(d.caption || '') };
    }
  }
  if (real === 'V') {   // talk of the day: decided close to its time, from the news already out; skipped on a day the owner booked his own debate post
    if (slotAt - Date.now() > 4.5 * 3600000) return null;
    if (posts.some((p) => p.category === 'OWNER' && p.talk && p.publishedAt && eatDate(Date.parse(p.publishedAt)) === eatDate(slotAt))) return null;
    own = await SAUTI.writeTalk(posts, gemini, clean, dataDir('sauti')); if (!own) return null;
  }
  if (real === 'X') {   // the weekly debate, written close to its time from the week's news
    if (slotAt - Date.now() > 4.5 * 3600000) return null;
    const week = posts.filter((p) => p.status === 'PUBLISHED' && p.publishedAt && Date.now() - Date.parse(p.publishedAt) < 7 * 86400000 && (p.fromNews || p.owner)).map((p) => '- ' + String(p.headline || '').slice(0, 140)).slice(-40);
    const past = posts.filter((p) => p.category === 'X' || (p.sauti && /debate/i.test(p.sauti.label || ''))).map((p) => p.headline).slice(-10);
    const d = await gemini({ system: SAUTI.SYSTEM_S, user: `Write this Friday's DEBATE post for Sauti Media, a Kenyan news Page rooted in Ukambani with readers across Kenya. Pick ONE intriguing, current question Kenyans are already arguing about, drawn from this week's stories below or from national politics, the economy, leadership, devolution or society. It should make people stop and want to give their view.
This week's stories:
${week.join('\n')}
Do not repeat these past debates: ${past.join(' | ') || 'none yet'}
Also avoid these subjects the owner has asked to rest: ${(() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir('sauti'), 'skip_topics.json'), 'utf8')).filter((x) => !x.until || Date.parse(x.until) > Date.now()).map((x) => x.word).join(', '); } catch (e) { return 'none'; } })()}.
Shape, with a blank line between parts: line 1 "DEBATE"; then a short opening paragraph that sets the scene with the facts; then the question itself in one or two sentences; then "Those who say yes" paragraph; then "Those who say no" paragraph; then the line "This is a debate, not a claim."; then the closing question.
Timing: the question must be about something live NOW or due within the next year (2027 at the very latest). Never a debate about 2032 or other far off elections; it is too early for those.
Rules: English only. Pose the question boldly but fairly. Give the case people make FOR it and the case AGAINST it, one short paragraph each, both fair. Never state as fact that a named person committed a crime, took a bribe or did wrong; a political question about a public figure's strategy is fine. Never name private individuals. Say plainly once that this is a debate, not a claim. End with one natural, specific question to the reader. Never ask readers to comment, like, share or tag. No dashes, no emojis, no hashtags, never the words "testament" or "whether". 120 to 220 words.
Return JSON: {"topic":"short topic","card":"the debate question for the poster, at most 12 words, ending with ?","person":"full name of the one public figure the question is about, or empty","caption":"the post, starting with the line DEBATE"}` });
    let ph = null; try { ph = (d.person && SAUTI.bankPhoto(d.person, dataDir('sauti'))) || SAUTI.bankPhoto(String(d.card || '') + ' ' + String(d.topic || ''), dataDir('sauti')) || (d.person && await SAUTI.leaderFromNews(d.person, gemini)); } catch (e) {}
    own = { topic: 'debate ' + clean(d.topic || d.card || ''), label: 'DEBATE', card: clean(d.card || ''), sub: '', highlight: true, caption: clean(d.caption || ''),
      photo: ph ? path.relative(ROOT, ph.file) : null, photoCredit: ph ? (ph.credit || '') : '', photoWide: ph && ph.wide ? ph.wide : null };   // no leader photo: the design step finds a fitting topic photo
    if (!own.card || own.caption.length < 300) return null;
  }
  if (!item && !own && real === 'D') own = await SAUTI.writeDidYouKnow(posts, gemini, clean);
  if (!item && real === 'D' && !own) real = 'Q';   // no fact passed the check: ask a question instead
  const dayHint = X.calendarHint('sauti', eatDate(slotAt));
  if (!item && real === 'B') own = await SAUTI.writeBusinessTip(posts, gemini, clean, dayHint);
  if (!item && !own) own = await SAUTI.writeOwn(real, posts, gemini, clean, dayHint);
  const src = item || own;
  const caption = clean(src.caption || '');
  const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: 'sauti', category: real, topic: item ? (item.title || item.text || '').slice(0, 120) : own.topic, headline: clean(src.card || caption.split('\n')[0]).slice(0, 160),
    cardText: '', reference: '', caption, hashtags: [], scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY', fromNews: item ? item.key : undefined, source: (item && item.sourceLink) || (own && own.source) || undefined,
    sauti: { label: src.label, card: src.card, sub: src.sub || '', highlight: !!src.highlight, photoHint: (own && own.photoHint) || undefined, photo: item && item.photo ? item.photo : (own && own.photo) || null, credit: (item && item.photoCredit) || (own && own.photoCredit) || '', wide: (item && item.photoWide) || (own && own.photoWide) || null } };
  if (caption.length < 60 || BANNED.test(caption) || SWAHILI.test(caption)) { post.status = 'REJECTED'; post.reasons = [caption.length < 60 ? 'too_short' : SWAHILI.test(caption) ? 'kiswahili' : 'banned_word']; return post; }
  if (posts.slice(-80).some((p) => p.headline && p.headline.toLowerCase() === post.headline.toLowerCase())) { post.status = 'REJECTED'; post.reasons = ['duplicate']; return post; }
  if (item) post.previewed = true;   // the owner already approved it
  post.image = design(page, post, posts);
  return post;
}
// Sauti Media: approved news and tips go out at once; up to 3 a run (now, plus two booked on Facebook 20 and 40 minutes later)
// Sauti Media sets its own pace from its results (the owner allowed it to adjust): once a day it compares views of
// news posts that went out close together (under 30 minutes apart) with posts spaced further apart, and the reach of
// busy days against quieter days, then picks how many stories go out per run, how far apart, and a daily ceiling.
const NEWS_PER_DAY = 40;   // owner, 11 Nov: up to 40 news stories a day (30 from 4 Nov), spread from 6am to 10.30pm; breaking and trending stories may add up to 8 more
function sautiPace(posts, notes) {
  const today = eatDate(Date.now()); const cur = STATE.sautiPace || { perRun: 3, gapMin: 20, dailyMax: NEWS_PER_DAY, day: '' };
  if (cur.day === today) { if (cur.dailyMax === 30) cur.dailyMax = NEWS_PER_DAY; return cur; }   // the day the number was raised: lift the old 30 at once
  const pub = posts.filter((p) => p.status === 'PUBLISHED' && p.publishedAt).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const rows = []; for (let i = 1; i < pub.length; i++) { const p = pub[i]; if (!p.fromNews || !p.metrics || typeof p.metrics.reach !== 'number') continue; const age = Date.now() - Date.parse(p.publishedAt); if (age < 86400000 || age > 8 * 86400000) continue; rows.push({ gap: (Date.parse(p.publishedAt) - Date.parse(pub[i - 1].publishedAt)) / 60000, reach: p.metrics.reach, day: eatDate(Date.parse(p.publishedAt)) }); }
  const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const close = rows.filter((r) => r.gap < 30).map((r) => r.reach), spaced = rows.filter((r) => r.gap >= 30).map((r) => r.reach);
  const next = Object.assign({}, cur, { day: today });
  let why = 'not enough results yet, keeping the current pace';
  if (close.length >= 8 && spaced.length >= 8) {
    const ratio = med(close) / Math.max(1, med(spaced));
    if (ratio < 0.6) Object.assign(next, { perRun: 2, gapMin: 40 }); else if (ratio < 0.85) Object.assign(next, { perRun: 2, gapMin: 30 }); else Object.assign(next, { perRun: 3, gapMin: 20 });
    why = `posts under 30 minutes apart got ${Math.round(ratio * 100)}% of the views of spaced posts (${med(close)} against ${med(spaced)})`;
    const days = {}; for (const r of rows) (days[r.day] = days[r.day] || []).push(r.reach);
    const busy = Object.values(days).filter((d) => d.length > 15).map((d) => d.reduce((a, b) => a + b, 0)), calm = Object.values(days).filter((d) => d.length <= 15).map((d) => d.reduce((a, b) => a + b, 0));
    if (busy.length >= 2 && calm.length >= 2) { next.dailyMax = med(busy) < med(calm) ? 15 : 60; why += `; busy days reached ${med(busy)} in total against ${med(calm)} on calmer days`; }
  }
  next.why = why;
  // the weekly review sets a ceiling (STATE.sautiCap); the daily check may slow down further but never go faster than it
  const cap = STATE.sautiCap; if (cap) { next.perRun = Math.min(next.perRun, cap.perRun); next.gapMin = Math.max(next.gapMin, cap.gapMin); next.dailyMax = Math.min(next.dailyMax, NEWS_PER_DAY); } else next.dailyMax = Math.min(next.dailyMax, NEWS_PER_DAY);   // the daily number is the owner's (40); the slowdown to 15 on proof of over posting still applies
  if (next.perRun !== cur.perRun || next.gapMin !== cur.gapMin || next.dailyMax !== cur.dailyMax) { notes.push(`Sauti Media pace adjusted: up to ${next.perRun} stories an hour, ${next.gapMin} minutes apart${next.dailyMax < 60 ? ', at most ' + next.dailyMax + ' a day' : ''}. Reason: ${why}.`); audit('sauti', { event: 'pace_changed', from: cur, to: next }); }
  STATE.sautiPace = next; return next;
}
// ---------- final editor check: every post is looked at (picture and words together) before it goes out ----------
// Fails closed: if the check cannot run, nothing is posted.
// owner, 13 Nov ("correct this once and for all"): one focused question, asked of the PHOTO ALONE (not the poster with its headline,
// which makes almost any picture look fitting): does this picture show this story's own person, place or thing? 1 to 5.
// A stock photo needs 4 or 5 (the same kind of place or thing as the story, e.g. a court building for a court case); the story's own
// photo, a leader's photo or the owner's photo needs 3. Anything lower never goes out: the story waits.
async function photoMatch(post) {
  const s = post.sauti || {}; if (!s.photo) return { ok: false, score: 0, why: 'no photo' };
  if (/[\\/]o_|owner_/.test(s.photo) || post.owner) return { ok: true, score: 5, why: 'owner supplied' };
  const stock = /c_topic_|[\\/]topics[\\/]/.test(s.photo);
  let b64; try { b64 = fs.readFileSync(path.join(ROOT, s.photo)).toString('base64'); } catch (e) { return { ok: false, score: 0, why: 'photo missing' }; }
  const story = String(post.caption || '').replace(/\s+/g, ' ').slice(0, 600);
  try {
    const v = await gemini({ system: 'You are a strict picture editor at a Kenyan newsroom. You never let a misleading picture run. Output only JSON.',
      user: `Headline: "${post.headline}". Story: "${story}".
Look ONLY at this photograph. Would a reader looking at it with the headline feel it truly shows this story? Score:
5 = it shows this story's own person, people, place or event.
4 = it shows exactly the same kind of thing the story is about, in a Kenyan setting (a court building for a court case, a police vehicle or officers for an arrest, a maize field for a maize pest, a matatu or road for a road story, a hospital for a health story), with nothing that contradicts the story.
3 = it shows something in the same broad area only.
2 or 1 = it shows something else (a campus for a sick child, a bush fire for a gun arrest, a skyline for farming), or it could mislead.
Also 1 if it shows a different named person than the story is about. Return JSON {"score":1-5,"shows":"what the photo shows, in a few words","why":"few words"}`,
      audio: { mime: 'image/jpeg', data: b64 } });
    const sc = Number(v && v.score) || 0;
    return { ok: sc >= (stock ? 4 : 3), score: sc, why: String((v && (v.shows + ': ' + v.why)) || '').slice(0, 160) };
  } catch (e) { return { ok: false, score: 0, why: 'photo test could not run' }; }
}
async function finalCheck(page, post) {
  // engagement bait lines (asking people to comment, share or tag) are removed: Facebook cuts reach for them
  post.caption = String(post.caption || '').split('\n').filter((l) => !X.BAIT.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const cap = post.caption;
  const problems = [];
  if (page.key === 'sauti' && post.fromNews && cap.length < 250) problems.push('story too thin');
  if (SWAHILI.test(cap)) problems.push('kiswahili');
  if (/found unique ways|has been doing great|various ways|many things/i.test(cap)) problems.push('vague filler');
  if (page.key === 'sauti' && !post.english && !(post.sauti && (post.sauti.photo || post.sauti.designed))) problems.push('poster has no photo (owner rule: no graphic without a photo)');
  if (problems.length) return { pass: false, problems };
  if (page.key === 'sauti' && post.sauti && post.sauti.photo) {
    const pm = await photoMatch(post); post.sauti.photoScore = pm.score;
    if (!pm.ok) return { pass: false, problems: [`poster photo does not fit the story (picture test ${pm.score} of 5: ${pm.why})`] };
  }
  let img; try { img = fs.readFileSync(path.join(ROOT, post.image.file)).toString('base64'); } catch (e) { return { pass: false, problems: ['no poster'] }; }
  // a photo poster that came out mostly pure black or pure white is broken (a photo that failed to draw)
  if ((post.sauti && post.sauti.photo) || (page.key === 'makasa' && !post.wit)) {
    try {
      let ff = 'ffmpeg'; try { ff = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
      const px = require('child_process').execFileSync(ff, ['-v', 'error', '-i', path.join(ROOT, post.image.file), '-vf', 'scale=24:30,format=gray', '-f', 'rawvideo', '-'], { timeout: 30000 });
      const flat = [...px].filter((v) => v < 18 || v > 240).length / px.length;
      if (flat > 0.5) return { pass: false, problems: ['poster photo did not draw (mostly blank)'] };
    } catch (e) {}
  }
  const extra = (post.sauti && post.sauti.designed) ? ' This is a deliberate clean designed news poster with no photo, used because no honest photo of this story exists (the owner prefers it to a misleading photo); do not fail it for having no photo.' : post.english ? ' This is the English Corner: a deliberate clean white lesson card with no photo by design (the owner asked for it); do not fail it for having no photo, and check the English on it is correct.' : post.wit ? ' This is a deliberate text card (dark background, note paper, red circles), with no photo by design; do not fail it for having no photo.' : page.key === 'makasa' ? ' The photo is of the Page owner: his whole head and face must be fully in view, never cut at the top.' : '';
  try {
    const v = await gemini({ system: 'You are the strict chief editor of a professional Kenyan Facebook Page. You approve only posts you would be proud to publish. Output only JSON.',
      user: `Check this ${page.name} post. The image is the poster that goes with it.${extra}
TODAY IS ${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} (Nairobi time).
FAIL it if ANY of these is true:
0. It presents something already past as current or coming: a forecast, event, deadline, exam date or period that ended before today, or old news told as new.
1. The poster looks broken: mostly empty, an unintended black or white area, a box or shape covering part of it, or a picture that is a map, chart, diagram or drawing. ${(post.sauti && post.sauti.designed) ? '(This poster is a deliberate clean designed text poster with no photo, approved by the owner: judge only that it looks clean, balanced and finished.)' : post.english || post.wit ? '' : '(Every poster must carry a real photograph: a poster with no photo fails.)'}
2. The poster photo does not fit the story, or shows dead or injured people. Be strict: the photo must show this story's own person, people, place or a scene of the very thing reported. A general picture (a campus, a building, a sculpture, a landscape, a fire or a vehicle from somewhere else) does NOT fit a story about a particular person, a crime, a donation, a death or any human story; FAIL it.
3. The poster text is hard to read or cut off.
4. The post text is vague or incomplete: a news story that does not say who, what and where (for national stories, "Kenya" or "across the country" is enough); filler sentences with no facts; or it ends abruptly.
5. The text and the poster are about different things.
5b. The photo itself carries another media house's logo or watermark (for example the TUKO, NTV, Citizen, Nation or KTN logo printed on the picture), or a grey or blank strip across part of the photo. Our own small credit line in the bottom corner (for example "Photo: Kenyans.co.ke") is required and is NOT a watermark; never fail a poster for it. The red and blue "Sauti Media, The Voice of Reason" logo in the top right corner is OUR OWN logo and must be there; never fail a poster for it.
6. It accuses a named person, family, business or group of wrongdoing without saying an official body confirmed it.
8. It explicitly asks readers to comment, like, share, tag or type something (engagement bait), with words such as "comment", "drop", "tell us below", "share", "tag", "type". A question on the poster or at the end of the text (for example "Which market in Makueni has the best prices?") is NOT engagement bait and is fine, because it does not tell anyone to comment; never fail a post for asking a plain question, and neither is telling readers where the lessons of a thread are ("The 9 lessons are in the comments.").
7. It contains Kiswahili or Sheng (a closing line in Kikamba written by the Page owner is allowed), emojis, or spelling and grammar mistakes.
POST TEXT:
<<<${cap.slice(0, 3500)}>>>
Return JSON: {"pass":true|false,"problems":["short reason for each failure"]}`, audio: { mime: 'image/png', data: img } });
    // our own small "Photo: outlet" credit is required; the editor sometimes mistakes it for another outlet's watermark
    const probs = ((v && v.problems) || []).filter((x) => !(/photo:\s|credit|sauti media|voice of reason/i.test(x) && /logo|watermark|brand/i.test(x)));
    const onlyCredit = v && v.pass !== true && (v.problems || []).length && !probs.length;
    return { pass: !!(v && (v.pass === true || onlyCredit)), problems: probs };
  } catch (e) { return { pass: false, problems: ['check could not run'] }; }
}
async function sautiNewsNow(page, posts, notes) {
  const pace = sautiPace(posts, notes);
  const h = new Date(Date.now() + 3 * 3600000).getUTCHours() + new Date(Date.now() + 3 * 3600000).getUTCMinutes() / 60;
  if (h < 6 || h > 22.5) return;
  // 11 Nov: on 10 Nov the whole day's 30 stories were used up by 5pm and the Page then carried no news all evening.
  // The day's stories are now spread from 6am to 10.30pm, so there is always room in the evening, and a breaking or
  // trending story is never blocked by the count (up to 8 more than the daily number).
  const doneToday = posts.filter((p) => (p.status === 'PUBLISHED' || p.status === 'PUBLISHING') && p.fromNews && eatDate(Date.parse(p.publishedAt || p.scheduledAt)) === eatDate(Date.now())).length;
  const allowedNow = Math.min(pace.dailyMax, Math.ceil(pace.dailyMax * (h - 6) / 16) + 4);
  if (doneToday >= pace.dailyMax + 8) return;
  const urgentOnly = doneToday >= allowedNow;
  const booked = posts.filter((p) => p.fromNews && p.publishedAt && Date.parse(p.publishedAt) > Date.now()).length; let rejects = 0;
  // GitHub often starts the agent only once an hour, so each run books stories ahead on Facebook, spaced out, to cover the gap
  for (let i = booked; i < Math.max(pace.perRun, 4); i++) {
    const lastNews = posts.filter((p) => p.fromNews && p.publishedAt && p.status === 'PUBLISHED').map((p) => Date.parse(p.publishedAt)).sort((a, b) => b - a)[0] || 0;
    const when = Math.max(Date.now(), lastNews + pace.gapMin * 60000);   // runs every 15 minutes, but stories stay at least gapMin apart
    if (when > Date.now() + 100 * 60000) break;   // enough already booked ahead (about the longest gap between GitHub runs)
    const item = SAUTI.takeApproved(dataDir('sauti'), ['tip', 'news'], urgentOnly || doneToday + (i - booked) >= allowedNow); if (!item) break;
    const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: 'sauti', category: 'N', topic: (item.title || item.text || '').slice(0, 120), headline: clean(item.card || '').slice(0, 160),
      cardText: '', reference: '', caption: clean(item.caption || ''), hashtags: [], scheduledAt: iso(when), createdAt: iso(Date.now()), status: 'PUBLISHING', fromNews: item.key, heat: item.heat || undefined, auto: true, source: item.sourceLink, previewed: true,
      sauti: { label: item.label, card: item.card, sub: '', photo: item.photo || null, credit: item.photoCredit || '', wide: item.photoWide || null } };
    post.image = design(page, post, posts); posts.push(post); save(page.key, posts);
    const qc = await finalCheck(page, post);
    if (!qc.pass && post.sauti && post.sauti.photo && /photo|picture|image|logo|watermark/i.test((qc.problems || []).join(' '))) {   // a wrong photo: try once more as a clean text poster
      audit('sauti', { event: 'photo_changed_by_final_check', id: post.id, problems: qc.problems });
      post.sauti.avoid = (post.sauti.avoid || []).concat(path.basename(post.sauti.photo)); post.sauti.photo = null; post.sauti.credit = ''; post.sauti.wide = null;
      const own = await SAUTI.storyPhotos(post.headline || (item && item.title), gemini, path.join(ROOT, 'data', 'sauti'), post.sauti.avoid).catch(() => null);
      if (own) { post.sauti.photo = path.relative(ROOT, own.file); post.sauti.credit = own.credit || ''; post.sauti.ownPhoto = true; audit('sauti', { event: 'story_photo_from_other_report', id: post.id }); }
      post.image = design(page, post, posts); save(page.key, posts);
      Object.assign(qc, await finalCheck(page, post));
    }
    // owner, 11 Nov: a breaking or trending story is not dropped because no exact photo exists. It goes out with a closely related photo from the
    // photo bank (places and things only, no recognisable faces). One more photo is tried first; other faults still stop the post.
    const urgentStory = /^BREAKING/i.test(String(item.label || '')) || (item.heat || 0) >= 3;
    const onlyPhotoFit = (pr) => (pr || []).length > 0 && pr.every((x) => /photo|picture|image/i.test(x) && !/recognis|identif|person|face|dead|injur|blood|body|bodies|logo|watermark|generated|drawing|grammar|spelling|fact|claim|vague|bait/i.test(x));
    const bankPhotoOn = () => /c_topic_/.test(String((post.sauti || {}).photo || '')) && !!(post.sauti || {}).photoFits;   // owner, 12 Nov: related means the same subject (a maize story gets a farm photo, never a city skyline)
    if (!qc.pass && urgentStory && onlyPhotoFit(qc.problems)) {
      if (bankPhotoOn()) { post.sauti.avoid = (post.sauti.avoid || []).concat(path.basename(post.sauti.photo)); post.sauti.photo = null; post.sauti.credit = ''; post.sauti.wide = null; post.image = design(page, post, posts); save(page.key, posts); Object.assign(qc, await finalCheck(page, post)); }
      // owner, 13 Nov: a photo that does not fit is never waved through any more; the story waits instead
    }
    // owner, 14 Nov ("you should not kill stories"): a good story is never dropped for want of a photo.
    // 3) a real photo of the PLACE or INSTITUTION in the story (Kilungu, a KMTC campus, a county headquarters); 4) else a clean designed poster
    //    with no photo at all, carrying the place line, which can never mislead. Faults other than the photo still stop the post.
    if (!qc.pass && onlyPhotoFit(qc.problems)) {
      const avoid = (post.sauti.avoid || []).concat(post.sauti.photo ? [path.basename(post.sauti.photo)] : []); post.sauti.avoid = avoid;
      const pl = await SAUTI.placePhoto(post.headline, post.caption, gemini, path.join(ROOT, 'data', 'sauti'), avoid).catch(() => null);
      if (pl) { post.sauti.photo = path.relative(ROOT, pl.file); post.sauti.credit = pl.credit || ''; post.sauti.wide = pl.wide || null; if (!post.sauti.sub && pl.place) post.sauti.sub = pl.place; post.image = design(page, post, posts); save(page.key, posts); Object.assign(qc, await finalCheck(page, post)); if (qc.pass) audit('sauti', { event: 'place_photo_used', id: post.id, place: pl.place }); }
    }
    if (!qc.pass && onlyPhotoFit(qc.problems)) {
      const pl = SAUTI.placePhoto.lastPlace || '';
      post.sauti.photo = null; post.sauti.credit = ''; post.sauti.wide = null; post.sauti.designed = true; if (!post.sauti.sub && pl) post.sauti.sub = pl;
      post.image = design(page, post, posts); save(page.key, posts); Object.assign(qc, await finalCheck(page, post)); if (qc.pass) audit('sauti', { event: 'designed_poster_used', id: post.id });
    }
    if (!qc.pass) { post.status = 'REJECTED_QC'; post.qc = qc.problems; audit('sauti', { event: 'rejected_by_final_check', id: post.id, problems: qc.problems }); save(page.key, posts); if (++rejects <= 6) i--; continue; }
    try {
      let r = null;
      const reelsToday = posts.filter((p) => p.fromNews && p.fb && p.fb.kind === 'reel' && eatDate(Date.parse(p.publishedAt)) === eatDate(Date.now())).length;
      if (false && i === 0 && reelsToday < 3) {   // Sauti news goes out as photo posts only (owner, 2 Nov)   // the first story of a run, up to 3 a day, also goes out as a short video
        try { const mp4 = path.join(ROOT, 'data', 'sauti', 'reel_tmp.mp4'); X.makeReel(path.join(ROOT, post.image.file), mp4); r = await X.publishReel(page, mp4, composeMessage(page, post)); r.kind = 'reel'; try { fs.unlinkSync(mp4); } catch (e) {} }
        catch (e) { audit('sauti', { event: 'reel_failed_used_photo', id: post.id, error: mask(e.message).slice(0, 200) }); r = null; }
      }
      if (!r) r = await publish(page, post, when > Date.now() + 11 * 60000 ? when : null);
      post.status = 'PUBLISHED'; post.publishedAt = iso(when > Date.now() + 11 * 60000 ? when : Date.now()); post.fb = r; post.permalink = r.permalink || (r.postId ? 'https://www.facebook.com/' + r.postId : null); if (when > Date.now() + 11 * 60000) post.bookedOnFacebook = true;
      audit('sauti', { event: post.bookedOnFacebook ? 'booked_on_facebook' : 'published', id: post.id, at: post.publishedAt, fb: r });
    } catch (e) { post.status = 'FAILED'; post.error = mask(e.message); audit('sauti', { event: 'publish_failed', id: post.id, error: post.error }); notes.push('Could not post on Sauti Media: ' + post.error); }
    save(page.key, posts);
  }
}
// Timsauti: a photo of real work the owner sent on Telegram ("Timsauti: ...") becomes the day's post
async function writeTimsautiWork(page, posts, slotAt) {
  const file = path.join(dataDir('timsauti'), 'work.json'); let list = []; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  const w = list.find((x) => x.status === 'NEW'); if (!w) return null;
  const d = await gemini({ system: SYSTEM_T, user: `The owner sent this note about real work Timsauti Digital Agency just did for a client. Write a short Facebook post showing the work: what the client needed, what Timsauti delivered and why it matters, using ONLY the facts in the note (no invented results, names or numbers). End with: Call or message us on 0733 566 667 or 0728 245 824.\nNote: <<<${w.text}>>>\nReturn JSON: {"headline":"opening line, max 100 characters","caption":"300 to 700 characters","hashtags":[]}` });
  const caption = clean(d.caption || ''); if (caption.length < 120) return null;
  const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: 'timsauti', category: 'W', topic: 'owner work ' + w.id, headline: clean(d.headline || caption.split('\n')[0]).slice(0, 160), cardText: '', reference: '',
    caption, hashtags: [], scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY', format: 'reel', fromWork: w.id };
  const out = path.join(dataDir('timsauti'), 'images'); fs.mkdirSync(out, { recursive: true });
  const png = workCard({ bg: path.join(ROOT, w.photo) }); const buf = png.png || png; const f = path.join(out, post.id + '.png'); fs.writeFileSync(f, buf);
  post.image = { file: path.relative(ROOT, f), photoId: 'work:' + w.id, layout: 'work', sha: crypto.createHash('sha256').update(buf).digest('hex') };
  w.status = 'USED'; w.postId = post.id; fs.writeFileSync(file, JSON.stringify(list, null, 1));
  return post;
}
// ---------- lesson threads: a hook post with a bold poster, the numbered lessons follow as the Page's own comments ----------
const THREAD_THEMES = { makasa: ['life lessons no school will teach you', 'lessons about money young people learn too late', 'truths about marriage and family nobody tells you', 'lessons from failure that build a strong life', 'habits that quietly change your life', 'lessons about friendship and the people around you', 'what faith teaches about hard seasons', 'lessons every young professional must learn early', 'lessons about customers and people that school never taught me'],
  timsauti: ['marketing mistakes small businesses keep making', 'lessons about customers every business owner must learn', 'branding truths small businesses learn too late', 'social media lessons for local businesses', 'lessons about pricing and value', 'what successful small businesses do differently'],
  // Sauti Media: public education threads ordinary Kenyans love to read and keep
  sauti: ['10 legitimate ways to make money using your phone', '10 ways to use AI to earn money online honestly', '7 ways to save money on your monthly shopping', '8 things to check before you buy land in Kenya', '7 ways to spot a fake job advert', '6 things every parent should know about the KCSE results process', '7 government services you can get on eCitizen without a queue', '8 money mistakes young Kenyans make with their first salary', '6 things to know before joining a chama', '7 ways to protect yourself from M-Pesa fraud', '7 farming practices that raise yields in dry areas', '6 things to know before taking a mobile loan', '7 ways to start a business with little capital', '6 first aid steps everyone should know'],
  // technology threads: practical, everyday tools Kenyans already use
  tech: ['10 things you did not know ChatGPT can do for you', '5 things you must know about WhatsApp', '7 WhatsApp Business features every seller should use', '7 Google tricks that save you hours', '6 ways to protect your phone and M-Pesa from fraudsters', '7 Android phone settings you should change today', '5 Facebook Page tools every business owner should use', '7 free tools to design posters and flyers on your phone', '6 signs a message or link is a scam', '5 things to do before you sell or give away your phone', '7 ways to make your phone battery last longer', '6 Google Maps features most people never use', '5 ways to use AI to grow a small business', '7 TikTok and Reels tips for business owners', '5 email habits that make you look professional'] };
async function writeThread(page, posts, slotAt, opts) {
  const used = new Set(posts.filter((p) => p.category === 'T').map((p) => p.topic));
  // Timsauti alternates: technology one week, business the next; Makasa mixes in a technology thread every third time
  const tThreads = posts.filter((p) => p.category === 'T').length;
  const useTech = page.key === 'sauti' ? false : page.key === 'timsauti' ? tThreads % 2 === 0 : tThreads % 3 === 2;
  const pool = useTech ? THREAD_THEMES.tech : (THREAD_THEMES[page.key] || THREAD_THEMES.makasa); const theme = (opts && opts.theme) || pick(pool.filter((t) => !used.has(t)).concat(pool.every((t) => used.has(t)) ? pool : []));
  const n = parseInt(theme, 10) || 7 + Math.floor(Math.random() * 3);
  const d = await gemini({ system: page.key === 'makasa' ? SYSTEM_M : page.key === 'sauti' ? SAUTI.SYSTEM_S : SYSTEM_T, user: `Write a ${useTech ? 'technology tips' : page.key === 'sauti' ? 'public education' : 'lesson'} thread for Facebook on the theme: "${theme}".
It is ORIGINAL work in the Page's own voice, rooted in Kenyan life (school, hustle, family, church, chama, matatu, Machakos), never copied from anyone.
1) A short hook post: two to four punchy lines that make people stop scrolling (for example a hard truth or a contrast), then one closing line that says where they are, using the right word for the theme (lessons, tips, ways, things, signs), for example "All ${n} ${useTech || page.key === 'sauti' ? 'tips' : 'lessons'} are in the comments." Say it once only. No hashtags, no emojis.
2) A bold poster title in capital letters, at most 8 words, starting with the number ${n} (for example "${useTech ? theme.toUpperCase() : n + ' LIFE LESSONS NO SCHOOL WILL TEACH YOU'}").
3) Exactly ${n} lessons. Each one: a number and a bold short title on the first line (for example "1. YOUR CIRCLE SHAPES YOUR FUTURE"), then 2 to 4 sentences that explain it with a real, everyday Kenyan example and end with a strong line. 250 to 550 characters each. Each lesson must stand alone and be worth reading.
English only. No invented statistics, no named real people, no medical or financial promises.${useTech ? `
TECHNOLOGY ACCURACY: describe only features and settings that really exist today and that ordinary users in Kenya can find (say where to find them, for example the menu and the option name). Never invent a feature, app, price or shortcut; if you are not sure a feature exists, leave it out and pick another. Explain each one in plain words for someone who is not technical, with a simple use from everyday Kenyan life or business.` : ''}${page.key === 'sauti' ? `
PUBLIC EDUCATION RULES (Sauti Media): every point must be practical, legal and true in Kenya today, with where or how to do it. Never promise income or give earnings figures; be honest that each way takes effort and skill. Never recommend betting, pyramid or "investment" schemes, forex signals or anything that asks for upfront fees, and warn readers about such scams where it fits. Name real services only when you are sure they exist (for example eCitizen, KRA iTax, M-Pesa), never invented ones. No medical advice beyond basic, widely taught first aid.` : ''}
Return JSON: {"image_query":"2 to 4 words for a fitting real photo of a place or thing (never a person)","title":"...","sub":"a short italic line for the poster such as (A thread by Timothy Makasa) or (A thread)","caption":"the hook post","lessons":["1. TITLE\n\nexplanation", "..."]}` });
  const lessons = (d.lessons || []).map((l) => clean(l)).filter((l) => l.length > 120);
  const caption = clean(d.caption || '');
  if ((useTech || page.key === 'sauti') && lessons.length) {   // a second look at every tip: anything that may not exist as described sends the thread back
    try {
      const v = await gemini({ system: 'You are a careful technology fact checker. Output only JSON.', user: `Check each tip below. Mark a tip doubtful if the feature, setting, menu name or claim may not exist as described for ordinary users today, or is exaggerated.\n${lessons.map((l, i) => `TIP ${i}:\n${l}`).join('\n\n')}\nReturn JSON: {"doubtful":[numbers of doubtful tips]}` });
      if (Array.isArray(v.doubtful) && v.doubtful.length) { writeThread.lastDoubt = v.doubtful; return (opts && opts.retry) ? null : writeThread(page, posts, slotAt, { retry: true, theme }); }
    } catch (e) { return null; }
  }
  if (lessons.length < Math.min(n, 6) || caption.length < 80 || lessons.some((l) => SWAHILI.test(l) || BANNED.test(l))) { writeThread.lastFail = { lessons: lessons.length, caption: caption.length, sw: lessons.map((l) => (l.match(SWAHILI) || [])[0]).filter(Boolean), banned: lessons.map((l) => (l.match(BANNED) || [])[0]).filter(Boolean) }; return null; }
  const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: page.key, category: 'T', topic: theme, headline: clean(d.title || theme).toUpperCase(), cardText: '', reference: '', caption,
    hashtags: [], scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY', format: 'photo', thread: { lessons, sub: clean(d.sub || '') } };
  // poster: his own photo (Makasa) or a library photo (Timsauti), framed so no head is ever cut
  const out = path.join(dataDir(page.key), 'images'); fs.mkdirSync(out, { recursive: true });
  let bg = null, focus = null, photoId = null;
  if (page.key === 'makasa') {
    let faces = {}; try { faces = JSON.parse(fs.readFileSync(path.join(MK_PHOTOS, 'faces.json'), 'utf8')); } catch (e) {}
    const f = leastUsed(MK_PHOTOS, posts, 'own:', (x) => !!faces[x] && !faces[x].skip && faces[x].fy >= 0.22); bg = path.join(MK_PHOTOS, f); focus = faces[f]; photoId = 'own:' + f;
    // keep his face below the title: place the face lower in the frame
    if (focus) focus = Object.assign({}, focus, { fy: Math.max(0, focus.fy - 0.12) });
  } else { const f = leastUsed(PEOPLE, posts, 'lib:'); bg = path.join(PEOPLE, f); photoId = 'lib:' + f; }
  // Timsauti keeps its house poster (white page, logo, red and navy headline, person on the right, phone numbers);
  // Makasa keeps his own photo, with the thread title over it
  const tips = post.thread.lessons.map((l) => String(l).split('\n')[0].replace(/^\d+\.\s*/, '')).map((t) => t.charAt(0) + t.slice(1).toLowerCase()).filter((t) => t.length <= 34).slice(0, 3);
  if (page.key === 'sauti') {   // Sauti keeps its house poster: a fitting real photo if one passes the photo check, else the light text poster
    const ph = await SAUTI.commonsPhoto(clean(d.image_query || theme.replace(/^\d+\s*/, '')), dataDir('sauti'), gemini, post.headline).catch(() => null);
    post.sauti = { label: 'THREAD', card: post.headline, sub: `All ${post.thread.lessons.length} are in the comments`, highlight: true, photo: ph ? path.relative(ROOT, ph.file) : null, credit: ph ? ph.credit : '' };
    post.image = design(page, post, posts); return post;
  }
  const png = page.key === 'timsauti'
    ? renderCard({ layout: 'clean', text: post.headline, seed: post.id, bg, poster: { headline: post.headline, subtitle: `A thread: all ${post.thread.lessons.length} ${/TIP|FEATURE|WAY|TRICK|THING|SIGN|TOOL|SETTING|HABIT/i.test(post.headline) ? 'tips' : 'lessons'} are in the comments`, points: tips, cta: 'READ THE THREAD' } })
    : threadCard({ title: post.headline, sub: post.thread.sub || '(A thread)', bg, focus, handle: '#AuthorMakasa' });
  const file = path.join(out, post.id + '.png'); fs.writeFileSync(file, png);
  post.image = { file: path.relative(ROOT, file), photoId, layout: 'thread' };
  return post;
}
// ---------- Sauti Media English Corner (owner, 14 Nov) ----------
// The lessons are written and checked by hand in agent/english.json, so the rule on the card is never invented; the writer only
// adds the caption around it. Lessons go in order and never repeat until all have run.
async function writeEnglish(page, posts, slotAt) {
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'english.json'), 'utf8'));
  const done = posts.filter((p) => p.english && p.status !== 'REJECTED').map((p) => p.english.id);
  const round = done.filter((id) => L.some((l) => l.id === id)).length % L.length;
  const lesson = L.find((l) => !done.slice(-(round || L.length)).includes(l.id)) || L[0];
  const num = done.length + 1;
  let caption = '';
  try {
    const d = await gemini({ system: 'You write a short English lesson for Sauti Media, a Kenyan news Page. Clear, friendly, never mocking. Output only JSON.',
      user: `Lesson ${num} of the Sauti Media English Corner. The common error: "${lesson.wrong}". The correct form: "${lesson.right}". The rule: ${lesson.rule} Example: wrong "${lesson.wrongEx}", right "${lesson.rightEx}".
Write the Facebook caption: start with the line "ENGLISH CORNER: ${lesson.wrong.toUpperCase()} OR ${lesson.right.toUpperCase()}?", then a blank line, then 60 to 120 words in two or three short paragraphs that explain the rule in plain words, give one more everyday Kenyan example sentence done right, and end with a one line quick quiz question about the same rule that readers can answer (a question, not an instruction to comment). Use ONLY the rule given; add no other grammar claims. English only. No dashes, no emojis, never "testament" or "whether", never ask readers to comment, like, share or tag.
Return JSON: {"caption":"..."}` });
    caption = String(d.caption || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {}
  if (caption.length < 160 || BANNED.test(caption) || SWAHILI.test(caption) || /comment|share|tag a|drop your/i.test(caption)) caption = `ENGLISH CORNER: ${lesson.wrong.toUpperCase()} OR ${lesson.right.toUpperCase()}?\n\n${lesson.rule}\n\nNot: ${lesson.wrongEx}\nSay: ${lesson.rightEx}\n\nA small correction that makes your English sharper at work, in school and online. Which other English mix up do you hear every day?`;
  const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: page.key, category: 'E', topic: 'english ' + lesson.id, headline: `English Corner: ${lesson.wrong} or ${lesson.right}`, english: Object.assign({ num }, lesson), caption, hashtags: ['EnglishCorner'], scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY' };
  post.image = design(page, post, posts); return post;
}
async function write(page, posts, slotAt, cat) {
  if (cat === 'T') { const tp = await writeThread(page, posts, slotAt).catch(() => null); if (tp) return tp; cat = page.key === 'makasa' ? 'K' : page.key === 'sauti' ? 'D' : 'B'; }
  if (page.key === 'timsauti') { const wp = await writeTimsautiWork(page, posts, slotAt).catch(() => null); if (wp) return wp; }
  if (page.key === 'sauti' && cat === 'E') return writeEnglish(page, posts, slotAt);
  if (page.key === 'sauti') return writeSauti(page, posts, slotAt, cat);
  if (page.key === 'makasa' && cat === 'W') {   // wit card (owner, 12 Nov: "Not invited = Don't go!" style real life wisdom, with his name on it)
    const past = posts.filter((p) => p.wit).slice(-20).map((p) => p.wit.map((l) => l.join(' = ')).join('; '));
    const THEMES = ['social events and invitations', 'money, lending and borrowing', 'WhatsApp groups', 'family and in-laws', 'work and the office', 'friendship', 'relationships and dating', 'church and community', 'neighbours', 'self respect and peace of mind', 'harambees and contributions', 'gossip', 'success and envy', 'parenting'];
    const usedT = posts.filter((p) => p.wit).slice(-8).map((p) => String(p.topic || '').replace(/^wit /, ''));
    const theme = THEMES.find((t) => !usedT.includes(t)) || THEMES[posts.length % THEMES.length];
    const d = await gemini({ system: SYSTEM_M, user: `Write an ORIGINAL witty real life wisdom card for Timothy Makasa's Facebook Page, in the style of a viral handwritten note: three short lines, each "situation = advice!", with the advice circled in red. Three short lines, each a situation and a sharp response, all on this ONE theme from everyday Kenyan life: ${theme}. The lines should make people nod, smile and feel seen. Every line is the same clear shape: a situation the reader has lived through, then short advice to the reader on what to do (an instruction such as "Don't go!", "Say no.", "Keep quiet.", "Move on."). The three lines are parallel and build on each other, the way a good set of proverbs does. The advice is wise and dignified, never petty, bitter or cruel (no blocking, cursing or revenge). Never use well known sayings or lines already circulating online, and never use the words "not invited", "not told" or "late invites"; never mock any group; nothing political or crude.
Each situation at most 4 words, each response at most 3 words, ending with ! or a full stop. Do not repeat these past cards: ${past.join(' | ') || 'none'}.
Also write the caption: 40 to 90 words in his warm, wise voice, expanding gently on the theme with a short real life touch, ending with one natural question to the reader. English only. No dashes, no emojis, never "testament" or "whether". Never ask readers to comment, like, share or tag.
Return JSON: {"theme":"two or three words","lines":[["situation","response"],["situation","response"],["situation","response"]],"caption":"..."}` });
    const lines = (d.lines || []).map((l) => [clean(l[0]).replace(/\s*=\s*$/, ''), clean(l[1]).replace(/^=\s*/, '')]).filter((l) => l[0] && l[1] && l[0].length <= 34 && l[1].length <= 22).slice(0, 3);
    const caption = clean(d.caption || '');
    const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: page.key, category: 'W', topic: 'wit ' + theme, headline: lines.map((l) => l.join(' = ')).join(' / '), wit: lines, caption, hashtags: [], scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY' };
    if (lines.some((l) => /not invited|not told|late invite/i.test(l[0]))) lines.length = 0;   // never the viral original
    if (lines.length < 3 || caption.length < 120 || BANNED.test(caption)) { post.status = 'REJECTED'; post.reasons = ['weak wit card']; return post; }
    post.image = design(page, post, posts); return post;
  }
  const pool = (page.key === 'timsauti' ? TOPICS.timsauti : TOPICS.makasa)[cat];
  const usedTopics = new Set(posts.slice(-60).map((p) => p.topic));
  const topic = pick(pool.filter((t) => !usedTopics.has(t)).concat(pool.length && pool.every((t) => usedTopics.has(t)) ? pool : []));
  const recent = posts.filter((p) => p.category === cat).slice(-6).map((p) => String(p.headline).slice(0, 110));
  const pr = prompt(page, cat, topic, recent);
  pr.user += X.calendarHint(page.key, eatDate(slotAt)) + X.learnedHint(posts, cat);
  const d = await gemini(pr);
  if (page.key === 'makasa' && d.body) {
    const title = clean(d.title || '').toUpperCase().replace(/[.!?]+$/, '');
    const body = String(d.body).trim().replace(/^[A-Z0-9 ,'?!:]{6,}\n+/, (m) => (title && m.trim().toUpperCase().replace(/[.!?]+$/, '') === title ? '' : m)).replace(/^\s*\(?True Story\)?\s*\n+/i, '').replace(/^\s*As written by Timothy Makasa\s*\n+/i, '').trim();
    d.caption = (title ? title + '\nAs written by Timothy Makasa\n\n' : '') + body;
    d.headline = title || d.body.split('\n')[0];
  }
  const caption = clean(d.caption);
  const headline = clean(d.headline || d.card_text || caption.split('\n')[0]).slice(0, 160);
  const min = cat === 'K' ? 500 : page.key === 'makasa' ? 350 : 200;
  const problems = [];
  if (caption.length < min) problems.push('too_short');
  if (BANNED.test(caption) || BANNED.test(headline)) problems.push('banned_word');
  if (SWAHILI.test(caption)) problems.push('kiswahili');
  if (d.risk_level === 'high') problems.push('high_risk');
  if (posts.slice(-80).some((p) => p.headline && p.headline.toLowerCase() === headline.toLowerCase())) problems.push('duplicate');
  if (page.key === 'timsauti' && cat === 'C' && !/0728\s?245\s?824/.test(caption)) problems.push('no_contact');
  const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: page.key, category: cat, topic, headline, cardText: clean(d.card_text || ''), reference: clean(d.reference || ''),
    caption: cat === 'C' && page.key === 'timsauti' && problems.includes('no_contact') ? caption + '\n\nCall or message us on 0733 566 667 or 0728 245 824.' : caption,
    hashtags: (d.hashtags || []).slice(0, 2), scheduledAt: iso(slotAt), createdAt: iso(Date.now()), status: 'READY' };
  if (page.reelSlot && cat !== 'T' && cat !== 'W' && new Date(slotAt + 3 * 3600000).toISOString().slice(11, 16) === page.reelSlot) post.format = 'reel';
  if (d.poster && typeof d.poster === 'object') {
    const P = d.poster; post.poster = { headline: clean(P.headline).replace(/\d/g, '').slice(0, 48), highlight: clean(P.highlight).slice(0, 24), subtitle: clean(P.subtitle).slice(0, 80), points: (P.points || []).map((x) => clean(x).replace(/\d/g, '').slice(0, 34)).filter(Boolean).slice(0, 3) };
    if (!post.poster.headline) delete post.poster;
  }
  const hard = problems.filter((x) => x !== 'no_contact');
  if (hard.length) { post.status = 'REJECTED'; post.reasons = hard; return post; }
  post.image = design(page, post, posts);
  return post;
}

// ---------- publishing ----------
async function publish(page, p, at) {
  const buf = require('./strip').strip(fs.readFileSync(path.join(ROOT, p.image.file)));   // no hidden AI labels reach Facebook
  const fd = new FormData();
  const jpg = /\.jpe?g$/i.test(p.image.file);
  fd.append('source', new Blob([buf], { type: jpg ? 'image/jpeg' : 'image/png' }), p.id + (jpg ? '.jpg' : '.png'));
  fd.append('message', composeMessage(page, p));
  if (at) { fd.append('published', 'false'); fd.append('scheduled_publish_time', String(Math.floor(at / 1000))); } else fd.append('published', 'true');
  const r = await fetch(`https://graph.facebook.com/${GV}/${page.pageId}/photos`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: 'Bearer ' + page.token }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !(j.post_id || j.id)) throw new Error('facebook ' + r.status + ' ' + mask(JSON.stringify(j)).slice(0, 300));
  return { postId: j.post_id || null, photoId: j.id || null };
}

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, o = process.env.TELEGRAM_OWNER_ID; if (!t || !o) return;
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: o, text: String(text).slice(0, 3900) }) }); } catch (e) {}
}

function manualTestSlot(page, due) {
  const day = eatDate(Date.parse(due.scheduledAt)); if (day < '2026-11-02' || day > '2026-11-08') return false;
  const order = slotsFor(page, day).map(([hm]) => hm); const hm = new Date(Date.parse(due.scheduledAt) + 3 * 3600000).toISOString().slice(11, 16);
  const n = Math.round((Date.parse(day) - Date.parse('2026-11-02')) / 86400000);
  return order.indexOf(hm) === n % order.length;
}
// ---------- owner posters sent on Telegram ("Sauti post: ...") ----------
const BEST_HOURS = { sauti: [9, 11, 15, 17, 18], makasa: [7, 12, 19], timsauti: [13, 17] };
function bestTime(page, posts) {
  const taken = posts.filter((p) => ['READY', 'PUBLISHED', 'HELD'].includes(p.status)).map((p) => Date.parse(p.publishedAt || p.scheduledAt)).filter(Boolean);
  for (let d = 0; d < 4; d++) for (const h of BEST_HOURS[page.key] || [9, 13, 18]) {
    const day = eatDate(Date.now() + d * 86400000); const t = Date.parse(day + 'T' + String(h).padStart(2, '0') + ':00:00+03:00');
    if (t < Date.now() + 20 * 60000) continue;
    if (taken.some((x) => Math.abs(x - t) < 45 * 60000)) continue;
    return t;
  }
  return Date.now() + 30 * 60000;
}
// A post prepared for the owner that still needs its photo (11 Nov: never reuse a photo that was on an earlier poster).
// The agent finds a fresh, free photo online for it, designs the poster, and sends it to the owner on Telegram to post or cancel.
async function ownerPhoto(page, posts) {
  for (const p of posts.filter((x) => x.status === 'NEEDS_PHOTO')) {
    p.photoTries = (p.photoTries || 0) + 1; let ph = null;
    for (const q of (p.photoQueries || [])) { try { ph = await SAUTI.commonsPhoto(q, dataDir(page.key), gemini, p.photoStory || p.headline); } catch (e) {} if (ph) break; }
    if (!ph) { if (p.photoTries === 2) { try { await X.tgSend(`No fresh free photo found yet for "${String(p.headline).slice(0, 80)}". Send a photo to this chat and reply here, or the agent keeps looking on each run.`); } catch (e) {} } save(page.key, posts); continue; }
    p.sauti.photo = path.relative(ROOT, ph.file); p.sauti.credit = ph.credit || ''; p.sauti.wide = ph.wide || null;
    p.image = design(page, p, posts); p.status = 'HELD'; p.scheduledAt = iso(Date.now()); save(page.key, posts); audit(page.key, { event: 'owner_post_photo_found', id: p.id, photo: p.sauti.photo });
    try { const id = await X.tgPhoto(path.join(ROOT, p.image.file), `${page.name} post ready, with a new photo: "${String(p.headline).slice(0, 90)}". Tap Post to send it out now, or Cancel.`, [[['Post', 'f|' + page.key + '|' + p.id], ['Cancel', 'b|' + page.key + '|' + p.id]]]); X.remember(STATE, id, page.key, p.id); } catch (e) {}
  }
}
async function ownerPrepare(page, posts) {
  for (const p of posts.filter((x) => x.status === 'OWNER_NEW')) {
    let img = ''; try { img = fs.readFileSync(path.join(ROOT, p.image.file)).toString('base64'); } catch (e) {}
    // 1) what did he send: a finished poster, or a plain photo that still needs the Sauti design?
    let kind = { poster: true, topic: p.rawText || '' };
    try { kind = await gemini({ system: 'You look at images for a Kenyan Facebook Page. Output only JSON.', user: `Owner's note: "${p.rawText || ''}". Is this image a finished, designed poster (headline text and branding already on it) or a plain photo? Also write a short news search query (4 to 8 words, with place names) to research the topic. Return JSON: {"poster":true|false,"query":"..."}`, audio: { mime: 'image/jpeg', data: img } }); } catch (e) {}
    // 2) research the topic in real news reports, so the post carries real, checked details
    let rep = { text: '', links: [] };
    if (page.key === 'sauti' && (kind.query || p.rawText)) {
      try { rep = await SAUTI.research(clean(kind.query || p.rawText).slice(0, 120)); } catch (e) {}
      // and a Google search brief: only facts reported by named, credible Kenyan sources, no guessing
      try {
        const g = await geminiSearch(`Search the web and write a short factual brief, in plain sentences, about: ${clean(kind.query || p.rawText).slice(0, 200)} (Kenya). Owner's note: "${String(p.rawText || '').slice(0, 300)}". Include only facts reported by credible sources (government, county, Kenya Rural Roads Authority or KeNHA, established news outlets): exact location (ward, sub county, county), length, cost, contractor, who launched or funded it, dates, and current status. Write "not found" for anything you cannot find. Never guess.`);
        if (g.text) { rep.text += '\nSEARCH BRIEF (from Google search of ' + g.links.join(', ') + '):\n' + g.text.slice(0, 4000) + '\n'; rep.links = rep.links.concat(g.links); }
      } catch (e) {}
    }
    const facts = `OWNER'S NOTE: ${p.rawText || '(none)'}\n${rep.text}`;
    let d = {};
    try {
      d = await gemini({ system: (page.key === 'sauti' ? SAUTI.SYSTEM_S : page.key === 'makasa' ? SYSTEM_M : SYSTEM_T),
        user: `The Page owner sent this ${kind.poster ? 'poster' : 'photo'} (the image) with a note for a post on ${page.name}. Write the final post.
Use the owner's note and the news reports below (they are about the same topic only if they clearly match it; ignore any that do not). Give readers the full picture: what it is, where exactly (village, ward, sub county, county), who is behind it, when, what it means for ordinary people, and what happens next, as far as the note and the reports say. Never add a fact that is not in the note${kind.poster ? ', on the poster' : ''} or in a matching report, and never guess. Keep his voice and any Kikamba lines exactly. Strong opening line, short paragraphs, end with one natural, specific question. Never ask people to comment, like, share or tag. Plain text, no emojis, no hashtags, no long dashes.
${facts}
Return JSON: {"headline":"short title, max 90 characters","label":"one word for the poster tag, like DEVELOPMENT, NEWS, COMMUNITY, EDUCATION","card":"the poster headline, at most 10 words","sub":"one short line under the headline, at most 12 words, or empty","caption":"the final post, 400 to 1800 characters depending on how many real facts there are","claims":[{"claim":"each fact taken from a news report","quote":"the exact sentence copied from that report"}]}`,
        audio: { mime: 'image/jpeg', data: img } });
    } catch (e) {}
    // facts from reports must be proven by an exact quote; otherwise write from his note alone
    if (rep.text && Array.isArray(d.claims) && d.claims.length && !SAUTI.checked(d, { text: rep.text })) {
      try { d = await gemini({ system: SAUTI.SYSTEM_S, user: `Write the final Sauti Media post using ONLY the owner's note below (no other facts). Strong opening line, short paragraphs, one natural question at the end, never ask people to comment, like, share or tag.\nOWNER'S NOTE: ${p.rawText}\nReturn JSON: {"headline":"...","label":"...","card":"at most 10 words","sub":"","caption":"..."}`, audio: { mime: 'image/jpeg', data: img } }); } catch (e) {}
    }
    // too little to tell the full story (no matching reports and a very short note): ask him for the details instead of posting filler
    if (page.key === 'sauti' && !p.askedInfo && !(rep.text && rep.text.length > 600) && String(p.rawText || '').length < 160) {
      p.status = 'NEED_INFO'; p.askedInfo = true;
      const id = await X.tgSend(`To make this ${page.name} post complete, I need a few facts I could not find in any news report. Please reply to THIS message with what you know, for example:\nWhere exactly is it (ward, sub county, county)?\nWho built or funded it, and when?\nHow long or how big is it, and what did it cost?\nWhat difference does it make for residents?\n\nNote: "${String(p.rawText || '').slice(0, 200)}"`);
      X.remember(STATE, id, page.key, p.id); audit(page.key, { event: 'owner_post_needs_info', id: p.id }); continue;
    }
    p.caption = clean(d.caption || p.rawText || ''); p.headline = clean(d.headline || p.headline); p.research = rep.links;
    if (p.caption.length < 20) { p.status = 'FAILED'; p.error = 'no text'; await X.tgSend('I could not write a post for your photo. Please send it again with a few lines about it.'); continue; }
    // 3) a plain photo on Sauti Media gets the house poster design; a finished poster is used as it is
    if (page.key === 'sauti' && kind.poster === false) {
      { const bk = SAUTI.breaking(clean(d.label || 'NEWS').toUpperCase(), p.caption); p.caption = bk.caption; p.sauti = { label: bk.label, card: clean(d.card || p.headline), sub: clean(d.sub || ''), photo: p.image.file, credit: '' }; }
      try { p.image = design(page, p, posts); } catch (e) {}
    }
    p.scheduledAt = iso(bestTime(page, posts)); p.status = 'READY'; p.previewed = true;
    audit(page.key, { event: 'owner_post_booked', id: p.id, at: p.scheduledAt, designed: kind.poster === false, reports: rep.links.length });
    const when = new Date(Date.parse(p.scheduledAt) + 3 * 3600000); const label = (eatDate(Date.parse(p.scheduledAt)) === eatDate(Date.now()) ? 'today' : 'on ' + when.toISOString().slice(0, 10)) + ' at ' + when.toISOString().slice(11, 16);
    const id = await X.tgPhoto(path.join(ROOT, p.image.file), `${page.name}: booked for ${label}\n\n${p.caption}`.slice(0, 1000), [[['Post now', 'o|' + page.key + '|' + p.id], ['Cancel', 'b|' + page.key + '|' + p.id]]]);
    X.remember(STATE, id, page.key, p.id);
  }
}
const FAST = process.env.FAST === '1';   // quick news check every 15 minutes: Telegram, Sauti news, owner posts and first comments only
async function runPage(page) {
  fs.mkdirSync(dataDir(page.key), { recursive: true });
  let posts = load(page.key);
  const notes = [];
  // 1) post the item whose time has come (one per run), or mark it missed if more than 3 hours late
  // a READY record with no valid time (a hand made one) would stop the whole run: it is set aside instead (14 Nov, no posts for hours)
  for (const p of posts) if (p.status === 'READY' && !(p.scheduledAt && Date.parse(p.scheduledAt))) { if (p.bookAt && Date.parse(p.bookAt)) p.scheduledAt = p.bookAt; else { p.status = 'SET_ASIDE'; audit(page.key, { event: 'set_aside_no_time', id: p.id }); } }
  for (const p of posts) if (p.status === 'READY' && Date.parse(p.scheduledAt) < NOW - 3 * 3600000) { p.status = 'MISSED'; audit(page.key, { event: 'missed', id: p.id }); }
  // a Page on an every second day plan: posts already written for a rest day, or for a dropped time, are withdrawn (the owner's own posts stay)
  if (page.everyDays) for (const p of posts) if (p.status === 'READY' && !p.owner && p.scheduledAt) { const d0 = eatDate(Date.parse(p.scheduledAt)); if (!slotsFor(page, d0).some(([hm]) => slotTime(d0, hm) === Date.parse(p.scheduledAt))) { p.status = 'CANCELLED'; p.reasons = ['one_post_in_two_days']; audit(page.key, { event: 'cancelled_new_plan', id: p.id }); } }
  let postedThisRun = false;
  if (!DRY && page.key === 'sauti') { try { await ownerPhoto(page, posts); } catch (e) { audit(page.key, { event: 'owner_photo_error', error: mask(e.message) }); } }
  if (!DRY) { try { await ownerPrepare(page, posts); save(page.key, posts); } catch (e) { audit(page.key, { event: 'owner_prepare_error', error: mask(e.message).slice(0, 200) }); } }
  const postDue = async () => {
    const due = posts.filter((p) => p.status === 'READY' && Date.parse(p.scheduledAt) <= Date.now()).sort((a, b) => ((b.fromNews ? 1 : 0) - (a.fromNews ? 1 : 0)) || a.scheduledAt.localeCompare(b.scheduledAt))[0];   // news first
    if (!due || PAUSED || fs.existsSync(path.join(dataDir(page.key), 'PAUSE')) || postedThisRun) return;
    if (page.minGapMin) { const last = posts.filter((p) => p.publishedAt).map((p) => Date.parse(p.publishedAt)).sort((a, b) => b - a)[0]; if (last && Date.now() - last < page.minGapMin * 60000) return; }
    const today = eatDate(Date.now());
    if (!due.owner && posts.filter((p) => p.status === 'PUBLISHED' && p.publishedAt && eatDate(Date.parse(p.publishedAt)) === today).length >= (page.dailyMax || slotsFor(page, today).length)) { due.status = 'CANCELLED'; due.reasons = ['daily_limit']; audit(page.key, { event: 'cancelled_daily_limit', id: due.id }); save(page.key, posts); return; }
    postedThisRun = true;
    // Test (2 to 8 Nov, the owner agreed): one Timothy Makasa post a day goes to his Telegram to post by hand, rotating 6am, 12pm, 7pm
    if (page.key === 'makasa' && !DRY && !due.owner && manualTestSlot(page, due)) {
      const tag = composeMessage(page, due);
      const id = await X.tgPhoto(path.join(ROOT, due.image.file), 'TEST POST: please post this on Timothy Makasa yourself now. Save this picture, copy the text below exactly, and post. The agent compares how your hand posted copy does against its own posts.');
      const id2 = await X.tgSend(tag);
      if (id || id2) { due.status = 'MANUAL_SENT'; due.manualSentAt = iso(Date.now()); audit(page.key, { event: 'manual_test_sent', id: due.id }); save(page.key, posts); return; }
    }
    if (!page.token) notes.push('no Facebook token for ' + page.name);
    else if (DRY) { audit(page.key, { event: 'dry_run_would_publish', id: due.id }); notes.push('DRY RUN would publish: ' + due.headline); }
    else {
      let qc = due.ownerForced ? { pass: true } : await finalCheck(page, due);
      // a photo the editor check says does not fit is swapped for another, up to twice, before the post is given up (10 Nov: three daily threads were lost this way)
      for (let k = 0; k < 2 && !qc.pass && !due.owner && page.key === 'sauti' && due.sauti && due.sauti.photo && /photo|picture|image|logo|watermark/i.test((qc.problems || []).join(' ')); k++) {
        audit('sauti', { event: 'photo_changed_by_final_check', id: due.id, problems: qc.problems });
        due.sauti.avoid = (due.sauti.avoid || []).concat(path.basename(due.sauti.photo)); due.sauti.photo = null; due.sauti.credit = ''; due.sauti.wide = null;
        try { due.image = design(page, due, posts); } catch (e) { break; } save(page.key, posts); qc = await finalCheck(page, due);
      }
      if (!qc.pass && due.thread && !due.owner) {   // a thread is never dropped silently: the owner sees why and decides (10 Nov)
        due.status = 'HELD'; due.qc = qc.problems; save(page.key, posts); postedThisRun = false; audit(page.key, { event: 'thread_held_for_owner', id: due.id, problems: qc.problems });
        const id = await X.tgPhoto(path.join(ROOT, due.image.file), `Today's ${page.name} thread is on hold: "${String(due.headline).slice(0, 90)}". The editor check found:\n${(qc.problems || []).join('\n')}\n\nTap Post anyway to send it out with all ${due.thread.lessons.length} points in the comments, or Cancel.`.slice(0, 1000), [[['Post anyway', 'f|' + page.key + '|' + due.id], ['Cancel', 'b|' + page.key + '|' + due.id]]]);
        X.remember(STATE, id, page.key, due.id); return;
      }
      if (!qc.pass && due.owner) {   // the owner's own post is never dropped silently: he sees the reasons and decides
        due.status = 'HELD'; due.qc = qc.problems; save(page.key, posts); postedThisRun = false;
        const id = await X.tgPhoto(path.join(ROOT, due.image.file), `Your ${page.name} post is on hold. The editor check found:\n${(qc.problems || []).join('\n')}\n\nFix it with: edit (reply to this message with edit: new text), or post it as it is.`.slice(0, 1000), [[['Post anyway', 'f|' + page.key + '|' + due.id], ['Cancel', 'b|' + page.key + '|' + due.id]]]);
        X.remember(STATE, id, page.key, due.id); return;
      }
      if (!qc.pass) { due.status = 'REJECTED_QC'; due.qc = qc.problems; audit(page.key, { event: 'rejected_by_final_check', id: due.id, problems: qc.problems }); save(page.key, posts); postedThisRun = false; return; }
      due.status = 'PUBLISHING'; due.publishStartedAt = iso(Date.now()); save(page.key, posts);
      try {
        let r;
        if (due.format === 'reel') {
          try {
            const mp4 = path.join(ROOT, 'data', page.key, 'reel_tmp.mp4');
            X.makeReel(path.join(ROOT, due.image.file), mp4);
            r = await X.publishReel(page, mp4, composeMessage(page, due)); r.kind = 'reel';
            try { fs.unlinkSync(mp4); } catch (e) {}
          } catch (e) { audit(page.key, { event: 'reel_failed_used_photo', id: due.id, error: mask(e.message).slice(0, 300) }); due.reelError = mask(e.message).slice(0, 200); r = null; }
        }
        if (!r) r = await publish(page, due);
        due.status = 'PUBLISHED'; due.publishedAt = iso(Date.now()); due.fb = r; due.permalink = r.permalink || (r.postId ? 'https://www.facebook.com/' + r.postId : null);
        audit(page.key, { event: 'published', id: due.id, fb: r });
        if (page.key !== 'sauti') notes.push('Posted on ' + page.name + ': ' + due.headline + (due.permalink ? '\n' + due.permalink : ''));
      } catch (e) {
        due.status = 'FAILED'; due.error = mask(e.message); audit(page.key, { event: 'publish_failed', id: due.id, error: due.error });
        notes.push('Could not post on ' + page.name + ': ' + due.error);
      }
      save(page.key, posts);
    }
  };
  // Sauti Media: find real local news, write up the owner's tips, send drafts for his Approve tap
  if (page.key === 'sauti' && !DRY && page.token && !fs.existsSync(path.join(dataDir('sauti'), 'PAUSE'))) {
    try {
      await SAUTI.findNews(dataDir('sauti'), STATE, gemini, clean, posts.slice(-25).map((p) => p.headline));
      await SAUTI.draftTips(dataDir('sauti'), gemini, clean);
      try { await SAUTI.draftKamba(dataDir('sauti'), gemini, clean); } catch (e) {}
      try { await SAUTI.kambaNews(dataDir('sauti'), STATE, gemini, clean); } catch (e) { audit('sauti', { event: 'kamba_error', error: mask(e.message).slice(0, 200) }); }
      if (slotsFor(page, eatDate(NOW + 86400000)).some(([, c]) => c === 'W') || slotsFor(page, eatDate(NOW)).some(([, c]) => c === 'W')) await SAUTI.draftProfile(dataDir('sauti'), posts, gemini, clean);
      await SAUTI.sendDrafts(dataDir('sauti'), ROOT, (n) => design(page, { id: 'n_' + n.key, headline: n.card, sauti: { label: n.label, card: n.card, photo: n.photo, credit: n.photoCredit || '' } }, posts));
    } catch (e) { audit('sauti', { event: 'news_error', error: mask(e.message).slice(0, 200) }); }
  }
  if (page.key === 'sauti' && !DRY && page.token && !PAUSED && !fs.existsSync(path.join(dataDir('sauti'), 'PAUSE'))) await sautiNewsNow(page, posts, notes);
  await postDue();
  // 2) write and design upcoming posts: today and tomorrow, up to 3 new ones per run
  let made = 0;
  for (const day of (FAST ? [] : [eatDate(NOW), eatDate(NOW + 86400000)])) {
    for (const [hm, cat] of slotsFor(page, day)) {
      const at = slotTime(day, hm); if ((at < NOW - 30 * 60000 && !(page.key === 'sauti' && cat === 'G' && NOW - at < 4 * 3600000)) || made >= 3) continue;   // a late Sunday morning post can still go out before noon
      if (posts.some((p) => p.scheduledAt === iso(at) && ['READY', 'PUBLISHING', 'PUBLISHED', 'MANUAL_SENT', 'HELD'].includes(p.status))) continue;   // a slot sent for hand posting is taken
      if (posts.filter((p) => p.scheduledAt === iso(at) && p.status === 'REJECTED').length >= 3) continue;
      if (posts.filter((p) => ['READY', 'PUBLISHING', 'PUBLISHED'].includes(p.status) && p.scheduledAt && eatDate(Date.parse(p.scheduledAt)) === day).length >= (page.dailyMax || slotsFor(page, day).length)) continue;   // never more than the daily number
      try { const post = await write(page, posts, at, cat); if (!post) continue; posts.push(post); made++; audit(page.key, { event: post.status === 'READY' ? 'written' : 'rejected', id: post.id, at: post.scheduledAt, cat, reasons: post.reasons }); }
      catch (e) { audit(page.key, { event: 'write_failed', at: iso(at), cat, error: mask(e.message).slice(0, 300) }); notes.push('Writing failed for ' + page.name + ': ' + mask(e.message).slice(0, 160)); break; }
      save(page.key, posts);
    }
  }
  // a post written just now for a slot that has already come is posted in this same run
  await postDue();
  // GitHub's timer is often late: a photo post due in the next 2.5 hours is checked now and booked on Facebook for its exact time
  if (!DRY && page.token && !PAUSED && !fs.existsSync(path.join(dataDir(page.key), 'PAUSE'))) {
    for (const p of posts.filter((x) => x.status === 'READY' && !x.owner && x.format !== 'reel' && x.category !== 'T' && x.image && x.image.file && Date.parse(x.scheduledAt) > Date.now() + 11 * 60000 && Date.parse(x.scheduledAt) < Date.now() + 150 * 60000)) {
      if (page.key === 'makasa' && manualTestSlot(page, p)) continue;   // the hand posting test goes to Telegram at its time
      const today = eatDate(Date.parse(p.scheduledAt));
      if (posts.filter((x) => x.status === 'PUBLISHED' && x.publishedAt && eatDate(Date.parse(x.publishedAt)) === today && !x.fromNews && !x.owner).length >= (page.dailyMax || slotsFor(page, today).length)) continue;
      try {
        const qc = await finalCheck(page, p); if (!qc.pass) continue;   // left as it is: the normal check at its time decides
        const r = await publish(page, p, Date.parse(p.scheduledAt));
        p.status = 'PUBLISHED'; p.publishedAt = p.scheduledAt; p.bookedOnFacebook = true; p.fb = r; p.permalink = r.postId ? 'https://www.facebook.com/' + r.postId : null;
        audit(page.key, { event: 'booked_on_facebook', id: p.id, at: p.scheduledAt, fb: r }); save(page.key, posts);
      } catch (e) { audit(page.key, { event: 'book_ahead_failed', id: p.id, error: mask(e.message).slice(0, 200) }); }
    }
  }
  if (page.key === 'makasa' && !DRY && page.token) { try { await X.matchManual(page, posts); } catch (e) { audit(page.key, { event: 'manual_match_error', error: mask(e.message).slice(0, 200) }); } }
  // results, comments, preview and share pack (each one is safe to fail)
  if (!DRY && page.token) {
    for (const [name, fn] of [['first comment', () => X.firstComments(page, posts, gemini, clean, audit)]].concat(FAST ? [] : [['metrics', () => X.refreshMetrics(page, posts, STATE, notes)], ['comments', () => X.scanComments(page, posts, dataDir(page.key), STATE, gemini, clean)],
      ['stories', () => X.storiesToPosts(page, posts, dataDir(page.key), { gemini, clean, design, SYSTEM_M, ROOT })], ['preview', () => X.eveningPreview(page, posts, ROOT)], ['share', () => X.sharePack(page, posts, STATE, gemini, clean)]])) {
      try { await fn(); } catch (e) { audit(page.key, { event: name + '_error', error: mask(e.message).slice(0, 200) }); }
    }
    save(page.key, posts);
  }
  // keep the project small: remove pictures of posts finished more than 3 days ago
  if (page.key === 'sauti') for (const sub of ['images', 'photos']) { const d = path.join(dataDir('sauti'), sub); try { for (const f of fs.readdirSync(d)) if (/^(n_|c_)/.test(f) && Date.now() - fs.statSync(path.join(d, f)).mtimeMs > 3 * 86400000) fs.unlinkSync(path.join(d, f)); } catch (e) {} }
  for (const p of posts) if (p.image && p.image.file && !['READY', 'PUBLISHING'].includes(p.status) && Date.parse(p.scheduledAt) < NOW - 3 * 86400000) { try { fs.unlinkSync(path.join(ROOT, p.image.file)); } catch (e) {} p.image.removed = true; }
  save(page.key, posts);
  // status file for the owner
  const upcoming = posts.filter((p) => p.status === 'READY').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const today = eatDate(NOW);
  const lines = [page.name.toUpperCase() + ' (updated ' + new Date(NOW + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' Nairobi time)', (PAUSED || fs.existsSync(path.join(dataDir(page.key), 'PAUSE'))) ? 'PUBLISHING PAUSED (remove the PAUSE file to resume)' : 'Publishing: on', '',
    'Posted today: ' + posts.filter((p) => p.status === 'PUBLISHED' && eatDate(Date.parse(p.publishedAt)) === today).length, '', 'Coming up:'];
  for (const p of upcoming) lines.push('  ' + new Date(Date.parse(p.scheduledAt) + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + '  [' + p.category + ']  ' + p.headline + '  (' + p.image.file + ')');
  lines.push('', 'Recently posted:'); for (const p of posts.filter((p) => p.status === 'PUBLISHED').slice(-8)) lines.push('  ' + p.publishedAt.slice(0, 16) + '  ' + p.headline + '  ' + (p.permalink || ''));
  fs.writeFileSync(path.join(dataDir(page.key), 'STATUS.md'), lines.join('\n') + '\n');
  return notes;
}

const STATE = X.loadState(ROOT);
async function pageTokensFromUser() {
  const u = process.env.FB_USER_TOKEN; if (!u) return;
  try {
    const r = await fetch(`https://graph.facebook.com/${GV}/me/accounts?limit=100&fields=id,access_token`, { headers: { Authorization: 'Bearer ' + u }, signal: AbortSignal.timeout(30000) });
    const j = await r.json(); for (const pg of PAGES) { const m = (j.data || []).find((x) => x.id === pg.pageId); if (m && !pg.token) pg.token = m.access_token; }
  } catch (e) { console.log('page keys: ' + mask(e.message)); }
}

// ---------- watchdog: tells the owner on Telegram as soon as something stops working, instead of failing quietly ----------
async function watchdog() {
  const W = STATE.watch = STATE.watch || {}; const alerts = []; const now = Date.now();
  const once = (key, hours, msg) => { if (now - (W[key] || 0) > hours * 3600000) { W[key] = now; alerts.push(msg); } };
  const eh = new Date(now + 3 * 3600000).getUTCHours();
  // 1) GitHub skipped runs (its timer is unreliable)
  if (W.lastRun && now - W.lastRun > 100 * 60000 && eh >= 7 && eh <= 22) once('gap', 3, `GitHub did not start the agent for ${Math.round((now - W.lastRun) / 60000)} minutes. It is running again now.`);
  W.lastRun = now;
  // 2) errors written to the records since the last check
  const since = W.lastAudit || now - 3600000; const found = {};
  for (const page of [...PAGES, { key: 'cornerstone', name: 'Cornerstone' }]) {
    let lines = []; try { lines = fs.readFileSync(path.join(dataDir(page.key), 'audit.jsonl'), 'utf8').trim().split('\n').slice(-300); } catch (e) {}
    for (const l of lines) { let e; try { e = JSON.parse(l); } catch (x) { continue; } if (Date.parse(e.ts) <= since) continue;
      if (/error|failed/.test(e.event) && !/^first_comment$/.test(e.event)) { const k = page.key + ':' + e.event; (found[k] = found[k] || { page: page.name, event: e.event, n: 0, msg: String(e.error || '').slice(0, 160) }).n++; } }
  }
  W.lastAudit = now;
  for (const [k, f] of Object.entries(found)) once('err_' + k, 2, `${f.page}: ${f.event.replace(/_/g, ' ')}${f.n > 1 ? ' (' + f.n + ' times)' : ''}${f.msg ? '\n' + mask(f.msg) : ''}`);
  // 3) the news search itself failing quietly
  const sc = STATE.sautiLastScan || {};
  if (sc.error && Date.parse(sc.at) > now - 3600000) once('scanerr', 2, 'The Sauti news search failed: ' + mask(sc.error).slice(0, 160));
  // 4) Sauti silent for 3 hours in the day
  if (eh >= 10 && eh <= 21) {
    const sp = load('sauti'); const last = sp.filter((p) => p.status === 'PUBLISHED' && p.publishedAt).map((p) => Date.parse(p.publishedAt)).filter((t) => t <= now).sort((a, b) => b - a)[0] || 0;
    if (now - last > 3 * 3600000) once('quiet', 3, `Nothing has gone out on Sauti Media for ${Math.round((now - last) / 3600000)} hours. Last news search: ${sc.fresh || 0} fresh headlines, ${sc.picked || 0} chosen. Stories are skipped when they lack facts or confirmation.`);
  }
  // 5) a planned post that was missed
  for (const page of PAGES) { const ps = load(page.key); let ch = false;
    for (const p of ps) if (p.status === 'MISSED' && !p.missAlerted && Date.parse(p.scheduledAt) > now - 86400000) { p.missAlerted = true; ch = true; alerts.push(`${page.name}: the post "${String(p.headline || '').slice(0, 60)}" missed its time.`); }
    if (ch) save(page.key, ps); }
  if (alerts.length) await telegram('AGENT ALERT\n\n' + alerts.join('\n\n'));
}

if (process.env.SELFTEST === '1') module.exports = { PAGES, slotsFor, eatDate, gemini, write, load, save, design, photoMatch, writeEnglish, finalCheck };   // the self check loads the plan without running anything
else (async () => {
  if (process.env.OWNER_TEST === '1') {   // owner check: prepare one owner photo post, send nothing, publish nothing
    delete process.env.TELEGRAM_BOT_TOKEN;
    const page = PAGES.find((x) => x.key === 'sauti'); const list = load('sauti').filter((x) => x.status !== 'OWNER_NEW');
    const p = { id: 'p_owntest', page: 'sauti', category: 'OWNER', owner: true, headline: 'test', rawText: 'Kwa Siku -Migwani - Mbondoni road\nThis is Kwa Siku -Migwani - Mbondoni road.', caption: '', status: 'OWNER_NEW', createdAt: iso(Date.now()), image: { file: 'data/sauti/images/test_road.jpg' } };
    list.push(p); await ownerPrepare(page, list);
    const qc = await finalCheck(page, p);
    fs.writeFileSync(path.join(ROOT, 'data', 'owner_test.json'), JSON.stringify({ post: p, qc, search: geminiSearch.last || null }, null, 1)); return;
  }
  if (process.env.THREAD_TEST) {   // owner check: write one thread for the given page, publish nothing
    const page = PAGES.find((x) => x.key === process.env.THREAD_TEST); const posts = load(page.key);
    let t = null; try { t = await writeThread(page, posts, Date.now() + 3600000); } catch (e) { writeThread.lastFail = String(e.message).slice(0, 300); }
    fs.writeFileSync(path.join(ROOT, 'data', 'thread_test.json'), JSON.stringify({ post: t, doubt: writeThread.lastDoubt || null, fail: writeThread.lastFail || null }, null, 1)); return;
  }
  if (process.env.TALK_TEST === '1' || process.env.TALK_TEST === 'X') {   // owner check: write one Talk of the Day post with its poster and run the final check, publish nothing
    const page = PAGES.find((x) => x.key === 'sauti'); const posts = load('sauti');
    const post = await writeSauti(page, posts, Date.now() + 10 * 60000, process.env.TALK_TEST === 'X' ? 'X' : 'V');
    const qc = post ? await finalCheck(page, post) : null;
    fs.writeFileSync(path.join(ROOT, 'data', 'talk_test.json'), JSON.stringify({ post: post && { headline: post.headline, caption: post.caption, image: post.image, sauti: post.sauti, status: post.status, reasons: post.reasons }, qc, debug: SAUTI.writeTalk.debug || null }, null, 1)); return;
  }
  if (process.env.QC_TEST) {   // owner check: run the final editor check on chosen posts, publish nothing
    const out = [];
    for (const [pk, id] of process.env.QC_TEST.split(',').map((x) => x.split(':'))) {
      const p = load(pk).find((x) => x.id === id); if (!p) { out.push({ id, error: 'not found' }); continue; }
      const r = await finalCheck(PAGES.find ? PAGES.find((x) => x.key === pk) : PAGES[pk], p); out.push({ id, headline: p.headline, pass: r.pass, problems: r.problems });
    }
    fs.writeFileSync(path.join(ROOT, 'data', 'qc_test.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); return;
  }
  const notes = [];
  await pageTokensFromUser();
  if (!DRY) { try { await X.processTelegram({ pages: PAGES, state: STATE, loadPosts: load, savePosts: save, dataDir, audit, gemini, SAUTI, ROOT }); await X.storyQuestion(STATE); } catch (e) { console.log('telegram: ' + mask(e.message)); } X.saveState(ROOT, STATE); }
  if (!DRY) {   // client Page: Cornerstone (Mon, Wed, Fri drafts for the owner's approval)
    try { let token = ''; const u = process.env.FB_USER_TOKEN; if (u) { const r = await fetch(`https://graph.facebook.com/${GV}/me/accounts?limit=100&fields=id,access_token`, { headers: { Authorization: 'Bearer ' + u }, signal: AbortSignal.timeout(30000) }); const j = await r.json(); const m = (j.data || []).find((x) => x.id === '104576991675007'); if (m) token = m.access_token; }
      await require('./cornerstone').daily({ tg: require('./tg'), gemini, clean, token, mask, GV }); } catch (e) { console.log('cornerstone: ' + mask(e.message)); try { fs.appendFileSync(path.join(ROOT, 'data', 'cornerstone', 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'cornerstone_error', error: mask(String(e.message)).slice(0, 200) }) + '\n'); } catch (x) {} }
  }
  if (!DRY) { try { await require('../oppdesk/engine').tick({ tg: require('./tg') }); } catch (e) { console.log('oppdesk: ' + mask(e.message)); } }   // Opportunity Desk: morning search for training and consultancy work, drafts on request (owner, 12 Nov)
  for (const page of PAGES) { try { notes.push(...await runPage(page)); } catch (e) { notes.push('Agent error on ' + page.name + ': ' + mask(e.message)); try { audit(page.key, { event: 'page_run_error', error: mask(String(e.stack || e.message)).slice(0, 600) }); } catch (x) {} } }
  if (!DRY && !FAST) { try { await X.weeklyReport(PAGES, load, STATE); } catch (e) { console.log('report: ' + mask(e.message)); } }
  if (!DRY && !PAUSED) {   // every run finds a few more free photos online for the topic bank, so posters do not repeat pictures (owner, 10 Nov)
    try { const fp = await require('./freephoto').topUp({ budgetMs: FAST ? 90000 : 150000 }); console.log('photo bank: added ' + fp.added + ' ' + JSON.stringify(fp.got) + (fp.error ? ' ' + fp.error : '')); if (fp.added) audit('sauti', { event: 'photo_bank_grew', added: fp.added, topics: fp.got }); } catch (e) { console.log('photo bank: ' + mask(e.message)); }
  }
  if (!DRY && !PAUSED && !FAST) {   // owner, 12 Nov: many photos of each leader we post about often, so no poster repeats one face close up
    try {
      const LEADERS = ['William Ruto', 'Kalonzo Musyoka', 'Rigathi Gachagua', 'Kithure Kindiki', 'Uhuru Kenyatta', 'Fred Matiang\'i', 'Musalia Mudavadi', 'Johnson Sakaja', 'Wavinya Ndeti', 'Mutula Kilonzo Junior', 'Julius Malombe', 'Alfred Mutua', 'Martha Karua', 'Edwin Sifuna', 'Moses Wetangula', 'Eugene Wamalwa', 'John Mbadi', 'Oburu Oginga', 'Kipchumba Murkomen', 'Aden Duale'];
      const tf = path.join(ROOT, 'data', 'leaders', 'topup.json'); let tr = {}; try { tr = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch (e) {}
      let done = 0;
      for (const n of LEADERS) { if (done >= 2) break; if (tr[n] && Date.now() - Date.parse(tr[n].at) < 5 * 86400000) continue; const got = await SAUTI.leaderBank(n, gemini, 6); tr[n] = { at: new Date().toISOString(), have: got }; done++; console.log('leader photos: ' + n + ' ' + got); }
      fs.mkdirSync(path.dirname(tf), { recursive: true }); fs.writeFileSync(tf, JSON.stringify(tr, null, 1));
    } catch (e) { console.log('leader photos: ' + mask(e.message)); }
  }
  if (!DRY) { try { await watchdog(); } catch (e) { console.log('watchdog: ' + mask(e.message)); } }
  if (!DRY) { try { await X.dailyReport(PAGES, load, STATE, dataDir); } catch (e) { console.log('daily report: ' + mask(e.message)); } }
  if (!DRY && !PAUSED && !FAST) { for (const [n, f] of [['pin', () => X.pinBest(PAGES, load, STATE)]]) { try { await f(); } catch (e) { console.log(n + ': ' + mask(e.message)); } } }
  X.saveState(ROOT, STATE);
  for (const n of notes) console.log(n);
  if (notes.length && !DRY) await telegram(notes.join('\n\n'));
})();
