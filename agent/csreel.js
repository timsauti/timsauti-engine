// Cornerstone Reels (owner, 27 Nov): a short vertical video on the days without an official post (Tuesday, Thursday,
// Saturday). Seven slides over a real Cornerstone photo: a title, five short points, and a closing slide with the contact.
// Written early, sent for the owner's approval like the posts, and published from 1pm Nairobi time once approved.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { Resvg } = require('@resvg/resvg-js');
const ROOT = path.join(__dirname, '..');
const A = path.join(__dirname, 'assets', 'cornerstone');
const FONTS = path.join(ROOT, 'assets', 'fonts');
const fontFiles = fs.readdirSync(FONTS).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONTS, f));
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const mime = (f) => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');
function wrap(text, n) { const out = []; let cur = ''; for (const w of String(text || '').split(/\s+/)) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; }

// light, useful and shareable topics; each becomes five short points
const TOPICS = ['5 signs a loved one may be struggling with alcohol', '5 myths about rehab, and the truth', '5 small daily habits that protect your mental health',
  '5 kind things to say to someone in recovery', '5 things never to say to someone in recovery', '5 facts about bhang and the teenage brain',
  '5 ways to get through a strong craving', '5 signs of burnout you should not ignore', '5 things that happen to your body when you stop drinking',
  '5 ways parents can talk to teenagers about drugs', '5 healthy ways to cope with stress', '5 things alcohol does to your sleep',
  '5 ways to support a family member after rehab', '5 signs that stress is turning into anxiety', '5 surprising facts about the brain in recovery',
  '5 questions to ask before choosing a rehab centre'];
// Cornerstone's own photos only (no stock, never the pool, never the tired man on a hopeful slide)
const PHOTOS = () => ['s_talk_session', 'f_kyumbi_garden', 'p_family', 'f_kithini_building', 's_nurse_desk', 'f_kyumbi_annex', 'p_man_hope', 's_team', 'f_kyumbi_garden2', 's_director_desk', 'f_kithini_side', 'f_kyumbi_lounge'].map((f) => path.join(A, f + '.jpg')).filter((f) => fs.existsSync(f));   // the ones that crop well in a tall frame

async function write(history, gemini, clean, facts) {
  const used = history.filter((h) => h.kind === 'REEL').map((h) => h.topic);
  const topic = TOPICS.find((t) => !used.includes(t)) || TOPICS[used.length % TOPICS.length];
  const ph = PHOTOS(); const seen = history.filter((h) => h.kind === 'REEL').map((h) => path.basename(h.photo || ''));
  const photo = ph.find((f) => !seen.includes(path.basename(f))) || ph[used.length % ph.length];
  const d = await gemini({ system: 'You write short social media video scripts for a rehabilitation centre in Kenya. You only use the facts given. Output only JSON.', user: `Facts about the client:\n${facts}\n\nWrite a Facebook Reel on: ${topic}.
It is light, warm and useful, the kind of thing people save and send to a friend. Accurate general knowledge only; no invented statistics, names, prices or claims of cure. No stigma words such as addict or junkie; say person living with addiction or person in recovery. English only. No dashes, no emojis, never the words "testament" or "whether". Never ask readers to comment, like, share or tag.
Return JSON: {"title":"the reel title in at most 8 words","points":[{"h":"point heading, 2 to 4 words","t":"one plain sentence, at most 14 words"} x5],"opening":"one or two warm opening sentences for the caption","help":"one sentence on how Cornerstone helps, using only the facts","question":"one natural, specific question to the reader (not asking them to comment, like or share)","hashtags":"5 to 7 hashtags including #CornerstoneRehab #Machakos"}` });
  const pts = (d.points || []).slice(0, 5).map((p) => ({ h: clean(p.h || ''), t: clean(p.t || '') })).filter((p) => p.h && p.t);
  if (pts.length < 5 || !d.title || !d.opening) throw new Error('weak reel draft');
  // the caption is built here so every point carries its sentence (owner, 27 Nov: a list of bare headings is too thin)
  const caption = [clean(d.title).toUpperCase(), clean(d.opening), pts.map((p, i) => `${i + 1}. ${p.h.toUpperCase()}\n${p.t}`).join('\n\n'), clean(d.help || ''), clean(d.question || ''), 'Call or WhatsApp 0720 825 938'].filter(Boolean).join('\n\n');
  return { kind: 'REEL', topic, title: clean(d.title), points: pts, caption, hashtags: String(d.hashtags || '').replace(/[^#\w\s]/g, '').trim(), photo };
}

// one 1080 x 1920 slide: the photo on top melting into deep teal, the logo, the words below
function slide(o, i, n) {
  const W = 1080, H = 1920; const p = [];
  p.push(`<defs><linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#062b2c" stop-opacity="0.25"/><stop offset="0.45" stop-color="#062b2c" stop-opacity="0.1"/><stop offset="0.8" stop-color="#062b2c" stop-opacity="0.85"/><stop offset="1" stop-color="#062b2c" stop-opacity="1"/></linearGradient></defs>`);
  p.push(`<rect width="${W}" height="${H}" fill="#062b2c"/><image href="data:${mime(o.photo)};base64,${b64(o.photo)}" x="0" y="0" width="${W}" height="1150" preserveAspectRatio="${/\/(s|p)_/.test(o.photo) ? 'xMidYMin' : 'xMidYMid'} slice"/><rect width="${W}" height="1151" fill="url(#sh)"/>`);
  p.push(`<rect x="60" y="90" width="300" height="84" rx="18" fill="#ffffff"/><image href="data:image/png;base64,${b64(path.join(A, 'logo.png'))}" x="70" y="96" width="280" height="72" preserveAspectRatio="xMidYMid meet"/>`);
  let y = 1130;
  const T = (t, size, col, weight, font) => `<text x="70" y="${y}" font-family="${font || 'Montserrat'}" font-weight="${weight || 800}" font-size="${size}" fill="${col}">${esc(t)}</text>`;
  if (i === 0) {
    p.push(`<rect x="70" y="${y - 70}" width="190" height="56" rx="28" fill="none" stroke="#f2c46d" stroke-width="2"/><text x="165" y="${y - 32}" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="24" letter-spacing="4" fill="#f4dfb0">WATCH</text>`); y += 90;
    for (const l of wrap(o.title.toUpperCase(), 16).slice(0, 4)) { p.push(T(l, 88, '#ffffff', 900)); y += 100; }
    y += 10; p.push(`<rect x="70" y="${y}" width="150" height="7" rx="3" fill="#f2c46d"/>`);
  } else if (i <= 5) {
    const pt = o.points[i - 1];
    p.push(`<circle cx="140" cy="${y - 10}" r="70" fill="#f2c46d"/><text x="140" y="${y + 18}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="80" fill="#062b2c">${i}</text>`); y += 150;
    for (const l of wrap(pt.h.toUpperCase(), 18).slice(0, 2)) { p.push(T(l, 76, '#f2c46d', 900)); y += 88; }
    y += 20; for (const l of wrap(pt.t, 30).slice(0, 4)) { p.push(T(l, 50, '#ffffff', 500, 'Poppins')); y += 66; }
  } else {
    y += 40; for (const l of ['YOU DO NOT', 'HAVE TO WALK', 'ALONE']) { p.push(T(l, 86, l === 'ALONE' ? '#f2c46d' : '#ffffff', 900)); y += 98; }
    y += 30; p.push(T('Call or WhatsApp', 40, '#cfe3dd', 500, 'Poppins')); y += 80; p.push(T('0720 825 938', 74, '#ffffff', 900)); y += 70;
    p.push(T('cornerstonerehabcenter.co.ke', 38, '#cfe3dd', 500, 'Poppins')); y += 70;
    p.push(T('Kithini Market  |  Kyumbi Junction, Mombasa Road', 30, '#9fc4ba', 500, 'Poppins'));
  }
  for (let k = 0; k < n; k++) p.push(`<rect x="${70 + k * 62}" y="${H - 110}" width="50" height="8" rx="4" fill="${k === i ? '#f2c46d' : '#ffffff'}" fill-opacity="${k === i ? 1 : 0.35}"/>`);
  p.push(`<text x="${W - 70}" y="${H - 96}" text-anchor="end" font-family="Montserrat" font-weight="700" font-size="28" fill="#ffffff">Mind, Body and Spirit</text>`);
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${p.join('')}</svg>`, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Poppins' }, fitTo: { mode: 'width', value: W } }).render().asPng();
}

// the slides, a cover image, and the video (gentle zoom on each slide, soft fades between them, silent sound track)
function render(o, dir, id) {
  fs.mkdirSync(dir, { recursive: true }); const n = 7; const files = [];
  for (let i = 0; i < n; i++) { const f = path.join(dir, `${id}_${i}.png`); fs.writeFileSync(f, slide(o, i, n)); files.push(f); }
  let ff = 'ffmpeg'; try { ff = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
  const dur = files.map((_, i) => (i === 0 ? 3 : i === n - 1 ? 4 : 3.8)); const fade = 0.5; const fps = 30;
  const args = ['-y', '-loglevel', 'error']; files.forEach((f, i) => args.push('-loop', '1', '-t', String(dur[i]), '-i', f));
  const total = dur.reduce((a, b) => a + b, 0) - fade * (n - 1);
  args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo');
  let fc = files.map((_, i) => `[${i}:v]scale=1296:2304,zoompan=z='min(1+0.0006*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(dur[i] * fps)}:s=1080x1920:fps=${fps},setsar=1,format=yuv420p[s${i}]`).join(';');
  let prev = 's0', off = 0;
  for (let i = 1; i < n; i++) { off += dur[i - 1] - fade; fc += `;[${prev}][s${i}]xfade=transition=fade:duration=${fade}:offset=${off.toFixed(2)}[x${i}]`; prev = 'x' + i; }
  const mp4 = path.join(dir, id + '.mp4');
  args.push('-filter_complex', fc, '-map', `[${prev}]`, '-map', `${n}:a`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', String(fps), '-c:a', 'aac', '-b:a', '64k', '-t', String(total), '-movflags', '+faststart', mp4);
  cp.execFileSync(ff, args, { timeout: 300000 });
  const cover = path.join(dir, id + '.png'); fs.copyFileSync(files[0], cover); files.forEach((f) => fs.unlinkSync(f));
  return { mp4, cover };
}
module.exports = { write, render, slide, TOPICS };
