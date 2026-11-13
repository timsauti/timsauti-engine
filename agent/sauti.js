// Sauti Media: a local news and public affairs Page for Machakos and Ukambani.
// Honesty rule: the agent never invents news. News comes only from real reports in Kenyan news outlets and the county
// (rewritten in Sauti Media's words, every fact checked against the report) or from the owner's tips. Reports from
// trusted outlets that are not sensitive go out straight away; sensitive ones, weaker sources and tips wait for the
// owner's Approve tap on Telegram. Photos: a known leader's licensed photo, else the photo the outlet published with the
// story (shown whole, credited "Photo: <outlet>" on the poster), else a freely licensed picture of the place.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const tg = require('./tg');
const UA = { 'user-agent': 'SautiMediaAgent/1.0 (Facebook Page assistant; contact through the Sauti Media Page)' };

const PLACES = [
  'Machakos School', 'Machakos Girls High School', 'Kangundo High School', 'Kyevaluki Secondary School', 'Vyulya Girls High School', 'Kwanthanze Secondary School',
  'Tala Town', 'Kangundo Town', 'Kakuyuni Market', 'Kyumbi', 'Matuu Town', 'Mwala', 'Masii', 'Kathiani', 'Mitaboni', 'Kalama', 'Mumbuni',
  'Machakos People\'s Park', 'Iveti Hills', 'Ol Donyo Sabuk', 'Fourteen Falls', 'Kilimambogo', 'Koma Rock', 'Lukenya', 'Wamunyu', 'Masinga Dam', 'Yatta',
  'Mua Hills', 'Machakos University', 'Scott Christian University', 'Kithimani', 'Matungulu', 'Kinanie', 'Athi River', 'Mlolongo', 'Syokimau', 'Kangundo Road',
  'Machakos Bus Park', 'Muthetheni', 'Ekalakala', 'Ndithini', 'Mbiuni', 'Kiima Kimwe', 'Katoloni', 'Kimutwa', 'Mutituni'
];
const QUESTIONS = [
  'local food and Kamba dishes', 'growing up in the village', 'school days and teachers', 'market days', 'matatu stories', 'weddings, ruracio and dowry customs',
  'farming and the rains', 'family and parenting', 'money, chamas and saving', 'church and faith in the community', 'young people and jobs', 'sports and local football',
  'traditional sayings and proverbs in Kikamba', 'names and their meanings in Ukambani', 'what has changed in your area in ten years', 'water and boreholes', 'local businesses people love'
];
const SYSTEM_S = `You write Facebook posts for SAUTI MEDIA, a popular Kenyan news and community Page based in Machakos (about 64,000 followers), covering news from across Kenya with a special eye on Machakos and the wider Ukambani region.
Style: local and conversational, the way Kenyan community Pages write. Breaking and hard news is short and punchy. Feature stories, human interest stories, explainers and profiles are full and detailed, so readers can follow the whole story from start to end. English only: never use Kiswahili or Sheng words or greetings. No emojis. No long dashes. Never use the words "testament" or "whether".
Hard rules:
- Never ask readers to comment, like, share, tag, type or vote (no "tell us in the comments", "drop a comment", "share with a friend"): Facebook treats that as engagement bait and cuts reach. End instead with a natural, specific question people will want to answer, such as "Which school are you wishing the best as KCSE kicks off today?"
- Never invent news, events, people, numbers, quotes, dates, deaths, accidents or claims. Use ONLY facts you are given.
- No political campaigning or attacks on any politician or party. Stay neutral and factual.
- No medical, legal or financial advice. No graphic detail.
- Do not mention any news outlet or website. Do not include links or hashtags in the caption.
- Output ONLY one JSON object.`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const eat = (t) => new Date((t || Date.now()) + 3 * 3600000);

// ---------- posts the agent writes alone (safe: they ask, they never state news) ----------
async function writeOwn(cat, posts, gemini, clean, hint) {
  hint = hint || '';
  if (cat === 'G') {   // Sunday morning: church and faith
    const d = await gemini({ system: SYSTEM_S, user: `It is Sunday morning. Write a warm Sunday faith post for the Sauti Media family in Ukambani, where most readers are Christians going to church today. Open with a short blessing for the Sunday, share ONE well known Bible verse (quote it word for word in the King James Version only if you are certain of the wording; otherwise paraphrase it and give the reference), add one or two lines of encouragement, then ask one easy question that invites comments (for example which church they are attending, or a word of encouragement they would share). Respectful, never preachy, never about one denomination. 200 to 450 characters.${hint} Return JSON: {"caption":"the post","card":"a short Sunday blessing line for the poster, at most 10 words","reference":"the verse reference"}` });
    return { topic: 'Sunday faith ' + new Date().toISOString().slice(0, 10), label: 'Sunday', card: clean(d.card || 'Blessed Sunday, Sauti Media family'), sub: clean(d.reference || ''), caption: clean(d.caption) };
  }
  const used = new Set(posts.slice(-80).map((p) => p.topic));
  if (cat === 'P') {
    const place = pick(PLACES.filter((x) => !used.has(x)).concat(PLACES.every((x) => used.has(x)) ? PLACES : []));
    const d = await gemini({ system: SYSTEM_S, user: `Write a short "What do you know about ${place}?" post that draws out memories, stories and what makes the place special. Do NOT state any facts about the place (no history, dates, numbers or claims); end with a natural question about the place. 120 to 300 characters.${hint} Return JSON: {"caption":"the post","card":"WHAT DO YOU KNOW ABOUT ${place.toUpperCase()}?","sub":"one short line inviting memories, max 8 words"}` });
    return { topic: place, label: 'What do you know?', card: clean(d.card || `What do you know about ${place}?`), sub: clean(d.sub || 'Share a memory in the comments'), caption: clean(d.caption) };
  }
  const theme = pick(QUESTIONS.filter((x) => !used.has(x)).concat(QUESTIONS.every((x) => used.has(x)) ? QUESTIONS : []));
  const FORMATS = ['a choose one question with two or three tempting options ("Which would you pick...")', 'a finish this sentence prompt', 'a "name one..." question everyone can answer in a word', 'a nostalgia question about growing up in Ukambani', 'a friendly local pride question ("Which town has the best...")', 'a "what would you do if..." everyday dilemma', 'a rate it from 1 to 10 question', 'a "the first thing that comes to your mind when you hear..." prompt'];
  const kind = cat === 'G' ? 'a warm Sunday greeting to the Sauti Media family followed by ' + pick(FORMATS) + ' about ' + theme
    : cat === 'O' ? 'a friendly talking point (never political, never a religious debate) written as ' + pick(FORMATS) + ', about ' + theme
      : pick(FORMATS) + ' about ' + theme;
  const d = await gemini({ system: SYSTEM_S, user: `Write ${kind}. It must be easy to answer in a few words, so that thousands of people can join in, and it should spark friendly debate. No facts or claims, only the question and one or two lines of warm set up. Never ask for likes, shares or tags. 80 to 260 characters.${hint} Return JSON: {"caption":"the post","card":"the question in at most 12 words, for the poster"}` });
  return { topic: theme, label: cat === 'G' ? 'Sunday' : cat === 'O' ? 'Your view' : 'Tell us', card: clean(d.card || ''), sub: '', caption: clean(d.caption) };
}

// ---------- news: Kenyan news outlets and the county, checked every run; rewritten in Sauti Media's words ----------
const FEEDS = [
  { name: 'Nation', url: 'https://nation.africa/kenya/rss.xml', trust: 2 },
  { name: 'The Standard', url: 'https://www.standardmedia.co.ke/rss/headlines.php', trust: 2 },
  { name: 'KBC', url: 'https://www.kbc.co.ke/feed/', trust: 2 },
  { name: 'Capital FM', url: 'https://www.capitalfm.co.ke/news/feed/', trust: 2 },
  { name: 'Machakos County', url: 'https://www.machakos.go.ke/feed/', trust: 2 },
  { name: 'Kitui County', url: 'https://kitui.go.ke/feed/', trust: 2 },
  { name: 'Makueni County', url: 'https://makueni.go.ke/feed/', trust: 2 },
  { name: 'Kenya News Agency', url: 'https://www.kenyanews.go.ke/feed/', trust: 2 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('site:kenyanews.go.ke (Machakos OR Kitui OR Makueni) when:2d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 2 },
  { name: 'Kenyans.co.ke', url: 'https://www.kenyans.co.ke/feeds/news', trust: 2 },
  { name: 'Tuko', url: 'https://www.tuko.co.ke/rss/all.rss', trust: 2 },
  { name: 'Capital FM Africa', url: 'https://capitalfm.africa/news/feed/', trust: 2 },
  { name: 'People Daily', url: 'https://peopledaily.digital/feed', trust: 2 },
  // owner, 4 Nov: as many news updates as possible, including the DCI's own reports (carried by the outlets within minutes)
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(DCI OR "Directorate of Criminal Investigations" OR detectives) Kenya when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('("National Police Service" OR "Interior Ministry" OR NPS OR EACC OR ODPP) Kenya when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(KNEC OR "Ministry of Health" OR "Kenya Meteorological" OR "Kenya Power" OR NTSA OR KRA OR SHA OR HELB OR TSC) Kenya when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News Kenya', url: 'https://news.google.com/rss?hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('site:go.ke when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },   // government websites of every ministry, agency and county
  // owner, 10 Nov: be on top of the news, with the stories most likely to be shared widely (the Super Metro story of 9 Nov)
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(site:k24.digital OR site:tv47.digital OR site:ntvkenya.co.ke OR site:nairobinews.nation.africa) when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(matatu OR bus OR "Super Metro" OR passengers OR accident OR crash OR fire OR floods OR strike OR protest) Kenya when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(Kenyans OR Nairobi) (stunned OR viral OR trending OR "sparks debate" OR rescued OR dramatic OR heartwarming) when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'The Star', home: 'https://www.the-star.co.ke/', links: /href="((?:https:\/\/www\.the-star\.co\.ke)?\/(?:news|counties)\/[^"#?]+)"/g, trust: 2 },
  { name: 'Citizen Digital', home: 'https://www.citizen.digital/', links: /href="((?:https:\/\/www\.citizen\.digital)?\/news\/[^"#?]+)"/g, trust: 2 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(site:citizen.digital OR site:mpasho.co.ke OR site:the-star.co.ke) when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('(Machakos OR Kangundo OR Tala OR Matungulu OR Mwala OR Masinga OR Yatta OR Kathiani OR Mavoko OR "Athi River" OR Mlolongo OR Kitui OR Mwingi OR Makueni OR Wote OR Ukambani) when:1d') + '&hl=en-KE&gl=KE&ceid=KE:en', trust: 0 }
];
const LOCAL = /machakos|kangundo|tala\b|matungulu|mwala|masinga|yatta|kathiani|mavoko|athi river|mlolongo|syokimau|kitui|mwingi|makueni|wote\b|ukambani|kamba|kyumbi|masii|matuu|kitengela|konza|emali|kibwezi|mtito|sultan hamud|wavinya|mutula|kalonzo/i;
const TRUSTED_BY_NAME = /nation|standard|kbc|capital|citizen|the star|star\b|kenya news agency|people daily|kenyans|tuko|mpasho|ntv|ktn|k24|tv47|radio jambo|nairobi news/i;
// owner, 10 Nov: what an official government platform publishes is official information; it needs no second outlet to confirm it.
// Official means a Kenyan government website (any .go.ke address), a county government, the Kenya News Agency, or a named state body.
const OFFICIAL_NAME = /kenya news agency|\bKNA\b|county government|^(machakos|kitui|makueni) county$|state house|ministry of|state department|national police service|directorate of criminal investigations|\bDCI\b|judiciary|parliament of kenya|national assembly|senate of kenya|\bODPP\b|\bEACC\b|\bIEBC\b|\bKNEC\b|\bNTSA\b|\bKRA\b|kenya revenue authority|\bTSC\b|teachers service commission|\bHELB\b|social health authority|kenya meteorological|kenya power|\bKeNHA\b|\bKURA\b|\bKeRRA\b|central bank of kenya|\bEPRA\b|\bNACADA\b|\bNEMA\b|kenya wildlife service|kenya defence forces|government spokesperson|mygov/i;
const official = (it) => { try { if (/\.go\.ke$/i.test(new URL(String(it.link || '')).hostname)) return true; } catch (e) {} return OFFICIAL_NAME.test(String(it.source || '')) || OFFICIAL_NAME.test(String(it.feed || '')); };
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,application/rss+xml' };
function parseRss(xml) {
  const items = []; const re = /<item[\s>]([\s\S]*?)<\/item>/g; let m;
  const tag = (s, t) => { const x = s.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)<\\/' + t + '>')); return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : ''; };
  while ((m = re.exec(xml))) items.push({ title: tag(m[1], 'title'), link: tag(m[1], 'link'), date: tag(m[1], 'pubDate') || tag(m[1], 'dc:date'), source: tag(m[1], 'source'), desc: tag(m[1], 'description'), body: tag(m[1], 'content:encoded') });
  return items;
}
const paras = (h) => (String(h).match(/<p[\s>][\s\S]*?<\/p>/g) || []).map((p) => p.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&lsquo;|&#8217;|&#8216;/g, "'").replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, ',').replace(/\s+/g, ' ').trim())
  .filter((p) => p.length > 40 && !/cookie|subscribe|newsletter|all rights reserved|sign up|advertis/i.test(p)).join('\n').slice(0, 12000);
async function articleText(link) {
  articleText.last = '';
  let text = '';
  try {   // 1) the page itself
    const r = await fetch(link, { headers: BROWSER, redirect: 'follow', signal: AbortSignal.timeout(25000) }); articleText.last = 'page ' + r.status;
    if (r.ok) text = paras(await r.text());
  } catch (e) { articleText.last = 'page error ' + String(e.cause && e.cause.code || e.name || e.message).slice(0, 40); }
  if (text.length >= 600) return text;
  try {   // 2) WordPress news sites (Kenya News Agency and many county sites) give the story through their public feed
    const u = new URL(link); const slug = u.pathname.split('/').filter(Boolean).pop();
    if (slug) { const r = await fetch(`${u.origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=content`, { headers: BROWSER, signal: AbortSignal.timeout(20000) });
      articleText.last += ', wp ' + r.status;
      if (r.ok) { const j = await r.json().catch(() => []); const t = paras(((j[0] || {}).content || {}).rendered || ''); if (t.length > text.length) text = t; } }
  } catch (e) { articleText.last += ', wp error ' + String(e.cause && e.cause.code || e.name).slice(0, 40); }
  if (text.length >= 600) return text;
  try {   // 3) a public reading service, for sites that block automated visits
    const r = await fetch('https://r.jina.ai/' + link, { headers: { accept: 'text/plain', 'x-return-format': 'text', 'x-timeout': '40' }, signal: AbortSignal.timeout(60000) });
    articleText.last += ', reader ' + r.status;
    if (r.ok) { const t = (await r.text()).split('\n').map((x) => x.trim()).filter((x) => x.length > 60 && !/cookie|subscribe|newsletter|all rights reserved|sign up|advertis|^\[|^!\[|https?:\/\//i.test(x)).join('\n').slice(0, 12000); if (t.length > text.length) text = t; }
  } catch (e) { articleText.last += ', reader error ' + String(e.cause && e.cause.code || e.name).slice(0, 40); }
  return text;
}
// a freely licensed photo of a place or thing (never a person), with its credit
// the photo bank (agent/assets/leaders): a known public figure named in the photo search gets their own licensed photo
// width and height from a JPEG or PNG file header
function imgDims(buf) {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    let i = 2; while (i < buf.length - 9) { if (buf[i] !== 0xFF) { i++; continue; } const m = buf[i + 1]; if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); }
  } catch (e) {}
  return null;
}
const nameWords = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
// Owner rule (12 Nov, the Ruto close up): a leader has MANY photos in the bank and they take turns, the one least recently
// on a poster first. A tight face close up is used only when nothing else exists, and a wide photo is shown whole.
function bankPhoto(query, dir) {
  try {
    const bdir0 = path.join(__dirname, 'assets', 'leaders'), odir = path.join(__dirname, '..', 'data', 'leaders');
    const idx = {}; for (const [d, f] of [[bdir0, 'index.json'], [odir, 'index.json']]) { try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))) if (v.file && !v.skip && fs.existsSync(path.join(d, v.file))) idx[k] = Object.assign({}, v, { dir: d }); } catch (e) {} }
    const q = String(query || '').toLowerCase().normalize('NFD').replace(/[^a-z ]/g, ' ');
    const all = Object.values(idx);
    let pick = all.find((v) => { const n = nameWords(v.name); return n.length > 1 && n.every((w) => q.includes(w)) || (n.length > 1 && q.includes(n[n.length - 1]) && n[n.length - 1].length > 5 && q.includes(n[0])); });
    if (!pick) {   // surname alone (e.g. "Governor Sakaja") when only one person in the bank has it
      const words = new Set(q.split(/\s+/));
      const people = [...new Set(all.map((v) => nameWords(v.name).join(' ')))];
      // the name Kenyans use for them in headlines ("Uhuru", "Rigathi", "Kalonzo") counts as well; with two leaders named, the first one named wins
      const CALL = { uhuru: 'uhuru kenyatta', rigathi: 'rigathi gachagua', kalonzo: 'kalonzo musyoka', wavinya: 'wavinya ndeti', mutula: 'mutula kilonzo junior', sakaja: 'johnson sakaja', matiangi: 'fred matiangi', sifuna: 'edwin sifuna' };
      const toks = q.split(/\s+/);
      const at = (n) => { const sur = n.split(' ').pop(); let i = sur.length >= 4 && people.filter((o) => o.split(' ').pop() === sur).length === 1 ? toks.indexOf(sur) : -1;
        for (const [c, full] of Object.entries(CALL)) if (full === n) { const j = toks.indexOf(c); if (j >= 0 && (i < 0 || j < i)) i = j; } return i; };
      const cands = people.map((n) => [n, at(n)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
      if (cands.length) pick = all.find((v) => nameWords(v.name).join(' ') === cands[0][0]);
    }
    if (!pick) return null;
    const who = nameWords(pick.name).join(' ');
    let mine = all.filter((v) => nameWords(v.name).join(' ') === who);
    if (mine.some((v) => !v.tight)) mine = mine.filter((v) => !v.tight);
    const ago = recentUse(dir); const since = (v) => { const a = ago['c_bank_' + v.file]; return a === undefined ? 1e9 : a; };
    mine.sort((a, b) => since(b) - since(a) || (b.owner ? 1 : 0) - (a.owner ? 1 : 0) || Math.random() - 0.5);
    const hit = mine[0];
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true }); const file = path.join(dir, 'photos', 'c_bank_' + hit.file); fs.copyFileSync(path.join(hit.dir, hit.file), file);
    const dm = hit.w && hit.h ? { w: hit.w, h: hit.h } : imgDims(fs.readFileSync(file));
    // a landscape photo is shown whole above the headline, so no face at its edge is ever cut
    return { file, credit: hit.credit || '', person: hit.name, wide: dm && dm.w / dm.h >= 1.05 ? dm : null, count: mine.length };
  } catch (e) { return null; }
}
// fills the bank with several good photos of one leader: Wikimedia Commons (free licences only) and lead photos of recent news
// reports. Every photo is looked at first: clearly that person, head and shoulders or wider (never a tight face close up),
// dignified, and no other outlet's logo or text on it.
async function leaderBank(name, gemini, want) {
  want = want || 6; name = String(name || '').trim(); const sw = nameWords(name); if (sw.length < 2 || !gemini) return 0;
  const surname = sw[sw.length - 1];
  const dir = path.join(__dirname, '..', 'data', 'leaders'); fs.mkdirSync(dir, { recursive: true });
  const key = sw.join('_'); const idxF = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) {}
  let base = {}; try { base = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'leaders', 'index.json'), 'utf8')); } catch (e) {}
  const have = () => Object.values(idx).concat(Object.values(base)).filter((v) => v.file && !v.tight && !v.skip && nameWords(v.name).join(' ') === sw.join(' ')).length;
  const seen = new Set(Object.values(idx).map((v) => v.source || v.from).filter(Boolean));
  const look = async (buf, context) => {
    try {
      const v = await gemini({ system: 'You check photos for a Kenyan news Page. Output only JSON.', user: `${context} Approve it only if ALL are true: it is a real, sharp, well lit photograph; ${name}, the Kenyan public figure, is clearly visible and is the most prominent person in it (other people around him or her are fine); the framing shows at least head and shoulders with space around the head (NOT a tight face close up filling the frame); he or she looks dignified (eyes open, no embarrassing expression); there is no news outlet logo, watermark, caption bar or large text on it. Return JSON: {"ok":true|false,"why":"if not ok, the main reason in a few words","who":"name of the main person if you recognise them, else unknown","framing":"face_closeup|head_shoulders|half_body|wide"}`, audio: { mime: 'image/jpeg', data: buf.toString('base64') } });
      const w = String((v && v.who) || '').toLowerCase(); leaderBank.last.push((v && v.ok) + ' ' + (v && v.framing) + ' ' + w + ' ' + String((v && v.why) || '') + ' | ' + context.slice(0, 90));
      return !!(v && v.ok === true && ['head_shoulders', 'half_body'].includes(v.framing) && (!w || w === 'unknown' || w.includes(surname)));
    } catch (e) { return false; }
  };
  const keep = (buf, src, credit, tag) => {
    const d = imgDims(buf); if (!d || d.w < 700) return false;
    const k = key + '_' + tag + crypto.createHash('md5').update(src).digest('hex').slice(0, 8);
    fs.writeFileSync(path.join(dir, k + '.jpg'), buf); idx[k] = { name, file: k + '.jpg', credit, source: src, w: d.w, h: d.h, at: new Date().toISOString() };
    fs.writeFileSync(idxF, JSON.stringify(idx, null, 1)); seen.add(src); return true;
  };
  let looked = 0; leaderBank.last = [];
  try {   // 1. Wikimedia Commons: the leader's own category first, then a search
    const pages = [];
    for (const u of ['https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtype=file&gcmlimit=60&gcmtitle=' + encodeURIComponent('Category:' + name) + '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1600',
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1600&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + name)]) {
      try { const j = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).json(); pages.push(...Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => Object.assign(p, { _cat: /categorymembers/.test(u) }))); } catch (e) {}
    }
    // event photos (wider than tall) first: they show the leader at work, never a passport style close up
    pages.sort((a, b) => { const r = (p) => { const i = (p.imageinfo || [])[0]; return i && i.width >= i.height ? 0 : 1; }; return r(a) - r(b); });
    for (const pg of pages) {
      if (have() >= want || looked >= 24) break;
      const ii = (pg.imageinfo || [])[0]; if (!ii || !ii.thumburl || ii.width < 900 || ii.mime !== 'image/jpeg') continue;
      if (seen.has(pg.title) || !(pg._cat || pg.title.toLowerCase().includes(surname)) || /map|logo|flag|poster|screenshot|document|signature|coat of arms/i.test(pg.title)) continue;
      const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '').trim();
      const free = /^(cc0|public domain|pd)/i.test(lic), byOk = /^cc[ -]by(-sa)?( \d|$)/i.test(lic); if (!free && !byOk) continue;
      const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (!free && (!artist || /unknown/i.test(artist))) continue;
      const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA, signal: AbortSignal.timeout(30000) })).arrayBuffer()); looked++;
      if (await look(buf, `This photo on Wikimedia Commons is titled "${pg.title}".`)) keep(buf, pg.title, free ? '' : `${artist}, ${lic}`, 'c');
    }
  } catch (e) {}
  try {   // 2. lead photos of recent news reports about the leader
    if (have() < want) {
      const xml = await (await fetch('https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent('"' + name + '"'), { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
      for (const b of parseRss(xml).filter((b) => b.title.toLowerCase().includes(surname)).slice(0, 10)) {
        if (have() >= want) break;
        let link = b.link; const m = link.match(/[?&]url=([^&]+)/); if (m) link = decodeURIComponent(m[1]); if (seen.has(link)) continue;
        let outlet = b.source || ''; try { outlet = outlet || new URL(link).hostname.replace(/^www\./, ''); } catch (e) {}
        const ph = await articlePhoto(link, outlet, path.join(__dirname, '..', 'data', 'sauti'), gemini, name + ', Kenyan public figure', false); if (!ph) continue;
        const buf = fs.readFileSync(ph.file); try { fs.unlinkSync(ph.file); } catch (e) {}
        if (await look(buf, `This is the lead photo of a news report titled "${b.title}".`)) keep(buf, link, ph.credit, 'n');
      }
    }
  } catch (e) {}
  return have();
}
// a leader missing from the photo bank: take the lead photo of a recent news report about them, check it shows that one person, and keep it in the bank
// owner, 13 Nov ("why not use the Bungoma boy's photo?"): before any stock photo, look for the story's OWN photo in other outlets'
// reports of the same story. Each lead photo is checked to show this story's person or scene, and another outlet's logo is cut away.
async function storyPhotos(title, gemini, dir, avoid, first) {
  if (!title || !gemini) return null; avoid = avoid || []; storyPhotos.last = [];
  try {
    const words = String(title).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 9);
    const xml = await (await fetch('https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent(words.join(' ')), { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
    const key = words.map((w) => w.toLowerCase());
    const items = parseRss(xml).map((b) => ({ b, score: key.filter((w) => b.title.toLowerCase().includes(w)).length })).filter((x) => x.score >= Math.min(3, key.length)).sort((a, b) => b.score - a.score).slice(0, 6);
    if (first) items.unshift({ b: { title, link: first, source: '' } });
    storyPhotos.last.push('reports found: ' + items.length);
    for (const { b } of items) {
      let link = b.link; const m = link.match(/[?&]url=([^&]+)/); if (m) link = decodeURIComponent(m[1]);
      let outlet = b.source || ''; try { outlet = outlet || new URL(link).hostname.replace(/^www\./, ''); } catch (e) {}
      const ph = await articlePhoto(link, outlet, dir, gemini, title, false); if (!ph || avoid.includes(path.basename(ph.file))) { storyPhotos.last.push('no usable lead photo: ' + outlet + ' ' + JSON.stringify(articlePhoto.last || '').slice(0, 160)); continue; }
      const v = await gemini({ system: 'You check photos for a Kenyan news Page. Output only JSON.', user: `Story: "${title}". This is the lead photo of another outlet's report, titled "${b.title}". Approve only if it is a real photograph of THIS story's own person, people or scene (not a stock or unrelated picture), sharp enough for a poster, with no outlet logo, watermark or caption text left on it, and nobody dead or injured shown. Return JSON {"ok":true|false,"why":"few words"}`, audio: { mime: 'image/jpeg', data: fs.readFileSync(ph.file).toString('base64') } }).catch(() => null);
      storyPhotos.last.push(outlet + ': ' + JSON.stringify(v));
      if (v && v.ok === true) return ph;
      try { fs.unlinkSync(ph.file); } catch (e) {}
    }
  } catch (e) {}
  return null;
}
async function leaderFromNews(name, gemini) {
  name = String(name || '').trim(); if (name.split(/\s+/).length < 2 || !gemini) return null;
  const dir = path.join(__dirname, '..', 'data', 'leaders'); fs.mkdirSync(dir, { recursive: true });
  const key = name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '_');
  const idxF = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) {}
  if (idx[key] && idx[key].file && fs.existsSync(path.join(dir, idx[key].file))) return { file: path.join(dir, idx[key].file), credit: idx[key].credit || '' };
  if (idx[key] && idx[key].tried && Date.now() - Date.parse(idx[key].tried) < 3 * 86400000) return null;
  try {
    const xml = await (await fetch('https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent('"' + name + '"'), { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
    const surname = name.split(/\s+/).pop().toLowerCase();
    for (const b of parseRss(xml).filter((b) => b.title.toLowerCase().includes(surname)).slice(0, 6)) {
      let link = b.link; const m = link.match(/[?&]url=([^&]+)/); if (m) link = decodeURIComponent(m[1]);
      let outlet = b.source || ''; try { const h = new URL(link).hostname.replace(/^www\./, ''); outlet = outlet || ({ 'the-star.co.ke': 'The Star', 'standardmedia.co.ke': 'The Standard', 'nation.africa': 'Nation', 'citizen.digital': 'Citizen Digital', 'kenyans.co.ke': 'Kenyans.co.ke', 'tuko.co.ke': 'Tuko', 'capitalfm.co.ke': 'Capital FM', 'kbc.co.ke': 'KBC', 'kenyanews.go.ke': 'KNA', 'peopledaily.digital': 'People Daily' })[h] || h; } catch (e) {}
      const ph = await articlePhoto(link, outlet, path.join(__dirname, '..', 'data', 'sauti'), gemini, name + ', Kenyan public figure', false); if (!ph) continue;   // the photo check also cuts away or rejects another outlet's logo
      const v = await gemini({ system: 'You check photos for a Kenyan news Page. Output only JSON.', user: `This is the lead photo of a news report titled "${b.title}". Is it a clear photograph of ONE main person who is very likely ${name}, the Kenyan public figure the report is about (face clearly visible, not a group where it is unclear who is who, not a logo, graphic, poster with text, or screenshot, and no media house name or watermark such as "The Standard" anywhere on the picture)? If you recognise the person, say who. Return JSON: {"ok":true|false,"who":"name or unknown"}`, audio: { mime: 'image/jpeg', data: fs.readFileSync(ph.file).toString('base64') } }).catch(() => null);
      const who = String((v && v.who) || '').toLowerCase();
      if (!v || v.ok !== true || (who && who !== 'unknown' && !who.includes(surname))) { try { fs.unlinkSync(ph.file); } catch (e) {} continue; }
      fs.renameSync(ph.file, path.join(dir, key + '.jpg'));
      idx[key] = { name, file: key + '.jpg', credit: ph.credit, from: link, at: new Date().toISOString() }; fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
      return { file: path.join(dir, key + '.jpg'), credit: ph.credit };
    }
  } catch (e) {}
  idx[key] = Object.assign(idx[key] || { name }, { tried: new Date().toISOString() }); fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
  return null;
}
// a photo for any story: the topic photo bank (agent/assets/topics), least used photo first, so 9 in 10 posters carry a photo
const TOPIC_RULES = [['court', /\b(court|judge|jailed|sentenc|convict|charged|magistrate|bail|lawsuit|petition)/i], ['police', /\b(police|arrest|suspect|crime|robber|murder|shot|DCI|gang|stolen)/i],
  ['education', /\b(school|student|pupil|KCSE|KJSEA|KPSEA|exam|teacher|TSC|universit|HELB|education|KNEC|learner)/i], ['health', /\b(hospital|health|doctor|nurse|disease|Ebola|cholera|malaria|SHA\b|patient|clinic|medic)/i],
  ['weather', /\b(rain|flood|weather|Met\b|storm|lightning|drought|forecast|landslide)/i], ['farming', /\b(farm|maize|crop|harvest|fertili|seed|livestock|agricultur|coffee|tea\b|miraa)/i],
  ['water', /\b(water|dam\b|dams\b|borehole|irrigation)/i], ['sports', /\b(athlet|marathon|football|Harambee Stars|sport|match|league|Olympic|runner)/i],
  ['technology', /\b(phone|M-Pesa|Safaricom|internet|tech|AI\b|digital|online|app\b|cyber)/i], ['faith', /\b(church|pastor|worship|gospel|bishop|mosque|faith|prayer|priest)/i],
  ['fire', /\b(fires?|blaze|blazes|razed|burnt|inferno|gutted|engulfed|firefighters?)\b/i], ['transport', /\b(road|accident|matatu|traffic|highway|crash|bus\b|transport|NTSA|KeNHA|boda)/i],
  ['economy', /\b(shilling|economy|tax|KRA|budget|price|inflation|bank|loan|debt|Treasury|salar|money|fund|billion|million)/i], ['business', /\b(business|trader|market|shop|jobs|employ|company|investor)/i],
  ['ukambani', /\b(Machakos|Kitui|Makueni|Ukambani|Kangundo|Mwala|Mwingi|Wote|Kathiani|Matungulu|Masinga|Yatta|Mavoko)/i], ['nairobi', /\bNairobi\b/i],
  ['politics', /\b(UDA|ODM|MP\b|MPs|senator|governor|president|election|IEBC|party|politic|parliament|MCA|Wiper|aspirant)/i], ['government', /\b(government|Cabinet|CS\b|PS\b|ministry|State House|civil servant|county)/i]];
// how long ago each photo was last on a poster: file name -> number of posts since (0 = the latest post)
function recentUse(dir, posts) {
  const ago = {};
  try {
    const list = posts || JSON.parse(fs.readFileSync(path.join(dir, 'posts.json'), 'utf8'));
    for (let i = list.length - 1, n = 0; i >= 0 && n < 400; i--, n++) { const f = list[i] && list[i].sauti && list[i].sauti.photo ? path.basename(list[i].sauti.photo) : null; if (f && ago[f] === undefined) ago[f] = n; }
  } catch (e) {}
  return ago;
}
// Owner rule (10 Nov): never keep putting the same photo on poster after poster. A topic photo that was on any of the
// last NO_REPEAT posters is not used again while another fitting one exists; the bank itself grows on every run (freephoto.js).
const NO_REPEAT = 200, MIN_GAP = 40;
function topicPhoto(text, dir, opts) {
  try {
    const idx = require('./freephoto').bank(); const o = opts || {};
    const ago = o.ago || recentUse(dir); const avoid = new Set((o.avoid || []).map((x) => String(x).replace(/^c_topic_/, '')));
    const since = (p) => { const v = ago['c_topic_' + p.file]; return v === undefined ? Infinity : v; };
    const pool = (t) => (idx[t] || []).filter((p) => !avoid.has(p.file));
    // owner, 13 Nov (a pistol arrest went out on a bush fire photo): a gun story is never a fire story ("firearm", "opened fire", "shots fired")
    const gun = /\b(guns?|pistols?|firearms?|rifles?|shot|shooting|opened fire|fired|bullets?|ammunition|gunm[ae]n)\b/i.test(text);
    const matched = TOPIC_RULES.filter(([t, re]) => re.test(text) && !(t === 'fire' && gun)).map(([t]) => t);   // every topic the story touches, the main one first
    const general = ['government', 'nairobi', 'business', 'economy', 'politics'].filter((t) => !matched.includes(t));
    const fresh = (t) => pool(t).filter((p) => since(p) >= NO_REPEAT);
    const oldest = (ts, gap) => ts.flatMap((t) => pool(t).map((p) => [p, t])).filter(([p]) => since(p) >= gap).sort((x, y) => since(y[0]) - since(x[0]))[0];
    let got = null;
    for (const t of matched) { const f = fresh(t); if (f.length) { got = [pick(f), t]; break; } }   // 1) a fitting photo not seen lately
    if (!got) got = oldest(matched, MIN_GAP) || null;                                               // 2) the fitting photo seen longest ago
    // owner, 12 Nov (an armyworm story went out on a Nairobi skyline): a story whose subject we know ALWAYS gets a photo of that subject,
    // even one seen before, never a general city photo. General photos are only for stories with no known subject.
    if (!got) got = oldest(matched, 0) || null;
    if (!got && !matched.length) for (const t of general) { const f = fresh(t); if (f.length) { got = [pick(f), t]; break; } }   // 3) no known subject: a general Kenya photo not seen lately
    if (!got && !matched.length) got = oldest(general, 0) || null;
    if (!got) return null;
    const [p, topic] = got;
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true }); const file = path.join(dir, 'photos', 'c_topic_' + p.file); fs.copyFileSync(path.join(p.dir, p.file), file);
    return { file, credit: p.credit || '', topic, fits: matched.includes(topic) };
  } catch (e) { return null; }
}
async function commonsPhoto(query, dir, gemini, story) {
  const bank = bankPhoto(query, dir) || bankPhoto(story, dir); if (bank) return bank;
  let looked = 0; const recent = recentUse(dir);
  if (!query) return null;
  try {
    const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1280&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + query);
    const j = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).json();
    for (const pg of Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index)) {
      const ii = (pg.imageinfo || [])[0]; if (!ii || ii.width < 800 || !ii.thumburl) continue;
      const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '');
      const free = /^(cc0|public domain|pd)/i.test(lic.trim());
      const byOk = /^cc[ -]by(-sa)?( \d|$)/i.test(lic.trim());   // CC BY and CC BY-SA allowed with a tiny name on the poster; never NC or ND
      if (!free && !byOk) continue;
      if (/selfie|mugshot/i.test(pg.title)) continue;
      // real photographs only: never maps, charts, diagrams, logos, flags or drawings
      if (ii.mime !== 'image/jpeg' || /map|diagram|chart|graph|logo|flag|coat of arms|plan|drawing|illustration|poster|screenshot|scan|document/i.test(pg.title)) continue;
      if (recent['c_' + crypto.createHash('md5').update(pg.title).digest('hex').slice(0, 10) + '.jpg'] < NO_REPEAT) continue;   // already on a recent poster: find another
      const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA, signal: AbortSignal.timeout(30000) })).arrayBuffer());
      fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
      const file = path.join(dir, 'photos', 'c_' + crypto.createHash('md5').update(pg.title).digest('hex').slice(0, 10) + '.jpg'); fs.writeFileSync(file, buf);
      // look at the photo before using it: it must be a clear, real photograph that fits the story
      if (gemini && story) {
        if (++looked > 4) { try { fs.unlinkSync(file); } catch (e) {} break; }
        let ok = false;
        try { const v = await gemini({ system: 'You check photos for a Kenyan news Page. Output only JSON.', user: `Story: "${story}". Is this image a clear, good quality real photograph (not a map, chart, diagram, drawing, document or mostly blank image) that fits this story as a background picture, with no visible faces of private people, no dead or injured people, and no other media house logo? Return JSON: {"ok":true|false}`, audio: { mime: 'image/jpeg', data: buf.toString('base64') } }); ok = v && v.ok === true; } catch (e) { ok = false; }
        if (!ok) { try { fs.unlinkSync(file); } catch (e) {} continue; }
      }
      const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (!free && (!artist || /unknown/i.test(artist))) { try { fs.unlinkSync(file); } catch (e) {} continue; }
      // the credit goes only on the poster itself, very small and faint; never in the post text
      return { file, credit: free ? '' : `${artist}, ${lic.trim()}` };
    }
  } catch (e) {}
  return null;
}
// the story's own lead photo, as the outlet published it, so news shows the real people involved (owner, 2 Nov).
// It is shown whole on the poster (no face is cut) with a small "Photo: <outlet>" credit on the poster itself.
async function articlePhoto(link, outlet, dir, gemini, story, sensitive) {
  if (!link || /news\.google\.|bing\.com/.test(link)) return null;
  try {
    const r = await fetch(link, { headers: BROWSER, redirect: 'follow', signal: AbortSignal.timeout(25000) }); if (!r.ok) return null;
    const h = await r.text();
    const metas = (h.match(/<meta[^>]+>/gi) || []);
    const meta = (re) => { for (const m of metas) if (re.test(m)) { const c = m.match(/content\s*=\s*["']([^"']+)["']/i); if (c) return c[1]; } return ''; };
    let url = meta(/(property|name)\s*=\s*["']og:image(:secure_url|:url)?["']/i) || meta(/(property|name)\s*=\s*["']twitter:image(:src)?["']/i);
    if (!url) return null;
    url = new URL(url.replace(/&amp;/g, '&'), r.url || link).href;
    if (/logo|placeholder|default[-_.]|favicon|\.svg(\?|$)|\.gif(\?|$)/i.test(url)) return null;
    const ir = await fetch(url, { headers: { 'user-agent': BROWSER['user-agent'], accept: 'image/avif,image/webp,image/jpeg,image/png,*/*', referer: link }, signal: AbortSignal.timeout(30000) }); if (!ir.ok) return null;
    const raw = Buffer.from(await ir.arrayBuffer()); if (raw.length < 20000) return null;   // icons and tiny thumbnails
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    const base = path.join(dir, 'photos', 'a_' + crypto.createHash('md5').update(url).digest('hex').slice(0, 10)), file = base + '.jpg';
    fs.writeFileSync(base + '.src', raw);
    // outlets often send WebP: turn it into a JPEG of at most 1280 pixels across, then read its size
    let ff = 'ffmpeg'; try { ff = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
    const cp = require('child_process');
    try { cp.execFileSync(ff, ['-v', 'error', '-y', '-i', base + '.src', '-vf', "scale='min(1280,iw)':-2", '-frames:v', '1', '-q:v', '3', file], { timeout: 30000 }); } finally { try { fs.unlinkSync(base + '.src'); } catch (e) {} }
    const info = String(cp.spawnSync(ff, ['-hide_banner', '-i', file], { timeout: 20000 }).stderr || '');
    const dm = info.match(/,\s*(\d{3,5})x(\d{3,5})/); const w = dm ? +dm[1] : 0, ht = dm ? +dm[2] : 0;
    if (w < 600 || ht < 300) { try { fs.unlinkSync(file); } catch (e) {} return null; }
    if (gemini) {
      let ok = false;
      try { const v = await gemini({ system: 'You check photos for a Kenyan news Page. Output only JSON.', user: `Story: "${story}". This is the lead photo the news outlet published with this story. Approve it only if ALL of these are true: it is a real photograph (not a logo, a graphic made mostly of text, a map, chart, screenshot, or a video frame with a play button); it fits this story; it shows no dead, injured or bleeding people and no child shown in a degrading way (a patient being cared for, or a child in a positive story, is fine)${sensitive ? '; and because this is a crime, court, death or accusation story, it shows only public officials or public figures, police, a court building or a place, never a private suspect, victim or grieving relative' : ''}. Another outlet's logo or watermark must not appear on our poster: say where one sits ("top" for the top band or top corners, "bottom" for the bottom band or bottom corners, "middle" if it is across the centre, "none" if there is none). Return JSON: {"ok":true|false,"logo":"none|top|bottom|middle"}`, audio: { mime: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } }); ok = v && v.ok === true;
        const where = String((v && v.logo) || 'none').toLowerCase();
        if (ok && where === 'middle') ok = false;   // a logo across the centre cannot be cut away
        if (ok && (where === 'top' || where === 'bottom')) {   // cut the band that carries the other outlet's logo
          const cut = Math.round(ht * 0.16), tmp = base + '.cut.jpg';
          cp.execFileSync(ff, ['-v', 'error', '-y', '-i', file, '-vf', `crop=iw:ih-${cut}:0:${where === 'top' ? cut : 0}`, '-q:v', '3', tmp], { timeout: 30000 }); fs.renameSync(tmp, file);
        }
      } catch (e) { ok = false; }
      if (!ok) { try { fs.unlinkSync(file); } catch (e) {} return null; }
    }
    const dm2 = String(cp.spawnSync(ff, ['-hide_banner', '-i', file], { timeout: 20000 }).stderr || '').match(/,\s*(\d{3,5})x(\d{3,5})/);
    return { file, credit: 'Photo: ' + String(outlet || 'news report').replace(/^the /i, 'The ').slice(0, 40), wide: dm2 ? { w: +dm2[1], h: +dm2[2] } : { w, h: ht } };
  } catch (e) { return null; }
}
// the outlet's photo for a story: its own page first, then the same story on other outlets (Google News links cannot be opened)
async function storyPhoto(it, others, dir, gemini, story, sensitive) {
  for (const o of [it].concat(others).slice(0, 4)) {
    const ph = await articlePhoto(o.link, o.source || o.feed, dir, gemini, story, sensitive); if (ph) return ph;
  }
  return null;
}
// owner, 10 Nov: a breaking story says so at the very start of its caption, and on the poster
const breaking = (label, caption) => /^BREAKING/i.test(String(label || '')) ? { label: 'BREAKING NEWS', caption: /^BREAKING NEWS/i.test(String(caption || '')) ? caption : 'BREAKING NEWS: ' + String(caption || '') } : { label, caption };
// the same story in other outlets: first among this run's readable items, then Bing News (which links straight to publishers)
const words = (t) => new Set(String(t).toLowerCase().replace(/ - [^-]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
const freshEnough = (d) => !d || isNaN(Date.parse(d)) ? false : Date.now() - Date.parse(d) < 48 * 3600000;   // other outlets' reports must be from the last two days
// ---------- same story checks (kept at the top level so the self check can test them) ----------
const CW = (t) => new Set((String(t).replace(/ - [^-]+$/, '').match(/\b[A-Z][a-z]{3,}\b/g) || []).filter((w) => !/^(The|Kenya|Kenyan|Kenyans|Nairobi|County|Court|Government|Former|After|Over|President|National)$/.test(w)));
// distinctive words, any case (NACADA and Nacada are the same): two shared, or one shared with some overlap, means the same story
const DW = (t) => new Set((String(t).replace(/ - [^-]+$/, '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !/^(with|from|that|this|have|after|over|into|says|said|kenya|kenyan|kenyans|county|government|nairobi|court|police|former|their|amid|will|more|than|news|year|years|today|tuesday|monday|wednesday|thursday|friday|saturday|sunday|arrested|arrests|seize|seizes|seized|raid|drug|drugs)$/.test(w)));
const sameDW = (a, b) => { const A = DW(a), B = DW(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n >= 3 || (n >= 2 && overlap(a, b) >= 0.2); };
const sameStoryText = (t, posted) => { const A = DW(t), B = DW(posted); let n = 0; for (const w of A) if (B.has(w)) n++; return n >= 3; };

// Google News hides the real article behind its own link; this asks Google for the real address so the agent can read the full story
async function gnResolve(link) {
  try {
    const id = (String(link || '').match(/news\.google\.[^/]+\/(?:rss\/)?articles\/([^?/#]+)/) || [])[1]; if (!id) return null;
    const h = await (await fetch('https://news.google.com/articles/' + id + '?hl=en-KE&gl=KE&ceid=KE:en', { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
    const sg = (h.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (h.match(/data-n-a-ts="([^"]+)"/) || [])[1]; if (!sg || !ts) return null;
    const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
    const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', { method: 'POST', headers: Object.assign({}, BROWSER, { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }), body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])), signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    try { const arr = JSON.parse(t.split('\n\n')[1]); const u = JSON.parse(arr[0][2])[1]; if (/^https?:\/\//.test(u)) return u; } catch (e) {}
    const m = t.match(/garturlres\\+",\\+"(https?:[^"\\]+)/); return m ? m[1] : null;
  } catch (e) { return null; }
}
async function otherSources(it, all) {
  let got = '';
  for (const o of all.filter((x) => x !== it && overlap(x.title, it.title) >= 0.5 && freshEnough(x.date)).slice(0, 3)) {
    if (/news\.google\./.test(o.link)) { const real = await gnResolve(o.link); if (real) o.link = real; }
    const t = o.body && o.body.length > 300 ? o.body : (/news\.google\./.test(o.link) ? '' : await articleText(o.link));
    if (t.length > 300) { got += '\n' + t; if (got.length > 1500) return got; }
  }
  try {
    const xml = await (await fetch('https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent(it.title.replace(/ - [^-]+$/, '')), { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
    for (const b of parseRss(xml).filter((b) => overlap(b.title, it.title) >= 0.5 && freshEnough(b.date)).slice(0, 3)) {
      let link = b.link; const m = link.match(/[?&]url=([^&]+)/); if (m) link = decodeURIComponent(m[1]);
      const t = await articleText(link); if (t.length > 300) { got += '\n' + t; if (got.length > 1500) break; }
    }
  } catch (e) {}
  return got;
}
// research a topic the owner sent: read up to three news reports about it (Bing News links straight to publishers)
async function research(query) {
  let got = ''; const used = [];
  try {
    const xml = await (await fetch('https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent(query), { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
    for (const b of parseRss(xml).slice(0, 6)) {
      let link = b.link; const m = link.match(/[?&]url=([^&]+)/); if (m) link = decodeURIComponent(m[1]);
      const t = await articleText(link); if (t.length > 400) { got += `\nREPORT (${b.source || 'news'}): ${b.title}\n${t.slice(0, 5000)}\n`; used.push(link); }
      if (used.length >= 3) break;
    }
  } catch (e) {}
  return { text: got, links: used };
}
async function findNews(dir, state, gemini, clean, recentHeads) {
  state.sautiNewsAt = state.sautiNewsAt || 0;
  if (Date.now() - state.sautiNewsAt < 12 * 60000) return 0;   // every run (a quick news check runs every 15 minutes)
  state.sautiNewsAt = Date.now();
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  // a story skipped for thin facts gets one more try (the agent now reads more sites), then stays skipped
  const thinBefore = new Set(news.filter((n) => /^(SKIPPED_THIN|FAILED_CHECK)$/.test(n.status)).map((n) => n.key)); const triedTwice = new Set(news.filter((n) => n.again).map((n) => n.key));
  const retry = (st) => /^(SKIPPED_THIN|FAILED_CHECK)$/.test(st);   // thin or failed the quote check: one more try (the check is fairer since 4 Nov)
  const seen = new Set(news.filter((n) => !(retry(n.status) && !triedTwice.has(n.key) && Date.now() - Date.parse(n.at) < 10 * 3600000) || news.some((m) => m.key === n.key && !retry(m.status))).map((n) => n.key));
  let all = [];
  // all feeds are read at the same time (saves GitHub minutes); results keep the feed order
  const parts = await Promise.all(FEEDS.map(async (f) => { let all = [];
    try {
      if (f.home) {   // sites with no news feed: read the front page links; the story itself is read only if picked
        const h = await (await fetch(f.home, { headers: BROWSER, signal: AbortSignal.timeout(25000) })).text();
        const links = [...new Set([...h.matchAll(f.links)].map((m) => new URL(m[1], f.home).href))].slice(0, 40);
        all = all.concat(links.map((l) => { const slug = l.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/[-_]+/g, ' ').replace(/\b\d+$/, '').trim(); const dm = l.match(/(\d{4}-\d{2}-\d{2})/); return { title: slug.charAt(0).toUpperCase() + slug.slice(1), link: l, date: dm ? dm[1] + 'T12:00:00+03:00' : '', source: f.name, desc: '', body: '', feed: f.name, trust: f.trust }; }));
      } else {
        const xml = await (await fetch(f.url, { headers: BROWSER, signal: AbortSignal.timeout(25000) })).text();
        all = all.concat(parseRss(xml).map((i) => Object.assign(i, { feed: f.name, trust: f.trust === 0 ? (TRUSTED_BY_NAME.test(i.source) || official(i) ? 2 : 1) : f.trust })));
      }
    } catch (e) {}
    return all; }));
  for (const p of parts) all = all.concat(p);
  const keyOf = (t) => crypto.createHash('md5').update(String(t).toLowerCase().replace(/ - [^-]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 12);
  // undated front page links are judged by the stale check when written
  const fresh = all.filter((i) => i.title && (!i.date || Date.now() - Date.parse(i.date) < 16 * 3600000)).map((i) => Object.assign(i, { key: keyOf(i.title), local: LOCAL.test(i.title + ' ' + i.desc) }))
    .filter((i) => !seen.has(i.key));
  // weekly review 9 Nov: national stories from KBC drew the fewest views of any outlet (median 405 against about 800), so they go to the
  // back of the list (the same story from another outlet is used instead); KBC stories about Ukambani keep their place
  const weak = (i) => !i.local && /^KBC$/i.test(i.feed || '') ? 1 : 0;
  // owner, 10 Nov: be on top of the news. A story several outlets are carrying at the same moment is the one people are talking about:
  // it is counted (heat), marked TRENDING for the editor, and written first
  const outlet = (i) => String(i.source || i.feed || '').toLowerCase().replace(/^the /, '').trim();
  for (const i of fresh) i.ws = words(i.title);
  const near = (a, b) => { let n = 0; for (const w of a.ws) if (b.ws.has(w)) n++; return n / Math.max(1, Math.min(a.ws.size, b.ws.size)) >= 0.5 && n >= 2; };
  for (const i of fresh) { const o = new Set([outlet(i)]); for (const j of fresh) if (j !== i && (j.key === i.key || near(i, j))) o.add(outlet(j)); i.heat = o.size; }
  const hot = (i) => i.heat >= 3 ? 1 : 0;
  const uniq = []; const k2 = new Set(); for (const i of fresh.sort((a, b) => (hot(b) - hot(a)) || (b.local - a.local) || (b.heat - a.heat) || (weak(a) - weak(b)) || (b.trust - a.trust))) if (!k2.has(i.key)) { k2.add(i.key); uniq.push(i); }
  const pool = uniq.slice(0, 90); state.sautiLastScan = { at: new Date().toISOString(), fetched: all.length, fresh: fresh.length, pool: pool.length }; if (!pool.length) return 0;
  let picks = [];
  try {
    const ask = () => gemini({ system: SYSTEM_S, user: `You are the news editor of Sauti Media, a Kenyan news Page based in Machakos. From these fresh headlines choose up to 10 to publish now (more is better when there is real news; the owner wants as many real news updates as possible, and wants Sauti Media to be on top of the news):
- First, every story marked TRENDING: several outlets are carrying it right now, so it is what Kenyans are talking about. Pick it unless a rule below forbids it.
- Then the stories most likely to be shared widely: surprising, dramatic or heartwarming things that happened to ordinary Kenyans (for example a baby born on a commuter bus), anything touching daily life for millions (fares, fuel, food prices, power, water, exams, jobs, new rules and deadlines), rescues, records and firsts.
- Important news from anywhere in Kenya that ordinary Kenyans want to know: national decisions, prices, exams, health services, security, weather, disasters, courts, sports, jobs and opportunities, big politics news, county news.
- Pick every [UKAMBANI] story that is real news: stories from Machakos, Kitui and Makueni drew about three times the views of other stories last week.
- Skip celebrity gossip, opinion columns, sponsored content, minor foreign news, and political insults or quarrels.
- Skip any story that rests on unconfirmed accusations against a named person, business or institution (for example claims that a named hospital or company did wrong) unless an official body such as police, a court, a regulator or the government has confirmed or acted on it.
- Skip anything that repeats these recent Sauti Media posts: ${recentHeads.slice(0, 15).join(' | ')}
${pool.map((f, i) => `${i}. [${f.local ? 'UKAMBANI' : 'KENYA'}]${f.heat >= 3 ? ' [TRENDING: ' + f.heat + ' outlets]' : ''} ${f.title}`).join('\n')}
Mark "sensitive" true for deaths, crime, accusations against a named person, court cases, health scares or anything that could harm someone's name.
Mark "feature" true for human interest stories, success stories, profiles of people, explainers (how something works, what a new rule means for ordinary people) and in depth stories; false for breaking and hard news.
Return JSON: {"pick":[{"i":number,"sensitive":true|false,"feature":true|false}]}` });
    const norm = (x) => { if (Array.isArray(x)) x = { pick: x }; const arr = (x && (x.pick || x.picks || x.stories || x.selected)) || []; return { pick: arr.map((p) => typeof p === 'number' || typeof p === 'string' ? { i: Number(p) } : Object.assign({}, p, { i: Number(p.i != null ? p.i : p.index) })).filter((p) => Number.isInteger(p.i)) }; };
    let d0 = await ask(); let d = norm(d0); if (!d.pick.length && pool.length >= 15) { state.sautiLastScan.retried = true; state.sautiLastScan.firstAnswer = JSON.stringify(d0).slice(0, 200); d0 = await ask(); d = norm(d0); }
    if (!d.pick.length) state.sautiLastScan.answer = JSON.stringify(d0).slice(0, 200);   // an empty answer from a full list is usually a model hiccup
    // never the same story twice: skip a pick that names the same person as a story from the last 36 hours and shares its key words
    const names = (t) => new Set((String(t).match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []).map((x) => x.toLowerCase()));
    const recent = news.filter((x) => x.kind === 'news' && x.title && !/^(SKIPPED_(THIN|UNCONFIRMED|INCOMPLETE)|FAILED_CHECK)$/.test(x.status) && Date.now() - Date.parse(x.at) < 36 * 3600000).map((x) => x.title).concat(recentHeads || []);
    // stories already posted, with the first lines of their text, for the same-event check
    const postedText = news.filter((x) => x.status === 'USED' && Date.now() - Date.parse(x.at) < 36 * 3600000).map((x) => x.title + ' ' + String(x.caption || '').slice(0, 400));
    const repeat = (t) => postedText.some((r) => sameStoryText(t, r)) || recent.some((r) => { if (sameDW(t, r)) return true; const A = names(t), B = names(r); if ([...A].some((n) => B.has(n)) && overlap(t, r) >= 0.3) return true; const a = CW(t), b = CW(r); return overlap(t, r) >= 0.5 || ([...a].some((w) => b.has(w)) && overlap(t, r) >= 0.3); });
    // topics the owner has said to stop covering (data/sauti/skip_topics.json: [{"word","until"}])
    let skip = []; try { skip = JSON.parse(fs.readFileSync(path.join(dir, 'skip_topics.json'), 'utf8')).filter((x) => !x.until || Date.parse(x.until) > Date.now()); } catch (e) {}
    const banned = (t) => skip.some((x) => new RegExp('\\b' + x.word + '\\b', 'i').test(t));
    state.sautiLastScan.modelPicked = (d.pick || []).length; state.sautiLastScan.repeats = (d.pick || []).filter((p) => pool[p.i] && repeat(pool[p.i].title)).map((p) => pool[p.i].title.slice(0, 70)).slice(0, 5);
    picks = (d.pick || []).filter((p) => pool[p.i] && !repeat(pool[p.i].title) && !banned(pool[p.i].title + ' ' + (pool[p.i].desc || '')));
    // a trending story the editor passed over is still taken, as a sensitive one, so it is confirmed in a second outlet before it goes out
    for (let i = 0; i < pool.length && i < 20; i++) if (pool[i].heat >= 4 && !picks.some((p) => p.i === i) && !repeat(pool[i].title) && !banned(pool[i].title + ' ' + (pool[i].desc || ''))) picks.push({ i, sensitive: true, feature: false, trending: true });
    picks = picks.sort((a, b) => (pool[b.i].heat || 0) - (pool[a.i].heat || 0));   // what the country is talking about goes out first
    picks = picks.filter((p, k) => !picks.slice(0, k).some((q) => sameDW(pool[q.i].title, pool[p.i].title) || overlap(pool[q.i].title, pool[p.i].title) >= 0.5)).slice(0, 10);   // one outlet's version of each story
    state.sautiLastScan.trending = pool.filter((f) => f.heat >= 3).slice(0, 6).map((f) => f.heat + ' ' + f.title.slice(0, 60));
  } catch (e) { state.sautiLastScan.error = String(e.message).slice(0, 200); return 0; }
  state.sautiLastScan.picked = picks.length;
  let n = 0;
  for (const p of picks) {
    const it = pool[p.i]; seen.add(it.key);
    let text = it.body && it.body.length > 400 ? it.body : '';
    if (/news\.google\./.test(it.link)) { const real = await gnResolve(it.link); if (real) { it.gnLink = it.link; it.link = real; } }   // read the real article, not Google's wrapper
    if (!text && !/news\.google\.|\/videos?\//.test(it.link)) text = await articleText(it.link);   // video pages carry no story text
    const ownText = text;
    if (text.length < 300 || (p.feature && text.length < 2500)) text = (text + '\n' + await otherSources(it, all)).trim();
    const borrowed = text.length > ownText.length + 100;   // details came from other outlets, not the story's own page
    // counter check: other outlets (from the last 16 hours) carrying the same headline
    // same story = clearly similar headline, or the same distinctive name (e.g. Waititu) with some shared words
    const COMMON = /^(The|A|An|In|On|Of|For|To|And|Kenya|Kenyan|Kenyans|Nairobi|Govt|Government|County|President|Court|MP|MPs|Senate|New|How|Why|What|After|Over|As|Ex|Former)$/;
    const caps = (t) => new Set((String(t).replace(/ - [^-]+$/, '').match(/\b[A-Z][a-z]{3,}\b/g) || []).filter((w) => !COMMON.test(w)));
    const sameStory = (a, b) => overlap(a, b) >= 0.5 || ([...caps(a)].some((w) => caps(b).has(w)) && overlap(a, b) >= 0.25);
    const confirmedBy = [...new Set(all.filter((x) => x !== it && sameStory(x.title, it.title) && (x.source || x.feed) !== (it.source || it.feed)).map((x) => x.source || x.feed))];
    if ((borrowed || p.sensitive) && !confirmedBy.length && !official(it)) { news.push({ key: it.key, kind: 'news', status: 'SKIPPED_UNCONFIRMED', at: new Date().toISOString(), title: it.title, sourceLink: it.link }); continue; }   // headline only, or a feature that needs more detail: read the same story elsewhere
    const feature = !!p.feature && text.length > 800;
    // never post a story we cannot tell properly: a headline with no report behind it is skipped, not guessed at
    if (text.length < 600) { news.push({ key: it.key, kind: 'news', status: 'SKIPPED_THIN', at: new Date().toISOString(), title: it.title, sourceLink: it.link, again: thinBefore.has(it.key) || undefined, read: articleText.last || undefined }); continue; }
    const factsText = text;
    try {
      const d = await gemini({ system: SYSTEM_S, user: `TODAY IS ${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} (Nairobi). Rewrite this real news report as a Sauti Media post, in fresh words and Sauti Media's style. If the report is about a forecast, event, deadline or period that has already ended before today, or the report is clearly older than two days, set "stale" to true. Use ONLY facts in the report; never add names, numbers, causes or details it does not give. Put the most important fact first. The post must be complete: readers must learn WHO (full names and roles), WHAT happened, WHERE (the exact place, town and county), WHEN, and HOW or WHY, as far as the report gives them. Never write vague filler such as "found unique ways" or "has been doing great things": every sentence must carry a specific fact from the report. For each fact you use, quote the exact sentence from the report that supports it.
REPORT (${it.feed}${it.source ? ', ' + it.source : ''}):
TITLE: ${it.title}
${factsText}
Return JSON: {"label":"${feature ? 'FEATURE' : 'BREAKING or NEWS or UPDATE or DEVELOPMENT or ALERT'}","card":"the news in at most 12 words for the poster","caption":"${feature ? 'a full feature story of 600 to 1000 characters in short paragraphs that readers can follow from start to end: open with a strong scene or moment from the story; then who the person or subject is and where they come from; the challenges or background; how things happened step by step; where things stand now with the numbers and details the report gives; what it means for ordinary Kenyans or the lesson in it; end with a question that readers will want to answer from their own view or experience. Use every useful detail the report gives, but never pad or repeat yourself, and never add anything the report does not say' : 'short and complete: 350 to 500 characters in short paragraphs; the key fact first, then every important detail the report gives (who, what, where, when, and what happens next); end with a simple question to readers only when it fits: it must ask for their view or experience, never quiz them on a fact the post already gives, and never follow a death, tragedy, crime or court case'}","image_query":"2 to 5 words for the photo: for a politics or government story, or the death or achievement of a public figure, the full name of that public figure; for anything else a PLACE or THING (a town, road, hospital building, school, river, crop). Never a private person, and never a private person in a crime, accident or death story","stale":true|false,"who":"the full name and role of the main person or body, copied from the report, or empty if the report does not say","where":"the exact place named in the report, or empty if it does not say","claims":[{"claim":"...","quote":"the exact sentence copied from the report"}]}` });
      const src = { text: factsText };
      if (borrowed) {   // the borrowed report must be about the very same event as the headline: same dates, places and numbers
        let same = { same: false };
        try { same = await gemini({ system: 'You are a strict news desk checker. Output only JSON.', user: `TODAY IS ${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}.\nHEADLINE: ${it.title}\nREPORT TEXT:\n${factsText.slice(0, 6000)}\nDoes this report describe the very same event as the headline, with no conflict in dates, places, names or numbers (for example the headline says 30 counties and the report says 46)? Return JSON: {"same":true|false,"conflicts":["..."]}` }); } catch (e) {}
        if (!same || same.same !== true) { news.push({ key: it.key, kind: 'news', status: 'SKIPPED_MISMATCH', at: new Date().toISOString(), title: it.title, conflicts: (same && same.conflicts) || [] }); continue; }
      }
      if (d.stale === true) { news.push({ key: it.key, kind: 'news', status: 'SKIPPED_STALE', at: new Date().toISOString(), title: it.title }); continue; }
      if (!String(d.who || '').trim() || (!String(d.where || '').trim() && (p.sensitive || it.local))) /* 10 Nov: a national announcement with no single place is still complete; incidents and local stories must say where */ { news.push({ key: it.key, kind: 'news', status: 'SKIPPED_INCOMPLETE', at: new Date().toISOString(), title: it.title }); continue; }
      if (!checked(d, src)) { news.push({ key: it.key, kind: 'news', status: 'FAILED_CHECK', at: new Date().toISOString(), title: it.title, check: checked.last, again: thinBefore.has(it.key) || undefined }); continue; }
      const auto = it.trust >= 2;   // the owner asked for direct posting from these outlets; the fact check above still applies
      // photo: a known leader's licensed photo first; then the photo the outlet published with the story (credited on the poster);
      // then a licensed photo of the place; with none of these the clean text poster is used
      const story = clean(d.card || it.title);
      const others = all.filter((x) => x !== it && sameStory(x.title, it.title) && !/news\.google\./.test(x.link) && (x.source || x.feed) !== (it.source || it.feed));
      // a leader has one bank photo: when it was on a recent poster, the photo the outlet published with this story goes first (owner, 10 Nov: no photo over and over)
      const lead = bankPhoto(clean(d.image_query || ''), dir) || bankPhoto(story, dir);
      const leadSeen = lead ? recentUse(dir)[path.basename(lead.file)] : undefined;
      const photo = (lead && !(leadSeen < MIN_GAP) ? lead : null)
        || await storyPhoto(it, others, dir, gemini, story, !!p.sensitive) || lead
        || await commonsPhoto(clean(d.image_query || ''), dir, gemini, story);
      news.push({ key: it.key, kind: 'news', status: auto ? 'APPROVED' : 'SKIPPED_UNTRUSTED', auto, sensitive: !!p.sensitive, local: it.local, at: new Date().toISOString(), title: it.title, sourceName: it.source || it.feed, sourceLink: it.link,
        label: breaking(clean(d.label || 'NEWS')).label, card: story, caption: breaking(clean(d.label || 'NEWS'), clean(d.caption || '')).caption, heat: it.heat || undefined, photo: photo ? path.relative(path.join(dir, '..', '..'), photo.file) : null, photoCredit: photo ? photo.credit : '', photoWide: photo && photo.wide ? photo.wide : null });
      n++;
    } catch (e) {}
  }
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
  return n;
}

// ---------- owner tips sent on Telegram ("Sauti: ..." text, or a photo with a caption starting "Sauti") ----------
const isSautiTip = (m) => { const t = String(m.text || m.caption || '').trim(); return /^sauti\b[:,\s-]*/i.test(t) && t.length > 12; };
async function saveTip(m, ctx) {
  const dir = ctx.dataDir('sauti'); fs.mkdirSync(path.join(dir, 'tips'), { recursive: true });
  const text = String(m.text || m.caption || '').replace(/^sauti\b[:,\s-]*/i, '').trim();
  let photo = null;
  if (m.photo && m.photo.length) {
    const best = m.photo[m.photo.length - 1]; const buf = await tg.fileBuffer(best.file_id);
    if (buf) { photo = path.join(dir, 'tips', 't_' + Date.now().toString(36) + '.jpg'); fs.writeFileSync(photo, buf); }
  }
  if (/^logo$/i.test(text) && photo) { fs.copyFileSync(photo, path.join(dir, 'logo.jpg')); await tg.send('Thank you. That is now the Sauti Media logo on every poster.'); return; }
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  news.push({ key: 'tip_' + Date.now().toString(36), kind: 'tip', status: 'NEW_TIP', at: new Date().toISOString(), text: text.slice(0, 3000), photo: photo ? path.relative(ctx.ROOT, photo) : null });
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
  await tg.send('Got your Sauti Media tip. It will be written up and posted on Sauti Media within the hour.');
}
// Kamba posts the owner copied from Facebook (text and/or a screenshot), translated and written up as a DRAFT for his Approve
async function draftKamba(dir, gemini, clean) {
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  for (const t of news.filter((x) => x.status === 'NEW_KAMBA')) {
    try {
      const d = await gemini({ system: SYSTEM_S, user: `The Page owner copied this post from a Kamba (Ukambani) media outlet's Facebook Page. It is mostly in Kikamba.${t.shot ? ' A screenshot of the post is attached; read its text too.' : ''} TODAY IS ${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}.
POST TEXT: <<<${t.text || '(see screenshot)'}>>>
Translate it faithfully into English, then write it as a full Sauti Media news post in English using ONLY those facts, keeping names and places exactly. Never add facts. If it accuses a named person of wrongdoing without an official body confirming it, set "risky" true.
Return JSON: {"outlet":"the outlet's name if shown, else empty","translation":"full English translation","label":"NEWS or UPDATE or COMMUNITY or ALERT or OBITUARY","card":"at most 12 words for the poster","caption":"the post, 300 to 1500 characters, short paragraphs","risky":true|false}`,
        audio: t.shot ? { mime: 'image/jpeg', data: t.shot } : undefined });
      Object.assign(t, { kind: 'news', kamba: true, status: 'DRAFT', sourceName: clean(d.outlet || 'Kamba outlet (Facebook)'), title: clean(d.card || ''), translation: clean(d.translation || ''), risky: !!d.risky,
        label: clean(d.label || 'NEWS'), card: clean(d.card || ''), caption: clean(d.caption || ''), photo: null, local: true });
      delete t.shot;
    } catch (e) { t.tries = (t.tries || 0) + 1; if (t.tries > 3) t.status = 'FAILED'; }
  }
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
}
async function draftTips(dir, gemini, clean) {
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  for (const t of news.filter((x) => x.status === 'NEW_TIP')) {
    try {
      const d = await gemini({ system: SYSTEM_S, user: `The Page owner sent this first hand tip. Write it as a Sauti Media post using ONLY the facts in it. Keep names and places exactly as given; write everything else in English. If something is unclear, leave it out.\nTip: <<<${t.text}>>>\nReturn JSON: {"label":"NEWS or BREAKING or UPDATE or COMMUNITY or OBITUARY","card":"the story in at most 12 words for the poster","caption":"150 to 700 characters, ending with a simple question to readers where it fits (never on an obituary)"}` });
      Object.assign(t, { status: 'APPROVED', auto: true, card: clean(d.card || '') }, breaking(clean(d.label || 'NEWS'), clean(d.caption || '')));
    } catch (e) {}
  }
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
}

// ---------- Kamba media (owner, 3 Nov): Kikamba stories from Ukambani stations, translated into English and sent to
// the owner on Telegram to counter check before anything is posted (Approve / Skip). Their YouTube channels are read
// through YouTube's public feeds; the channel of each station is looked up once and remembered.
const KAMBA_STATIONS = ['Musyi FM', 'Mbaitu FM', 'Athiani FM', 'Wikwatyo FM', 'Kitwii FM', 'Mwatu FM', 'Syokimau FM', 'Mbaitu TV', 'Musyi TV', 'Kamba TV'];
async function kambaChannels(dir) {
  const f = path.join(dir, 'kamba_channels.json'); let m = {}; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  for (const name of KAMBA_STATIONS) {
    if (m[name] && (m[name].id || Date.now() - (m[name].tried || 0) < 7 * 86400000)) continue;
    try {
      const h = await (await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' Kenya') + '&sp=EgIQAg%253D%253D', { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
      const id = (h.match(/"channelId":"(UC[\w-]{22})"/) || [])[1]; const title = (h.match(/"title":\{"simpleText":"([^"]+)"/) || [])[1] || '';
      m[name] = id && new RegExp(name.split(' ')[0], 'i').test(title) ? { id, title } : { tried: Date.now(), title };
    } catch (e) { m[name] = { tried: Date.now() }; }
  }
  fs.writeFileSync(f, JSON.stringify(m, null, 1)); return m;
}
async function kambaNews(dir, state, gemini, clean) {
  state.kambaAt = state.kambaAt || 0; if (Date.now() - state.kambaAt < 55 * 60000) return 0; state.kambaAt = Date.now();
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const seen = new Set(news.map((n) => n.key)); const chans = await kambaChannels(dir); let n = 0;
  for (const [name, c] of Object.entries(chans)) {
    if (!c.id) continue;
    let items = [];
    try { const xml = await (await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + c.id, { headers: BROWSER, signal: AbortSignal.timeout(20000) })).text();
      items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((e) => ({ title: ((e[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(), link: (e[1].match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '', date: (e[1].match(/<published>([^<]+)</) || [])[1] || '', desc: ((e[1].match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '').trim() }));
    } catch (e) { continue; }
    for (const it of items.filter((i) => i.title && Date.now() - Date.parse(i.date) < 12 * 3600000).slice(0, 3)) {
      const key = 'kb_' + crypto.createHash('md5').update(it.link || it.title).digest('hex').slice(0, 10); if (seen.has(key)) continue; seen.add(key);
      try {
        const d = await gemini({ system: SYSTEM_S, user: `This is a news item from ${name}, a Kamba (Ukambani) media outlet, mostly in Kikamba. TODAY IS ${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}.
TITLE: ${it.title}
DESCRIPTION: ${it.desc.slice(0, 3000)}
First translate faithfully into English. Then, ONLY if it is real news (not a programme promo, music, greetings or an advert) and the text gives enough facts, write it as a Sauti Media post using only those facts, in English, keeping names and places exactly. Never add facts. Skip anything that accuses a named person without an official body confirming it.
Return JSON: {"is_news":true|false,"translation":"full English translation","label":"NEWS or UPDATE or COMMUNITY or ALERT","card":"at most 12 words for the poster","caption":"the post, 300 to 1200 characters, short paragraphs","who":"...","where":"..."}` });
        if (!d.is_news || !String(d.caption || '').trim() || !String(d.where || '').trim()) { news.push({ key, kind: 'kamba', status: 'SKIPPED_KAMBA', at: new Date().toISOString(), title: it.title, sourceName: name }); continue; }
        news.push({ key, kind: 'news', kamba: true, status: 'DRAFT', at: new Date().toISOString(), title: it.title, translation: clean(d.translation || ''), sourceName: name, sourceLink: it.link, local: true,
          label: clean(d.label || 'NEWS'), card: clean(d.card || ''), caption: clean(d.caption || ''), photo: null });
        n++;
      } catch (e) {}
    }
  }
  fs.writeFileSync(file, JSON.stringify(news, null, 1)); return n;
}

// ---------- send drafts for approval; approve or skip ----------
async function sendDrafts(dir, ROOT, makeCard) {
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  for (const n of news.filter((x) => x.status === 'DRAFT' && !x.sentAt && x.caption && x.card)) {
    const img = makeCard(n);
    n.image = img;
    const src = n.kamba ? `${n.risky ? '\n\nCAREFUL: this names someone in an accusation that no official body has confirmed.' : ''}\n\nKAMBA SOURCE (${n.sourceName}): "${n.title}"\nTranslation: ${String(n.translation || '').slice(0, 300)}\n${n.sourceLink || ''}` : n.kind === 'news' ? `\n\nFrom a real report (${n.sourceName || 'news'}): "${n.title}"\n${n.sourceLink || ''}` : '\n\nFrom your tip.';
    const id = await tg.photo(path.join(ROOT, img.file), `SAUTI MEDIA DRAFT (${n.label})\n\n${n.caption}${src}\n\nTap Approve to post it within the hour, or Skip.`.slice(0, 1000), [[['Approve', 'n|sauti|' + n.key], ['Skip', 'k|sauti|' + n.key]]]);
    if (id || !tg.on()) n.sentAt = new Date().toISOString();
  }
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
}
function decide(dir, key, approve) {
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  const n = news.find((x) => x.key === key); if (!n || n.status !== 'DRAFT') return n ? n.status : null;
  n.status = approve ? 'APPROVED' : 'SKIPPED'; n.decidedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(news, null, 1));
  return n.status;
}
// The oldest approved item still fresh enough (tips within 2 days, news within 30 hours)
function takeApproved(dir, kinds, urgentOnly) {
  kinds = kinds || ['tip', 'news'];
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  // tips from the owner, then breaking stories, then trending ones (most outlets first), then Ukambani stories, then the oldest (11 Nov: what the country is talking about goes first)
  const urgent = (x) => x.kind === 'tip' ? 3 : /^BREAKING/i.test(String(x.label || '')) ? 2 : (x.heat || 0) >= 4 ? 1 : 0;
  const ok = news.filter((x) => x.status === 'APPROVED' && kinds.includes(x.kind) && (!urgentOnly || urgent(x)) && Date.now() - Date.parse(x.at) < (x.kind === 'tip' ? 48 : x.kind === 'profile' ? 240 : 14) * 3600000)
    .sort((a, b) => (urgent(b) - urgent(a)) || ((b.heat >= 3 ? b.heat : 0) - (a.heat >= 3 ? a.heat : 0)) || (b.local ? 1 : 0) - (a.local ? 1 : 0) || a.at.localeCompare(b.at))[0];
  if (!ok) return null;
  ok.status = 'USED'; fs.writeFileSync(file, JSON.stringify(news, null, 1));
  return ok;
}

// ---------- verified facts from Wikipedia ----------
async function wiki(title) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&explaintext=1&redirects=1&format=json&titles=' + encodeURIComponent(title);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const j = await r.json();
  const pg = Object.values((j.query && j.query.pages) || {})[0];
  if (!pg || pg.missing !== undefined || !pg.extract) return null;
  return { title: pg.title, url: pg.fullurl, text: pg.extract.replace(/\n{2,}/g, '\n').slice(0, 30000) };
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// every claim must quote a sentence that really is in the source text
function checked(d, src) {
  const claims = Array.isArray(d.claims) ? d.claims : [];
  if (!claims.length) return false;
  const t = norm(src.text); const tw = new Set(t.split(' '));
  // a claim is backed when its quote is in the source, or nearly word for word (pages read through a reader service differ in punctuation and small words)
  const backed = (c) => { const q = norm(c && c.quote); if (q.length < 25) return false; if (t.includes(q)) return true;
    const w = q.split(' ').filter((x) => x.length > 2); if (w.length < 5) return false; return w.filter((x) => tw.has(x)).length / w.length >= 0.85; };
  const ok = claims.filter(backed).length;
  checked.last = ok + ' of ' + claims.length;
  return claims.length <= 2 ? ok === claims.length : ok >= claims.length - 1;   // with three or more claims, one loosely quoted claim is allowed
}
const DYK_AREAS = ['technology', 'the human body and medicine', 'science', 'geography of Africa', 'world geography', 'animals and nature', 'space', 'history of Kenya', 'inventions', 'famous people', 'food and farming', 'the ocean'];
async function writeDidYouKnow(posts, gemini, clean) {
  const used = new Set(posts.slice(-200).map((p) => p.topic));
  const area = pick(DYK_AREAS);
  const s = await gemini({ system: SYSTEM_S, user: `Suggest 8 well known English Wikipedia article titles about ${area} that hold a surprising, little known fact ordinary Kenyan readers would love to share. Exact article titles only. Return JSON: {"titles":["..."]}` });
  for (const title of (s.titles || []).filter((t) => !used.has(t)).slice(0, 4)) {
    const src = await wiki(title).catch(() => null); if (!src || src.text.length < 2000) continue;
    const d = await gemini({ system: SYSTEM_S, user: `From this Wikipedia text about "${src.title}", pick ONE surprising, little known fact that would amaze ordinary readers. Use only what the text says. No medical advice. Quote the exact sentence from the text that proves it.\nTEXT:\n${src.text.slice(0, 12000)}\nReturn JSON: {"card":"the fact in at most 12 words, for the poster","caption":"500 to 1100 characters in short paragraphs: the fact stated plainly, then the story behind it and why it is true, explained simply with the details the text gives, ending with a natural question people will want to answer","claims":[{"claim":"the fact","quote":"the exact sentence copied from the text"}]}` });
    if (!checked(d, src)) continue;
    return { topic: title, label: 'Did you know?', card: clean(d.card), sub: '', caption: clean(d.caption), source: src.url };
  }
  return null;
}
async function writeBusinessTip(posts, gemini, clean, hint) {
  hint = hint || '';
  const used = posts.slice(-30).filter((p) => p.category === 'B').map((p) => p.headline).join(' | ');
  const d = await gemini({ system: SYSTEM_S, user: `Write one practical business tip for small business owners and hustlers in Machakos and Ukambani (shops, salons, boda boda, farming, M-Pesa agents, hotels, online sellers). One clear tip, explained with a simple everyday example, no invented statistics, no prices or income promises. Avoid these recent tips: ${used.slice(0, 900)}.${hint} Return JSON: {"card":"the tip in at most 10 words","caption":"800 to 1600 characters in short paragraphs: the problem many business owners face, the tip itself, a simple everyday example from a local business, three practical steps to start this week written as plain sentences, one common mistake to avoid, ending with a natural question business owners will want to answer from their own experience","topic":"two or three words naming the tip"}` });
  return { topic: clean(d.topic || d.card), label: 'Business tip', card: clean(d.card), sub: '', caption: clean(d.caption) };
}
const PEOPLE = ['Wangari Maathai', 'Ngũgĩ wa Thiong\'o', 'Eliud Kipchoge', 'Faith Kipyegon', 'David Rudisha', 'Lupita Nyong\'o', 'Richard Leakey', 'Tegla Loroupe', 'Paul Tergat', 'Kipchoge Keino', 'Catherine Ndereba',
  'Thomas Odhiambo', 'Grace Ogot', 'Margaret Ogola', 'Binyavanga Wainaina', 'Manu Chandaria', 'Chris Kirubi', 'Paul Ngei', 'Kitili Mwendwa', 'Mary Keitany', 'Julius Yego', 'Ferdinand Omanyala', 'Edna Kiplagat', 'Vivian Cheruiyot',
  'Nelson Mandela', 'Kofi Annan', 'Chinua Achebe', 'Wole Soyinka', 'Miriam Makeba', 'Desmond Tutu', 'Akinwumi Adesina', 'Aliko Dangote', 'Strive Masiyiwa', 'Ory Okolloh', 'Juliana Rotich', 'Wanuri Kahiu', 'Peter Tabichi', 'Mumbi Ngugi'];
// Personality of the week: a profile built only from the person's Wikipedia article, sent to the owner to approve
async function draftProfile(dir, posts, gemini, clean) {
  const file = path.join(dir, 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  if (news.some((n) => n.kind === 'profile' && ['DRAFT', 'APPROVED', 'USED'].includes(n.status) && Date.now() - Date.parse(n.at) < 6 * 86400000)) return;
  const done = new Set(news.filter((n) => n.kind === 'profile').map((n) => n.person));
  for (const person of PEOPLE.filter((p) => !done.has(p)).sort(() => Math.random() - 0.5).slice(0, 3)) {
    const src = await wiki(person).catch(() => null); if (!src || src.text.length < 3000) continue;
    const d = await gemini({ system: SYSTEM_S, user: `Write a "Personality of the Week" feature about ${src.title} for Sauti Media readers, using ONLY facts in this Wikipedia text. Warm, inspiring, easy to read: who they are, where they came from, what they achieved, one lesson readers can take. No facts that are not in the text. For each fact you use, quote the exact supporting sentence.\nTEXT:\n${src.text.slice(0, 15000)}\nReturn JSON: {"card":"name and a short hook, at most 10 words","caption":"1500 to 2800 characters in short paragraphs, told as a story readers can follow: early life and roots, the struggles, the turning points, the big achievements with dates and numbers from the text, what they are doing or remembered for now, and one lesson readers can take; end with a question inviting readers to share what inspires them","claims":[{"claim":"...","quote":"the exact sentence copied from the text"}]}` });
    if (!checked(d, src)) continue;
    news.push({ key: 'pf_' + Date.now().toString(36), kind: 'profile', person, status: 'APPROVED', auto: true, at: new Date().toISOString(), title: src.title, sourceName: 'Wikipedia', sourceLink: src.url, label: 'Personality of the week', card: clean(d.card), caption: clean(d.caption) });
    fs.writeFileSync(file, JSON.stringify(news, null, 1));
    return;
  }
}

// ---------- Talk of the day: one debate post a day built on real stories Sauti Media already checked and published ----------
const TALK_STYLE = `RUTO AND KALONZO: A SURPRISE DUO FOR 2027?

Kenyan politics has a way of surprising everyone. Yesterday's rivals often become tomorrow's partners, and as the 2027 General Election draws closer, talk of new alliances is growing louder.

One question is now doing the rounds: could President William Ruto and Wiper Party Leader Kalonzo Musyoka end up on the same side?

On paper, such a partnership would redraw the political map. Ruto would gain a seasoned statesman with a strong following in Ukambani. Kalonzo, a former Vice President, would return to the centre of national government. Some are already asking if Kalonzo could take the running mate position.

But is there real common ground between the two leaders, or is this just another round of political speculation as the country warms up for 2027?

Over to you. Would a Ruto and Kalonzo ticket work, and would Ukambani back it?`;
async function writeTalk(posts, gemini, clean, dir) {
  const recent = posts.filter((p) => p.fromNews && p.status === 'PUBLISHED' && Date.now() - Date.parse(p.publishedAt) < 48 * 3600000 && p.caption)
    .map((p) => p.caption.slice(0, 900)).slice(-14);
  const done = posts.filter((p) => p.category === 'V').slice(-10).map((p) => p.headline).join(' | ');
  if (recent.length < 2) { writeTalk.debug = { stage: 'not enough stories', recent: recent.length }; return null; }
  const d = await gemini({ system: SYSTEM_S, user: `Write today's "talk of the day" post for Sauti Media: the one conversation Kenyans, and especially people in Ukambani, will want to argue about.
Pick the topic from these real stories Sauti Media published in the last two days (politics, leadership, the economy, prices, education, jobs, county matters). Prefer politics and leadership when there is a good one.
Use ONLY facts found in these stories. You may raise questions, possibilities and what people are asking, but never present a rumour or guess as fact, never invent a quote, alliance, poll or number, and never accuse anyone.
Be balanced: give readers the case for and the case against, then hand the question to them.
Write it exactly in the style, structure and quality of this example (a bold question title in capital letters, a hook about how things work in Kenya, the question stated with full names and titles, what each side would gain, the doubt, then one direct, natural question for readers):
<<<${TALK_STYLE}>>>
Do not repeat these recent talk topics: ${done || 'none'}
STORIES:
${recent.map((c, i) => `${i + 1}. ${c}`).join('\n\n')}
Return JSON: {"topic":"three to six words","label":"POLITICS or LEADERSHIP or ECONOMY or EDUCATION or COUNTY","card":"the poster headline: a punchy question of 5 to 9 words","sub":"one short question line for the poster, at most 12 words","caption":"900 to 1600 characters in short paragraphs, with the title line first","image_query":"the full name of the main public official in the topic, or a place or building if no official fits","claims":[{"claim":"each fact you used","quote":"the exact sentence copied from the stories"}]}` });
  const src = { text: recent.join('\n') };
  if (!checked(d, src)) { const t = norm(src.text); writeTalk.debug = { stage: 'fact check', recent: recent.length, bad: (d.claims || []).filter((c) => { const q = norm(c.quote); return !(q.length >= 25 && t.includes(q)); }).slice(0, 5), card: d.card }; return null; }
  const photo = await commonsPhoto(clean(d.image_query || ''), dir, gemini, clean(d.card || ''));
  return { topic: clean(d.topic || d.card), label: clean(d.label || 'POLITICS'), card: clean(d.card), sub: clean(d.sub || ''), caption: clean(d.caption || ''), highlight: true,
    photo: photo ? path.relative(path.join(dir, '..', '..'), photo.file) : null, photoCredit: photo ? photo.credit : '' };
}

module.exports = { storyPhotos, leaderBank, imgDims, official, breaking, recentUse, leaderFromNews, DW, sameDW, sameStoryText, gnResolve, articleText, draftKamba, kambaNews, topicPhoto, articlePhoto, storyPhoto, bankPhoto, research, checked, writeTalk, commonsPhoto, writeDidYouKnow, writeBusinessTip, draftProfile, writeOwn, findNews, isSautiTip, saveTip, draftTips, sendDrafts, decide, takeApproved, SYSTEM_S };
