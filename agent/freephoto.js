// Free photos from the open web, so no poster has to repeat a picture (owner, 10 Nov 2026: "you are overusing the same
// photo; most of the photos you want can be found online freely").
// Every agent run adds a few new, freely licensed photographs to the topic photo bank in data/topics (saved with the
// run's records). Sources: Wikimedia Commons and Openverse (Flickr and other open collections). Only CC0, public
// domain, CC BY and CC BY-SA pictures are taken; CC BY pictures carry the photographer's name, very small, on the poster.
// Each picture is looked at by the AI before it is kept: a clear real photograph, no maps or text, no dead or injured
// people, and no person whose face can be recognised (these photos go on stories about other people).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const UA = { 'User-Agent': 'SautiMediaTopicBank/1.1 (Facebook Page assistant; contact through the Sauti Media Page)' };
const ASSET_DIR = path.join(__dirname, 'assets', 'topics'), DATA_DIR = path.join(__dirname, '..', 'data', 'topics');
const TARGET = 24;   // photos wanted per topic
// places and things, never named people
const TOPICS = {
  education: ['school building Kenya', 'classroom Kenya', 'primary school Kenya', 'secondary school Kenya', 'University of Nairobi', 'Kenyatta University', 'school library Kenya', 'school desks Africa', 'Moi University', 'school bus Kenya', 'Machakos University', 'school compound Kenya'],
  ukambani: ['Machakos town', 'Machakos County', 'Machakos People\'s Park', 'Kitui town', 'Kitui County', 'Makueni County', 'Wote Makueni', 'Machakos hills', 'Masinga Dam', 'Athi River Kenya', 'Mwingi Kenya', 'Ol Donyo Sabuk', 'Lukenya', 'Tala Kangundo', 'Mlolongo'],
  government: ['State House Nairobi', 'Harambee House Nairobi', 'Kenya county government offices', 'Kenyatta International Convention Centre', 'Nyayo House Nairobi', 'Treasury Building Nairobi', 'Kenya flag flying', 'Huduma Centre', 'county assembly Kenya', 'Teleposta Towers'],
  water: ['borehole Kenya', 'water tank Kenya', 'dam Kenya', 'Masinga dam', 'water kiosk Kenya', 'river Kenya', 'Thwake dam', 'Athi River water', 'irrigation Kenya', 'water pump Africa village', 'Tana River Kenya', 'sand dam Kenya'],
  sports: ['Kasarani stadium', 'Nyayo National Stadium', 'football pitch Kenya', 'athletics track Kenya', 'marathon Kenya road race', 'Kenyatta Stadium Machakos', 'football stadium Africa', 'Eldoret athletics', 'rugby Kenya sevens match', 'Kipchoge Keino Stadium'],
  technology: ['mobile phone Kenya', 'M-Pesa shop', 'computer lab Kenya', 'smartphone Africa hands', 'Safaricom', 'cyber cafe Kenya', 'laptop Africa office', 'telecommunications mast Kenya', 'Konza Technopolis', 'solar panels Kenya'],
  faith: ['church building Kenya', 'cathedral Nairobi', 'All Saints Cathedral Nairobi', 'Holy Family Basilica Nairobi', 'church Machakos', 'mosque Kenya', 'Jamia Mosque Nairobi', 'church interior Kenya', 'chapel Kenya', 'Bible open'],
  fire: ['fire engine Kenya', 'fire truck Nairobi', 'fire station Kenya', 'firefighters Africa', 'fire brigade truck', 'burnt building Kenya', 'smoke over city Nairobi', 'fire extinguisher'],
  health: ['hospital Kenya', 'Kenyatta National Hospital', 'health centre Kenya', 'dispensary Kenya', 'ambulance Kenya', 'hospital ward Kenya', 'Machakos Level 5 Hospital', 'clinic Kenya building', 'medical laboratory Africa', 'pharmacy Kenya', 'Moi Teaching and Referral Hospital', 'Aga Khan Hospital Nairobi'],
  economy: ['Kenyan shilling banknotes', 'Central Bank of Kenya', 'Kenya coins money', 'Nairobi Securities Exchange', 'Times Tower Nairobi', 'Kenya supermarket', 'Mombasa port containers', 'bank building Nairobi', 'petrol station Kenya', 'Nairobi market', 'ATM Kenya', 'Kenya shopping mall'],
  politics: ['Parliament of Kenya', 'Kenya National Assembly', 'Senate of Kenya', 'ballot box Kenya election', 'polling station Kenya', 'Kenya election queue', 'political rally Kenya crowd', 'County Hall Nairobi', 'Bomas of Kenya', 'IEBC Kenya'],
  court: ['Milimani Law Courts', 'Supreme Court of Kenya', 'Kenya High Court building', 'law courts Kenya', 'Mombasa law courts', 'Kisumu law courts', 'judge gavel', 'scales of justice', 'Machakos law courts', 'court room Africa'],
  police: ['Kenya Police vehicle', 'police station Kenya', 'Kenya police officers parade', 'National Police Service Kenya', 'police roadblock Kenya', 'police Land Cruiser Kenya', 'Vigilance House Nairobi', 'police line tape', 'police motorcycle Kenya', 'Kenya prison gate'],
  weather: ['flood Kenya', 'heavy rain Kenya', 'storm clouds Africa', 'flooded road Kenya', 'drought Kenya', 'dry river bed Kenya', 'rain clouds Nairobi', 'lightning Africa', 'muddy road Kenya', 'sunrise Kenya savanna'],
  farming: ['maize farm Kenya', 'farm Kenya field', 'Machakos farm terraces', 'Kenya agriculture harvest', 'tea plantation Kenya', 'coffee farm Kenya', 'greenhouse Kenya', 'cattle Kenya', 'goats Kenya', 'mango tree Kenya', 'tractor Kenya', 'vegetables market Kenya', 'beans harvest Africa', 'poultry farm Kenya'],
  transport: ['Kenya highway', 'matatu Nairobi', 'Nairobi Expressway', 'Kenya road construction', 'Mombasa Road Kenya', 'Thika Superhighway', 'Standard Gauge Railway Kenya', 'Madaraka Express', 'boda boda Kenya', 'bus station Kenya', 'Jomo Kenyatta International Airport', 'bridge Kenya', 'lorry Kenya road', 'Nairobi traffic'],
  nairobi: ['Nairobi skyline', 'Nairobi central business district', 'Nairobi city street', 'Kenyatta Avenue Nairobi', 'Uhuru Park Nairobi', 'Nairobi aerial view', 'Westlands Nairobi', 'Upper Hill Nairobi', 'Nairobi at night', 'Moi Avenue Nairobi', 'Nairobi National Park skyline'],
  business: ['small shop Kenya', 'market Kenya', 'Nairobi street businesses', 'jua kali Kenya', 'kiosk Kenya', 'Gikomba market', 'Kenya shop front', 'vegetable stall Kenya', 'hardware shop Africa', 'tailor shop Kenya', 'Machakos market', 'Kenya mall interior', 'workshop Kenya carpentry', 'salon Kenya']
};

function readIdx(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch (e) { return {}; } }
// the whole bank: the photos that came with the agent plus the ones it has found since
function bank() {
  const out = {};
  for (const dir of [ASSET_DIR, DATA_DIR]) for (const [t, list] of Object.entries(readIdx(dir))) for (const p of (Array.isArray(list) ? list : [])) {
    if (p && p.file && fs.existsSync(path.join(dir, p.file))) (out[t] = out[t] || []).push(Object.assign({}, p, { dir }));
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the AI looks at the photo. true = keep, false = not suitable, null = the check could not run (try again another day)
async function look(buf, topic) {
  if (process.env.FREEPHOTO_NOCHECK === '1') return true;
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  // first a model the agent does not write with, so finding photos never uses up the agent's daily allowance. It proved slow (about 44 seconds a photo
  // on 10 Nov), so it gets 20 seconds, then the last model on the agent's own list, which the agent almost never reaches
  for (const [model, ms] of [['gemma-4-26b-a4b-it', 20000], ['gemini-3.1-flash-lite', 25000]]) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { method: 'POST', signal: AbortSignal.timeout(ms), headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Is this a clear, good quality real photograph that would work as the background of a Kenyan news poster about "${topic}"? It must not be a map, chart, drawing, document, screenshot or mostly blank, must not have large text or watermarks on it, must not show dead or injured people, and no single person in it may be clearly recognisable from their face (crowds, people far away, from behind or too small to recognise are fine), and it must not show a well known public figure. It should look like Kenya or East Africa, or be a plain object that could be anywhere. Return JSON {"ok":true|false}` }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }], generationConfig: { temperature: 0 } }) });
      const j = await r.json(); if (!r.ok) continue;
      const tx = j.candidates[0].content.parts.map((x) => x.text || '').join(''); const m = tx.match(/\{[^{}]*\}/); if (!m) return null;
      return JSON.parse(m[0]).ok === true;
    } catch (e) {}
  }
  return null;
}
const BAD_TITLE = /\bmaps?\b|diagram|chart|\bgraph\b|logo|flag of|coat of arms|\bplan\b|drawing|illustration|poster|screenshot|\bscan|document|selfie|portrait|mugshot|stamp|banknote specimen|\.svg|\.png|\.gif/i;
const licOk = (lic) => { lic = String(lic || '').trim(); return { free: /^(cc0|public domain|pd)/i.test(lic), by: /^cc[ -]by(-sa)?( \d|$)/i.test(lic) }; };
// Wikimedia Commons
async function commons(q, offset) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsroffset=' + (offset || 0) + '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1080&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + q);
  const j = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).json(); const out = [];
  for (const pg of Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index)) {
    const ii = (pg.imageinfo || [])[0]; if (!ii || ii.mime !== 'image/jpeg' || ii.width < 900 || ii.height < 500 || !ii.thumburl) continue;
    const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '').trim(); const { free, by } = licOk(lic); if (!free && !by) continue;
    const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50); if (!free && (!artist || /unknown/i.test(artist))) continue;
    out.push({ id: 'commons:' + pg.title, title: pg.title, url: ii.thumburl, credit: free ? '' : `${artist}, ${lic}`, from: 'Wikimedia Commons' });
  }
  return out;
}
// Openverse: open licensed photos from Flickr and other collections
async function openverse(q, page) {
  const u = 'https://api.openverse.org/v1/images/?license=by,by-sa,cc0,pdm&page_size=20&page=' + (page || 1) + '&q=' + encodeURIComponent(q);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error('status ' + r.status);
  const j = await r.json(); const out = [];
  for (const x of (j.results || [])) {
    if (!x || !x.url || x.mature || (x.width && x.width < 900) || (x.height && x.height < 500)) continue;
    if (x.filetype && !/^jpe?g$/i.test(x.filetype)) continue;
    const code = String(x.license || '').toLowerCase(); if (!['by', 'by-sa', 'cc0', 'pdm'].includes(code)) continue;
    const free = code === 'cc0' || code === 'pdm'; const artist = String(x.creator || '').replace(/\s+/g, ' ').trim().slice(0, 50); if (!free && !artist) continue;
    out.push({ id: 'openverse:' + x.id, title: String(x.title || ''), url: x.url, credit: free ? '' : `${artist}, CC ${code.toUpperCase()}${x.license_version ? ' ' + x.license_version : ''}`, from: 'Openverse', big: true });
  }
  return out;
}
// bring a downloaded picture to a plain JPEG at most 1080 pixels across; null if it is not a usable picture
function normalise(raw, tmpBase) {
  let ff = 'ffmpeg'; try { ff = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
  const src = tmpBase + '.src', out = tmpBase + '.jpg';
  try {
    fs.writeFileSync(src, raw);
    cp.execFileSync(ff, ['-v', 'error', '-y', '-i', src, '-vf', "scale='min(1080,iw)':-2", '-frames:v', '1', '-q:v', '4', out], { timeout: 30000 });
    const info = String(cp.spawnSync(ff, ['-hide_banner', '-i', out], { timeout: 20000 }).stderr || ''); const dm = info.match(/,\s*(\d{3,5})x(\d{3,5})/);
    if (!dm || +dm[1] < 900 || +dm[2] < 500) return null;
    return fs.readFileSync(out);
  } catch (e) { return null; } finally { for (const f of [src, out]) { try { fs.unlinkSync(f); } catch (e) {} } }
}
// add new photos to the thinnest topics until the time is up. Safe to call on every run: it never throws.
async function topUp(opts) {
  const budgetMs = (opts && opts.budgetMs) || 120000, perTopic = (opts && opts.perTopic) || 4, end = Date.now() + budgetMs; let added = 0; const got = {};
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const idxF = path.join(DATA_DIR, 'index.json'), stF = path.join(DATA_DIR, 'state.json');
    const idx = readIdx(DATA_DIR); let st = {}; try { st = JSON.parse(fs.readFileSync(stF, 'utf8')); } catch (e) {}
    st.turn = st.turn || {}; st.seen = Array.isArray(st.seen) ? st.seen : [];
    const seen = new Set(st.seen); const all = bank();
    for (const list of Object.values(all)) for (const p of list) { if (p.title) seen.add('commons:' + p.title); if (p.id) seen.add(p.id); }
    const save = () => { st.seen = Array.from(seen).slice(-6000); fs.writeFileSync(idxF, JSON.stringify(idx, null, 1)); fs.writeFileSync(stF, JSON.stringify(st)); };
    const order = Object.keys(TOPICS).map((t) => [t, (all[t] || []).length]).filter((x) => x[1] < TARGET).sort((a, b) => a[1] - b[1]);
    let unchecked = 0; const stat = { at: new Date().toISOString(), commons: 0, openverse: 0, errors: [], kept: 0, rejected: 0, busy: 0, lookMs: 0 }; st.last = stat;   // what the last run saw, for fault finding
    for (const [topic] of order) {
      if (Date.now() > end || unchecked >= 3) break;
      let n = 0; const qs = TOPICS[topic];
      for (let tries = 0; tries < 3 && n < perTopic && Date.now() < end && unchecked < 3; tries++) {
        const turn = st.turn[topic] || 0; st.turn[topic] = turn + 1;
        const q = qs[turn % qs.length], round = Math.floor(turn / qs.length);   // each visit takes the next search; later rounds go deeper into the results
        let cands = [];
        try { const c1 = await commons(q, round * 12); stat.commons += c1.length; cands = cands.concat(c1); } catch (e) { stat.errors.push('commons: ' + String(e.message).slice(0, 80)); }
        try { const c2 = await openverse(q, round + 1); stat.openverse += c2.length; cands = cands.concat(c2); } catch (e) { stat.errors.push('openverse: ' + String(e.message).slice(0, 80)); }
        for (const c of cands) {
          if (n >= perTopic || Date.now() > end || unchecked >= 3) break;
          if (seen.has(c.id) || BAD_TITLE.test(c.title)) continue;
          try {
            const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) { seen.add(c.id); continue; }
            if (+(r.headers.get('content-length') || 0) > 12e6) { seen.add(c.id); continue; }
            let buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 30000) { seen.add(c.id); continue; }
            if (c.big) { buf = normalise(buf, path.join(DATA_DIR, 'tmp_' + crypto.randomBytes(4).toString('hex'))); if (!buf) { seen.add(c.id); continue; } }
            const t0 = Date.now(); const ok = await look(buf, topic); stat.lookMs += Date.now() - t0; if (ok === null) stat.busy++; else if (ok) stat.kept++; else stat.rejected++; await sleep(process.env.FREEPHOTO_NOCHECK === '1' ? 0 : 4500);   // stay under the AI's per minute limit
            if (ok === null) { unchecked++; continue; }   // the check is busy: stop soon and try again next run
            seen.add(c.id); if (!ok) continue;
            const file = `${topic}_${crypto.createHash('md5').update(c.id).digest('hex').slice(0, 8)}.jpg`; fs.writeFileSync(path.join(DATA_DIR, file), buf);
            (idx[topic] = idx[topic] || []).push({ file, id: c.id, title: c.title.slice(0, 120), credit: c.credit, from: c.from, at: new Date().toISOString(), cleanChecked: true });
            n++; added++; got[topic] = n; save();
          } catch (e) {}
        }
      }
      save();
    }
  } catch (e) { return { added, got, error: String(e.message).slice(0, 150) }; }
  return { added, got };
}
module.exports = { bank, topUp, TOPICS, TARGET, DATA_DIR, ASSET_DIR };
