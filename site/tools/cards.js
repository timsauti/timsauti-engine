// Draws each story's artwork: a card image for the site (cards/<slug>.png) and a share image with the headline (og/<slug>.png),
// plus the site icon and default share image. Only draws what is missing unless FORCE=1.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), IMG = path.join(ROOT, 'static', 'img');
const LABEL = { tech: 'TECH', money: 'MONEY AND M-PESA', scams: 'SCAM ALERT', hustles: 'HUSTLES AND JOBS', howto: 'HOW TO', community: 'COMMUNITY' };
const ACC = { tech: '#19a7ff', money: '#f4b631', scams: '#ef4b5a', hustles: '#14c784', howto: '#a78bfa', community: '#2fe6a7' };
const read = (d, extra) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => Object.assign(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), extra || {})) : [];
const stories = read(path.join(ROOT, 'content', 'stories')).concat(read(path.join(ROOT, 'content', 'community'), { community: true }));
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0); };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function motif(cat, seed) {
  const r = (n) => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) % n);
  const a = ACC[cat];
  if (cat === 'money') { let s = ''; for (let i = 0; i < 4; i++) { const x = 760 + i * 70 + r(30), base = 520; for (let k = 0; k < 3 + i + r(3); k++) s += `<ellipse cx="${x}" cy="${base - k * 26}" rx="62" ry="20" fill="#c98a12"/><ellipse cx="${x}" cy="${base - k * 26 - 6}" rx="62" ry="20" fill="url(#gold)" stroke="#a8700c" stroke-width="2"/>`; } return s + `<circle cx="${980 + r(60)}" cy="${150 + r(40)}" r="95" fill="url(#gold)"/>`; }
  if (cat === 'scams') { let s = ''; for (let i = 1; i <= 5; i++) s += `<circle cx="950" cy="315" r="${i * 70}" fill="none" stroke="${a}" stroke-opacity="${0.5 - i * 0.08}" stroke-width="3"/>`; s += `<path d="M950 315 L${950 + 330} ${200 + r(60)} A340 340 0 0 0 ${950 + 300} ${80 + r(40)} Z" fill="${a}" opacity=".22"/>`; for (let i = 0; i < 6; i++) s += `<circle cx="${780 + r(340)}" cy="${120 + r(380)}" r="${6 + r(6)}" fill="${a}"/>`; return s + `<path d="M950 230 L1030 380 L870 380 Z" fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round"/><rect x="944" y="275" width="12" height="60" rx="6" fill="#fff"/><circle cx="950" cy="355" r="7" fill="#fff"/>`; }
  if (cat === 'howto') { let s = ''; for (let i = 0; i < 3; i++) { const y = 150 + i * 150; s += `<circle cx="800" cy="${y}" r="52" fill="url(#g)"/><text x="800" y="${y + 20}" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="56" fill="#04121f">${i + 1}</text><rect x="875" y="${y - 22}" width="${200 + r(120)}" height="18" rx="9" fill="#fff" opacity=".85"/><rect x="875" y="${y + 8}" width="${140 + r(100)}" height="14" rx="7" fill="#fff" opacity=".35"/>`; if (i < 2) s += `<line x1="800" y1="${y + 55}" x2="800" y2="${y + 95}" stroke="${a}" stroke-width="6" stroke-dasharray="6 8"/>`; } return s; }
  if (cat === 'hustles') { let s = ''; for (let i = 0; i < 6; i++) { const h = 80 + i * 55 + r(40); s += `<rect x="${720 + i * 75}" y="${540 - h}" width="52" height="${h}" rx="10" fill="url(#g)" opacity="${0.55 + i * 0.08}"/>`; } return s + `<polyline points="720,430 800,380 880,400 960,300 1040,260 1130,150" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="1130" cy="150" r="14" fill="#fff"/>`; }
  if (cat === 'community') { return `<rect x="760" y="130" width="300" height="170" rx="40" fill="url(#g)"/><path d="M820 300 L800 360 L870 300 Z" fill="#2fe6a7"/><rect x="900" y="300" width="260" height="150" rx="36" fill="#fff" opacity=".92"/><path d="M1100 450 L1130 500 L1060 450 Z" fill="#fff" opacity=".92"/><circle cx="850" cy="215" r="14" fill="#04121f"/><circle cx="910" cy="215" r="14" fill="#04121f"/><circle cx="970" cy="215" r="14" fill="#04121f"/>`; }
  // tech: circuit board
  let s = ''; for (let i = 0; i < 9; i++) { const y = 80 + i * 55 + r(20), x = 700 + r(120); s += `<polyline points="${x},${y} ${x + 120 + r(80)},${y} ${x + 170 + r(80)},${y + (r(2) ? 40 : -40)} 1250,${y + (r(2) ? 40 : -40)}" fill="none" stroke="${a}" stroke-opacity=".55" stroke-width="4"/><circle cx="${x}" cy="${y}" r="8" fill="${a}"/>`; }
  return s + `<rect x="840" y="200" width="230" height="230" rx="34" fill="#0a1b33" stroke="url(#g)" stroke-width="10"/><polyline points="870,315 930,315 950,280 975,350 1000,300 1015,315 1040,315" fill="none" stroke="url(#g)" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>`;
}
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fe6a7"/><stop offset="1" stop-color="#19a7ff"/></linearGradient><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".5" stop-color="#f4b631"/><stop offset="1" stop-color="#c98a12"/></linearGradient><radialGradient id="bg" cx="25%" cy="20%" r="90%"><stop offset="0" stop-color="#14345f"/><stop offset="1" stop-color="#050d1a"/></radialGradient><pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" opacity=".06"/></pattern></defs>`;
const FD = path.join(ROOT, 'node_modules', '@fontsource');
const FONTS = `@font-face{font-family:'Space Grotesk';font-weight:700;src:url(file://${FD}/space-grotesk/files/space-grotesk-latin-700-normal.woff2)}@font-face{font-family:Inter;font-weight:600;src:url(file://${FD}/inter/files/inter-latin-600-normal.woff2)}@font-face{font-family:Inter;font-weight:700;src:url(file://${FD}/inter/files/inter-latin-700-normal.woff2)}`;
const page = (inner) => `<html><head><style>${FONTS}body{margin:0}#c{width:1200px;height:630px;position:relative;overflow:hidden;font-family:Inter}</style></head><body><div id="c">${inner}</div></body></html>`;

function cardHtml(s) {
  const cat = s.community ? 'community' : s.cat, seed = hash(s.slug);
  const photo = s.photo ? `<img src="file://${path.join(ROOT, 'static', s.photo)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : '';
  if (photo) return page(photo + `<div style="position:absolute;left:28px;top:28px;background:#07142a;color:${ACC[cat]};font:700 22px Inter;letter-spacing:2px;padding:10px 18px;border-radius:999px">${LABEL[cat]}</div>`);
  const st = s.stat || (s.community ? String(s.author || 'A reader').slice(0, 22) : 'Explained'), fs2 = st.length > 14 ? 84 : st.length > 7 ? 110 : 150;
  if (s.community && !s.statLabel) s = Object.assign({}, s, { statLabel: "Readers' Desk" + (s.county ? ', ' + s.county : '') });
  return page(`<svg width="1200" height="630" viewBox="0 0 1200 630" style="position:absolute;inset:0">${defs}<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#dots)"/><g opacity=".9">${motif(cat, seed)}</g></svg>
<div style="position:absolute;left:70px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:6px;max-width:640px"><div style="color:${ACC[cat]};font:700 ${fs2}px 'Space Grotesk';line-height:1;letter-spacing:-2px;text-shadow:0 6px 30px rgba(0,0,0,.4)">${esc(st)}</div><div style="color:#dfe9f7;font:600 38px Inter;line-height:1.2">${esc(s.statLabel || '')}</div></div>`);
}
function ogHtml(s) {
  const cat = s.community ? 'community' : s.cat, seed = hash(s.slug);
  const bg = s.photo ? `<img src="file://${path.join(ROOT, 'static', s.photo)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,13,26,.95) 0,rgba(5,13,26,.75) 55%,rgba(5,13,26,.2))"></div>`
    : `<svg width="1200" height="630" viewBox="0 0 1200 630" style="position:absolute;inset:0">${defs}<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#dots)"/><g opacity=".45">${motif(cat, seed)}</g></svg>`;
  const size = s.title.length > 70 ? 54 : s.title.length > 50 ? 62 : 70;
  return page(bg + `<div style="position:absolute;left:64px;right:64px;top:56px;bottom:56px;display:flex;flex-direction:column;gap:22px"><div style="color:${ACC[cat]};font:700 24px Inter;letter-spacing:4px">${LABEL[cat]}</div><div style="color:#fff;font:700 ${size}px 'Space Grotesk';line-height:1.05;max-width:900px">${esc(s.title)}</div>
<div style="margin-top:auto;display:flex;align-items:center;gap:16px"><img src="file://${path.join(IMG, 'logo.png')}" style="width:64px;height:64px;border-radius:14px"><div style="font:700 30px 'Space Grotesk';color:#fff">TECH <span style="color:#2fe6a7;font-size:22px">na</span> <span style="color:#f4b631">PESA</span></div>${s.author ? `<div style="margin-left:auto;color:#cfe3ff;font:600 22px Inter">By ${esc(s.author)}</div>` : ''}</div></div>`);
}

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const TMP = path.join(ROOT, '.cards.html'); const shot = async (html, file) => { fs.writeFileSync(TMP, html); await p.goto('file://' + TMP, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150); fs.mkdirSync(path.dirname(file), { recursive: true }); await (await p.$('#c')).screenshot({ path: file }); };
  let n = 0;
  for (const s of stories) {
    const cf = path.join(IMG, 'cards', s.slug + '.png'), of = path.join(IMG, 'og', s.slug + '.png');
    if (process.env.FORCE || !fs.existsSync(cf)) { await shot(cardHtml(s), cf); n++; }
    if (process.env.FORCE || !fs.existsSync(of)) { await shot(ogHtml(s), of); n++; }
  }
  if (process.env.FORCE || !fs.existsSync(path.join(IMG, 'og.png'))) await shot(ogHtml({ slug: 'home', cat: 'money', title: 'Your phone, your money, your Kenya. Made simple.' }), path.join(IMG, 'og.png'));
  try { fs.unlinkSync(TMP); } catch (e) {}
  await b.close(); console.log('drew ' + n + ' images');
})();
