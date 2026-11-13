// Cornerstone Treatment and Rehabilitation Centre: a client Page run by Timsauti (owner, 9 Nov 2026).
// Monday: the business (services, branches). Wednesday: education on mental health and addiction.
// Friday: an inspirational message of hope with a Bible verse, never marketing (owner, 13 Nov). Each is written early in the morning and sent to the
// owner on Telegram with Approve or Skip; on Approve it goes out on the Cornerstone Facebook Page, and the poster
// and caption come back to him for Instagram, TikTok, Google Business Profile and the website.
'use strict';
const fs = require('fs'), path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const ROOT = path.join(__dirname, '..');
const A = path.join(__dirname, 'assets', 'cornerstone');
const FONTS = path.join(ROOT, 'assets', 'fonts');
const fontFiles = fs.readdirSync(FONTS).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONTS, f));
const C = { dark: '#0b3b3c', teal: '#0e7c6b', green: '#1f8f3a', gold: '#c8892c', grey: '#2f3a3a', bar: '#0b4a45' };
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const mime = (f) => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');

const FACTS = `Cornerstone Treatment and Rehabilitation Centre, Machakos County, Kenya. Tagline: "Mind, Body and Spirit". Holistic, compassionate, client centred and non judgmental drug and alcohol rehabilitation.
Branches: Kithini Branch at Kithini Market, Machakos County; Kyumbi Junction Branch (Cornerstone Rehab Annex, an executive retreat) along Mombasa Road at Makutano Junction, Kyumbi, Machakos County.
Services: inpatient recovery programme; psychiatric care and treatment in a secure inpatient unit; psychological assessments; one on one, group and family counselling; family and spiritual therapy; 12 step programme and relapse prevention; recreational therapy; drug testing and screening; pre employment and workplace drug screening; aftercare and community outreach.
Values: compassion, dignity, integrity, hope, community. Reach: over 1,200 families supported, over 850 aftercare follow ups, over 3,400 drug screenings.
Contact: call or WhatsApp 0720 825 938; email info@cornerstonerehabcenter.co.ke; website cornerstonerehabcenter.co.ke; office hours Monday to Friday, 8am to 5pm.`;

// Friday verses (World English Bible, public domain, quoted exactly)
const VERSES = [
  ['Forget the former things. Don’t dwell on the past. Behold, I will do a new thing.', 'Isaiah 43:18–19'],
  ['I can do all things through Christ, who strengthens me.', 'Philippians 4:13'],
  ['He heals the broken in heart, and binds up their wounds.', 'Psalm 147:3'],
  ['Come to me, all you who labor and are heavily burdened, and I will give you rest.', 'Matthew 11:28'],
  ['Therefore if anyone is in Christ, he is a new creation. The old things have passed away. Behold, all things have become new.', '2 Corinthians 5:17'],
  ['For I will restore health to you, and I will heal you of your wounds, says Yahweh.', 'Jeremiah 30:17'],
  ['But those who wait for Yahweh will renew their strength. They will mount up with wings like eagles.', 'Isaiah 40:31'],
  ['Cast all your worries on him, because he cares for you.', '1 Peter 5:7'],
  ['Yahweh is near to those who have a broken heart, and saves those who have a crushed spirit.', 'Psalm 34:18'],
  ['Don’t you be afraid, for I am with you. Don’t be dismayed, for I am your God. I will strengthen you.', 'Isaiah 41:10'],
  ['Weeping may stay for the night, but joy comes in the morning.', 'Psalm 30:5'],
  ['For God didn’t give us a spirit of fear, but of power, love, and self control.', '2 Timothy 1:7'],
  ['No temptation has taken you except what is common to man. God is faithful, who will not allow you to be tempted above what you are able.', '1 Corinthians 10:13'],
  ['Being confident of this very thing, that he who began a good work in you will complete it.', 'Philippians 1:6'],
  ['Yahweh’s loving kindnesses never cease, because his compassion doesn’t fail. They are new every morning.', 'Lamentations 3:22–23'],
  ['Be strong and courageous. Don’t be afraid. Don’t be dismayed, for Yahweh your God is with you wherever you go.', 'Joshua 1:9'],
];
const MON = ['our full range of services under one roof', 'the Kithini Branch at Kithini Market', 'the Cornerstone Rehab Annex executive retreat at Kyumbi Junction on Mombasa Road', 'workplace and pre employment drug screening for employers', 'family counselling and family support during recovery', 'how admission works and what to expect on the first day', 'aftercare and relapse prevention after treatment', 'psychiatric care and psychological assessments', 'inpatient recovery programme, a typical day at Cornerstone', 'our values: compassion, dignity, integrity, hope and community'];
const WED = ['early warning signs of drug or alcohol addiction', 'how to talk to a loved one about their drinking', 'depression is not just sadness: signs to watch', 'relapse is part of some journeys: warning signs and what to do', 'cannabis (bhang) and the young brain', 'alcohol and the liver: what heavy drinking does', 'gambling addiction among young Kenyans', 'stress, anxiety and when to seek help', 'how families can support someone in recovery', 'myths and facts about rehabilitation', 'prescription drug misuse', 'mental health at the workplace', 'sleep and mental health', 'teenage substance use: what parents should look out for'];

function wrap(text, maxChars) { const words = String(text || '').split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines; }

// poster in the Cornerstone house style: white, deep teal and teal, gold rule, logo, branches and a dark teal bar
function card(o) {   // owner, 13 Nov: every Cornerstone poster keeps the house structure, Friday included
  const W = 1080, H = 1080; const logo = path.join(A, 'logo.png'); const photo = o.photo;
  const person = /\/p_/.test(photo || ''); const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (person) {   // a person or family on white: photo on the left, text on the right
    parts.push(`<image href="data:${mime(photo)};base64,${b64(photo)}" x="0" y="170" width="560" height="760" preserveAspectRatio="xMidYMax meet"/>`);
    parts.push(`<defs><linearGradient id="f" x1="0" x2="1"><stop offset="0.75" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><linearGradient id="g" y1="0" y2="1" x1="0" x2="0"><stop offset="0.82" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect x="0" y="170" width="560" height="760" fill="url(#f)"/><rect x="0" y="170" width="560" height="760" fill="url(#g)"/>`);
    parts.push(`<image href="data:image/png;base64,${b64(logo)}" x="560" y="40" width="480" height="106" preserveAspectRatio="xMaxYMid meet"/>`);
    const X = 575; let y = 190; const h = o.headline || [];
    const fit = (t, size) => Math.min(size, Math.floor(480 / Math.max(1, t.length * 0.74)));   // never wider than the text column
    const big = (t, size, col) => { size = fit(t, size); y += size * 0.78; const r = `<text x="${X}" y="${y}" font-family="Montserrat" font-weight="900" font-size="${size}" fill="${col}">${esc(t)}</text>`; y += size * 0.3; return r; };
    if (h[0]) parts.push(big(h[0].toUpperCase(), 78, C.dark));
    if (h[1]) parts.push(big(h[1].toUpperCase(), h[1].length > 9 ? 74 : 92, C.teal));
    if (h[2]) parts.push(big(h[2].toUpperCase(), 46, C.dark));
    y += 10; parts.push(`<rect x="${X + 120}" y="${y}" width="150" height="5" fill="${C.gold}"/>`); y += 56;
    if (o.verse) { for (const l of wrap('“' + o.verse + '”', 30)) { parts.push(`<text x="${X}" y="${y}" font-family="Lora" font-style="italic" font-size="34" fill="${C.dark}">${esc(l)}</text>`); y += 44; }
      parts.push(`<text x="${X}" y="${y + 6}" font-family="Montserrat" font-weight="600" font-size="22" letter-spacing="3" fill="${C.grey}">${esc(String(o.verseRef || '').toUpperCase())}</text>`); y += 62; }
    for (const l of wrap(o.body, 30)) { if (y > 900) break; parts.push(`<text x="${X}" y="${y}" font-family="Poppins" font-size="27" fill="${C.grey}">${esc(l)}</text>`); y += 38; }
  } else {   // a place: wide photo on top with rounded corners, headline below
    parts.push(`<image href="data:image/png;base64,${b64(logo)}" x="${W / 2 - 300}" y="28" width="600" height="132" preserveAspectRatio="xMidYMid meet"/>`);
    const gal = (o.gallery || []).filter((g) => fs.existsSync(g)).slice(0, 3);
    const HH = gal.length === 3 || o.verse ? 330 : 420;   // with a gallery: a shorter main photo and three small ones below
    if (photo) parts.push(`<clipPath id="r"><rect x="40" y="170" width="1000" height="${HH}" rx="28"/></clipPath><image href="data:${mime(photo)};base64,${b64(photo)}" x="40" y="170" width="1000" height="${HH}" preserveAspectRatio="${/\/s_/.test(photo) ? 'xMidYMin' : 'xMidYMid'} slice" clip-path="url(#r)"/>`);   // scenes with people keep the top of the photo, so no head is cut
    if (gal.length === 3) gal.forEach((g, i) => { const x = 40 + i * 340; parts.push(`<clipPath id="g${i}"><rect x="${x}" y="${170 + HH + 12}" width="320" height="150" rx="18"/></clipPath><image href="data:${mime(g)};base64,${b64(g)}" x="${x}" y="${170 + HH + 12}" width="320" height="150" preserveAspectRatio="xMidYMid slice" clip-path="url(#g${i})"/>`); });
    if (o.tag) parts.push(`<rect x="70" y="${(o.gallery || []).length === 3 ? 455 : 545}" width="${44 + o.tag.length * 21}" height="62" rx="14" fill="${C.green}"/><text x="88" y="${(o.gallery || []).length === 3 ? 497 : 587}" font-family="Montserrat" font-weight="800" font-size="30" fill="#fff">${esc(o.tag.toUpperCase())}</text>`);
    let y = o.verse ? 590 : (o.gallery || []).length === 3 ? 722 : 700; const h = o.headline || [];
    const ls = [h[0], [h[1], h[2]].filter(Boolean).join(' ')].filter(Boolean).map((t) => t.toUpperCase());   // first part dark, the rest teal
    const gmode = (o.gallery || []).length === 3; ls.forEach((l, i) => { const size = Math.min(gmode ? 52 : 60, Math.floor(980 / Math.max(1, l.length * 0.74))); parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="${size}" fill="${i === 0 ? C.dark : C.teal}">${esc(l)}</text>`); y += size + 8; });
    parts.push(`<rect x="${W / 2 - 75}" y="${y - 22}" width="150" height="5" fill="${C.gold}"/>`); y += 30;
    if (o.verse) {   // Friday on a wide photo: the verse takes the place of the body text
      y += 8; for (const l of wrap('“' + o.verse + '”', 58).slice(0, 4)) { parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Lora" font-style="italic" font-size="32" fill="${C.dark}">${esc(l)}</text>`); y += 42; }
      parts.push(`<text x="${W / 2}" y="${y + 6}" text-anchor="middle" font-family="Montserrat" font-weight="600" font-size="22" letter-spacing="3" fill="${C.grey}">${esc(String(o.verseRef || '').toUpperCase())}</text>`);
    } else for (const l of wrap(o.body, 66).slice(0, 2)) { parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Poppins" font-size="27" fill="${C.grey}">${esc(l)}</text>`); y += 38; }
  }
  // branches and the bottom bar (as on the owner's sample posters)
  const pin = (x) => `<path d="M${x} 956 c-11 0 -20 9 -20 20 c0 15 20 34 20 34 s20 -19 20 -34 c0 -11 -9 -20 -20 -20z" fill="${C.teal}"/><circle cx="${x}" cy="976" r="7" fill="#fff"/>`;
  parts.push(`<rect x="0" y="935" width="${W}" height="145" fill="#ffffff"/>`);
  parts.push(pin(120) + `<text x="152" y="975" font-family="Montserrat" font-weight="800" font-size="25" fill="${C.dark}">Kithini Branch</text><text x="152" y="1004" font-family="Poppins" font-size="21" fill="${C.grey}">Kithini Market, Machakos County</text>`);
  parts.push(`<rect x="538" y="952" width="3" height="58" fill="${C.teal}"/>`);
  parts.push(pin(600) + `<text x="632" y="975" font-family="Montserrat" font-weight="800" font-size="25" fill="${C.dark}">Kyumbi Junction Branch</text><text x="632" y="1004" font-family="Poppins" font-size="21" fill="${C.grey}">Along Mombasa Road, Machakos County</text>`);
  parts.push(`<rect x="36" y="1022" width="1008" height="46" rx="23" fill="${C.bar}"/><text x="540" y="1053" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="21" fill="#fff">${esc(o.barText || 'Call or WhatsApp 0720 825 938   |   cornerstonerehabcenter.co.ke')}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  return new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Poppins' }, fitTo: { mode: 'width', value: W } }).render().asPng();
}

// Friday (owner, 13 Nov): NOT marketing. A poster of hope for a person in recovery, one who has recovered, or one close to
// giving up, beautiful enough to be shared anywhere: a calm landscape, the message large, the verse, and only a small
// Cornerstone signature (no branches, no phone bar).
const HOPE = () => { const d = path.join(ROOT, 'data', 'cornerstone', 'hope'); let l = []; try { l = fs.readdirSync(d).filter((f) => /\.jpe?g$/i.test(f)).map((f) => path.join(d, f)); } catch (e) {} return l.concat(['f_kyumbi_garden.jpg', 'f_kyumbi_garden2.jpg'].map((f) => path.join(A, f))); };
function cardFri(o) {
  const W = 1080, H = 1350; const parts = []; const photo = o.photo;
  parts.push(`<defs><linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#062b2c" stop-opacity="0.3"/><stop offset="0.2" stop-color="#062b2c" stop-opacity="0"/><stop offset="0.62" stop-color="#062b2c" stop-opacity="0.35"/><stop offset="1" stop-color="#062b2c" stop-opacity="1"/></linearGradient></defs>`);
  // the photo fills the top, so the sunrise or the hills stay clear of the words; it melts into deep teal below
  parts.push(`<rect width="${W}" height="${H}" fill="#062b2c"/>`);
  if (photo) parts.push(`<image href="data:${mime(photo)};base64,${b64(photo)}" x="0" y="0" width="${W}" height="880" preserveAspectRatio="xMidYMid slice"/>`);
  parts.push(`<rect width="${W}" height="881" fill="url(#sh)"/>`);
  parts.push(`<rect x="60" y="56" width="270" height="62" rx="31" fill="none" stroke="#e8c27a" stroke-width="2"/><text x="195" y="96" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="22" letter-spacing="5" fill="#f4dfb0">FRIDAY HOPE</text>`);
  const h = (o.headline || []).map((t) => String(t).toUpperCase()); let y = 630;
  const line = (t, size, col) => { size = Math.min(size, Math.floor(960 / Math.max(1, t.length * 0.72))); y += size * 0.8; const r = `<text x="60" y="${y}" font-family="Montserrat" font-weight="900" font-size="${size}" fill="${col}">${esc(t)}</text>`; y += size * 0.22; return r; };
  if (h[0]) parts.push(line(h[0], 80, '#ffffff'));
  if (h[1]) parts.push(line(h[1], 132, '#f2c46d'));
  if (h[2]) parts.push(line(h[2], 80, '#ffffff'));
  y += 22; parts.push(`<rect x="60" y="${y}" width="140" height="6" rx="3" fill="#f2c46d"/>`); y += 66;
  for (const l of wrap(o.body, 44).slice(0, 2)) { parts.push(`<text x="60" y="${y}" font-family="Poppins" font-weight="500" font-size="33" fill="#ffffff">${esc(l)}</text>`); y += 46; }
  if (o.verse) { y += 24; for (const l of wrap('“' + o.verse + '”', 52).slice(0, 3)) { parts.push(`<text x="60" y="${y}" font-family="Lora" font-style="italic" font-size="30" fill="#e9efe9">${esc(l)}</text>`); y += 40; }
    parts.push(`<text x="60" y="${y + 6}" font-family="Montserrat" font-weight="700" font-size="21" letter-spacing="4" fill="#f2c46d">${esc(String(o.verseRef || '').toUpperCase())}</text>`); }
  parts.push(`<rect x="60" y="${H - 88}" width="230" height="68" rx="14" fill="#ffffff"/><image href="data:image/png;base64,${b64(path.join(A, 'logo.png'))}" x="68" y="${H - 84}" width="214" height="60" preserveAspectRatio="xMidYMid meet"/>`);
  parts.push(`<text x="${W - 60}" y="${H - 60}" text-anchor="end" font-family="Montserrat" font-weight="700" font-size="24" fill="#ffffff">Mind, Body and Spirit</text><text x="${W - 60}" y="${H - 28}" text-anchor="end" font-family="Poppins" font-size="20" fill="#cfe3dd">You are not alone on this journey</text>`);
  if (o.credit) parts.push(`<text x="${W - 24}" y="${H - 118}" text-anchor="end" font-family="Poppins" font-size="15" fill="#ffffff" fill-opacity="0.75">${esc(o.credit)}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  return new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Poppins' }, fitTo: { mode: 'width', value: W } }).render().asPng();
}
const PEOPLE = () => fs.readdirSync(A).filter((f) => /^(p|s)_/.test(f)).map((f) => path.join(A, f));   // p_ = a cut out person on white, s_ = a real scene (counselling, staff, activities, the Page's own older photos)
// no photo over and over (owner, 11 Nov): the photo never used wins, otherwise the one used longest ago; skipped drafts count too, since the owner saw them
const lru = (list, history) => { if (!list.length) return undefined; const last = (f) => { let k = -1; history.forEach((h, i) => { if (h && h.photo && path.basename(h.photo) === path.basename(f)) k = i; }); return k; };
  const sc = list.map((f, i) => [last(f), (i - history.length % list.length + list.length) % list.length, f]).sort((x, y) => x[0] - y[0] || x[1] - y[1]); return sc[0][2]; };
const PLACES = (re) => fs.readdirSync(A).filter((f) => /^f_/.test(f) && (!re || re.test(f))).map((f) => path.join(A, f));

// write one post; kind = MON | WED | FRI
async function write(kind, history, gemini, clean) {
  const used = history.map((h) => h.topic).slice(-12);
  const pick = (list) => list.find((t) => !used.includes(t)) || list[history.length % list.length];
  let topic, verse = null, photo;
  let gallery = null;
  if (kind === 'MON') { topic = pick(MON); photo = /Kyumbi|Annex|executive/i.test(topic) ? PLACES(/kyumbi/)[history.length % PLACES(/kyumbi/).length] : /Kithini/i.test(topic) ? lru(PLACES(/kithini/), history) : lru(PLACES().filter((f) => !/pool/.test(f)), history); }
  if (kind === 'MON' && /Kyumbi|Annex|executive/i.test(topic)) {   // the Annex: a main photo and three small ones (owner's photo gallery, 9 Nov)
    const hero = path.basename(lru(['f_kyumbi_garden.jpg', 'f_kyumbi_annex.jpg', 'f_kyumbi_annex_front.jpg', 'f_kyumbi_garden2.jpg'].map((g) => path.join(A, g)), history));   // the house and grounds lead; the pool never leads (owner, 9 Nov: it looked like a swimming pool business)
    photo = path.join(A, hero); gallery = null; void ['f_kyumbi_annex_front.jpg', 'f_kyumbi_lounge.jpg', 'f_kyumbi_garden.jpg', 'f_kyumbi_bedroom.jpg', 'f_kyumbi_poolside.jpg', 'f_kyumbi_gate_sign.jpg'].filter((g) => g !== hero).slice(history.length % 3, history.length % 3 + 3).map((g) => path.join(A, g));
  }
  if (kind === 'WED') { topic = pick(WED); photo = lru(PEOPLE(), history); }
  if (kind === 'FRI') { const v = VERSES.find((x) => !used.includes(x[1])) || VERSES[history.length % VERSES.length]; verse = v; topic = v[1]; photo = lru(HOPE(), history); }   // a hopeful piece never carries the weary photo
  const brief = kind === 'MON' ? `a BUSINESS post promoting Cornerstone, today about: ${topic}. Warm, professional, reassuring; invite people to call or WhatsApp for admission or enquiries.`
    : kind === 'WED' ? `an EDUCATIONAL post on: ${topic}. Accurate, practical, kind and free of stigma; plain facts a family can use; end by noting Cornerstone can help.`
    : `an INSPIRATIONAL Friday message built on this exact Bible verse: "${verse[0]}" (${verse[1]}). It is NOT marketing: do not mention services, branches, admission, prices or the centre's achievements. Speak warmly and directly to a person in recovery, a person who has recovered and is holding on, or a person close to giving up: name what they feel, give real hope and one small step for today. Personal, fond and strong enough that people share it with someone who needs it; gentle, never preachy. The headline is a powerful line of hope of its own (not the verse), like ["Do not","give up","you are closer than you think"] or ["One day","at a time","is still progress"].`;
  const d = await gemini({ system: 'You write social media content for a rehabilitation centre in Kenya. You only use the facts given. Output only JSON.', user: `Facts about the client:\n${FACTS}\n\nWrite ${brief}
Rules: English only. Never invent facts, prices, names, staff, success rates or claims of cure; only mention services and places listed in the facts. No stigma words such as addict or junkie; say person living with addiction or person in recovery. Do not shame anyone. No dashes, no emojis, never the words "testament" or "whether". Never ask readers to comment, like, share or tag.
The headline is ONE short phrase split over three lines that read together as a sentence, like ["A new","beginning","is always possible"] or ["Your path to","recovery","starts here"]; the middle line is the key word.${kind === 'FRI' ? ' The poster body must NOT repeat the verse; write a fresh, warm reflection. Do not quote or paraphrase the verse in the caption either; the verse is added above the caption exactly as written.' : ''}
Return JSON: {"headline":["first line, 1 to 3 words","key word, at most 10 letters","last line, 2 to 4 words"],"body":"poster text, at most 18 words","tag":"${kind === 'MON' ? 'a 1 to 3 word label for the photo, e.g. NOW ADMITTING or KYUMBI ANNEX' : ''}","caption":"the Facebook caption: 70 to 150 words, short paragraphs, ${kind === 'FRI' ? 'ending with one warm closing line of hope (no phone number, no services, no question asking for comments)' : 'ending with the contact line Call or WhatsApp 0720 825 938'}","hashtags":"5 to 7 hashtags for Instagram and TikTok, including #CornerstoneRehab #Machakos"}` });
  const out = { kind, topic, headline: (d.headline || []).map((x) => clean(x)).filter(Boolean).slice(0, 3), body: clean(d.body || ''), tag: clean(d.tag || ''), caption: clean(d.caption || ''), hashtags: String(d.hashtags || '').replace(/[^#\w\s]/g, '').trim(), photo, gallery, verse: verse ? verse[0] : null, verseRef: verse ? verse[1] : null };
  if (out.headline.length < 2 || out.caption.length < 200) throw new Error('weak draft');
  if (kind === 'FRI') {   // the verse is quoted exactly at the top, once: any repeat of it, or any contact or services line the writer slipped in, goes
    const vn = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, '').slice(0, 40);
    out.caption = out.caption.split(/\n\s*\n/).filter((pa) => !vn(pa).includes(vn(verse[0]).slice(0, 30)) && !/0720|whatsapp|call us|kithini|kyumbi|admission|our services|inpatient/i.test(pa)).join('\n\n');
    if (/\/hope\//.test(photo)) { try { const ix = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cornerstone', 'hope', 'index.json'), 'utf8')); const e = Object.values(ix).find((v) => v.file === path.basename(photo)); out.credit = e ? e.credit : ''; } catch (e) {} }
    out.caption = `"${verse[0]}" ${verse[1]} (WEB)\n\n` + out.caption + '\n\nCornerstone Treatment and Rehabilitation Centre. Mind, Body and Spirit.' + (out.credit ? '\n\n' + out.credit : '');
  }   // the verse is always quoted exactly, at the top
  return out;
}

// ---------- the daily flow ----------
const DIR = path.join(ROOT, 'data', 'cornerstone'); const FILE = path.join(DIR, 'posts.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; } };
const save = (ps) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(ps, null, 1)); };
const audit = (o) => { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(path.join(DIR, 'audit.jsonl'), JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o)) + '\n'); };
const KIND = { 1: 'MON', 3: 'WED', 5: 'FRI' };
const NAME = { MON: 'Monday business post', WED: 'Wednesday education post', FRI: 'Friday motivation post' };
// called on every agent run: writes the day's draft from 5am, sends it for approval, posts approved drafts at 10am (or at once if later)
async function daily({ tg, gemini, clean, token, mask, GV }) {
  const now = new Date(Date.now() + 3 * 3600000); const day = now.toISOString().slice(0, 10); const hour = now.getUTCHours(); const kind = KIND[now.getUTCDay()];
  const ps = load();
  if (kind && hour >= 5 && hour < 20 && !ps.some((p) => p.day === day && p.status !== 'SUPERSEDED')) {
    const d = await write(kind, ps, gemini, clean);
    const id = 'cs_' + Date.now().toString(36);
    fs.mkdirSync(path.join(DIR, 'images'), { recursive: true }); const img = path.join(DIR, 'images', id + '.png');
    fs.writeFileSync(img, card(d));
    const post = Object.assign({ id, day, status: 'DRAFT', createdAt: new Date().toISOString(), image: path.relative(ROOT, img) }, d, { photo: path.relative(ROOT, d.photo), gallery: d.gallery ? d.gallery.map((g) => path.relative(ROOT, g)) : null });
    ps.push(post); save(ps); audit({ event: 'draft_written', id, kind, topic: d.topic });
  }
  for (const p of ps.filter((x) => x.status === 'DRAFT' && !x.sentAt)) {
    const text = `CORNERSTONE ${NAME[p.kind] || 'post'}\n\n${p.caption}\n\n${p.hashtags}`;
    const mid = await tg.photo(path.join(ROOT, p.image), (text.length > 1000 ? text.slice(0, 990) + '...' : text), [[['Approve', 'ca|cornerstone|' + p.id], ['Skip', 'cs|cornerstone|' + p.id]]]);
    if (text.length > 1000) await tg.send('Full caption:\n\n' + p.caption + '\n\n' + p.hashtags);
    if (mid || !tg.on()) { p.sentAt = new Date().toISOString(); save(ps); }
  }
  for (const p of ps.filter((x) => x.status === 'APPROVED')) {
    if (!token) { audit({ event: 'no_token' }); break; }
    const ten = Date.parse(p.day + 'T07:00:00Z');   // 10am Nairobi time
    const when = !p.now && ten - Date.now() > 12 * 60000 ? ten : null;   // p.now: the owner asked for it to go out at once (11 Nov)
    const fd = new FormData();
    fd.append('source', new Blob([require('./strip').strip(fs.readFileSync(path.join(ROOT, p.image)))], { type: 'image/png' }), 'poster.png');
    fd.append('message', p.caption + '\n\n' + p.hashtags);
    if (when) { fd.append('published', 'false'); fd.append('scheduled_publish_time', String(Math.floor(when / 1000))); }
    const r = await fetch(`https://graph.facebook.com/${GV}/104576991675007/photos`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd, signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { p.status = 'FAILED'; p.error = mask(JSON.stringify(j.error || j)).slice(0, 200); save(ps); audit({ event: 'publish_failed', id: p.id, error: p.error }); await tg.send('Cornerstone post could not go out on Facebook: ' + p.error); continue; }
    p.status = 'PUBLISHED'; p.publishedAt = new Date(when || Date.now()).toISOString(); p.fb = { photoId: j.id, postId: j.post_id || null }; save(ps); audit({ event: when ? 'booked' : 'published', id: p.id, fb: p.fb });
    await tg.photo(path.join(ROOT, p.image), `CORNERSTONE: ${when ? 'booked on Facebook for 10am today' : 'posted on Facebook'}. For Instagram, TikTok, Google Business Profile and the website, save this poster and use the caption below.`, null);
    await tg.send(p.caption + '\n\n' + p.hashtags);
  }
}
// the owner's Approve or Skip on Telegram
function decide(id, approve) { const ps = load(); const p = ps.find((x) => x.id === id); if (!p || p.status !== 'DRAFT') return p ? p.status : null;
  p.status = approve ? 'APPROVED' : 'SKIPPED'; p.decidedAt = new Date().toISOString(); save(ps); audit({ event: 'owner_' + p.status.toLowerCase(), id }); return p.status; }
module.exports = { card, write, daily, decide, FACTS, VERSES, PAGE_ID: '104576991675007' };
