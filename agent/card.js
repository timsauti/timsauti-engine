// Quote card renderer: turns a short line of text into a 1080x1350 PNG (Facebook's best portrait size).
// Uses the bundled open-licence fonts (Lora, Poppins), so cards look the same on every computer.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Resvg } = require('@resvg/resvg-js');
const FONTS = path.join(__dirname, '..', 'assets', 'fonts');
const fontFiles = fs.readdirSync(FONTS).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONTS, f));
const FONT_OPTS = { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Lora' };
const W = 1080, H = 1350;

// Deep, calm backgrounds with a gold accent; one is picked per card so the feed does not look repetitive.
const PALETTES = [
  { a: '#0b1d3a', b: '#123d63', accent: '#d4a64a', text: '#ffffff' },   // navy
  { a: '#0c3b3a', b: '#14635e', accent: '#e0b65a', text: '#ffffff' },   // teal
  { a: '#2a0f2e', b: '#5a1f4f', accent: '#e3b15b', text: '#ffffff' },   // plum
  { a: '#1b1b1b', b: '#3a2f22', accent: '#d9a441', text: '#fdf7ec' },   // charcoal and bronze
  { a: '#3b1d0c', b: '#7a3b12', accent: '#f1c26b', text: '#fffaf0' },   // earth, warm for culture
  { a: '#06302e', b: '#0d5c56', accent: '#d9ad4f', text: '#ffffff' }    // Timsauti teal and gold
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textWidth(str, size, family, weight, style) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="200" font-family="${family}" font-size="${size}" font-weight="${weight || 400}" font-style="${style || 'normal'}">${esc(str)}</text></svg>`;
  const bb = new Resvg(svg, { font: FONT_OPTS }).getBBox();
  return bb ? bb.width : str.length * size * 0.5;
}
function wrap(text, size, maxW, family, weight, style) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || textWidth(t, size, family, weight, style) <= maxW) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Largest font size (from 86 down to 40) at which the text fits the box
function fit(text, maxW, maxH, family, weight, style) {
  for (let size = 86; size >= 40; size -= 4) {
    const lines = wrap(text, size, maxW, family, weight, style); const lh = size * 1.32;
    if (lines.length * lh <= maxH) return { size, lines, lh };
  }
  const size = 40; const lines = wrap(text, size, maxW, family, weight, style); return { size, lines: lines.slice(0, Math.floor(maxH / (size * 1.32))), lh: size * 1.32 };
}

// spec: { text, reference?, kind: 'motivation'|'faith'|'culture', name, handle, seed?, avatar? (file path), bg? (photo file), style? ('timsauti') }
function renderCard(spec) {
  if (spec.reference) {
    const r = String(spec.reference).trim().replace(/^(.*?\D)\s*(\d+)\s+(\d+(?:\s*[-,]\s*\d+)?)$/, '$1 $2:$3').replace(/\s+/g, ' ');
    const esc2 = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:/g, '[: ]?\\s*');
    spec = Object.assign({}, spec, { reference: r, text: String(spec.text || '').replace(new RegExp('[\\s,.;:(\\-]*' + esc2 + '[)\\s.]*$', 'i'), '').trim() });
  }
  if (spec.layout && LAYOUTS[spec.layout]) return LAYOUTS[spec.layout](spec);
  const seed = crypto.createHash('md5').update(String(spec.seed || spec.text)).digest()[0];
  const p = spec.style === 'timsauti' ? PALETTES[5] : spec.kind === 'culture' ? PALETTES[4] : PALETTES[seed % 4];
  const bgFile = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
  const isTitle = spec.kind === 'culture';
  const family = 'Lora', style = isTitle ? 'normal' : 'italic', weight = isTitle ? 700 : 500;
  const boxW = 860, boxTop = 300, boxH = spec.reference ? 590 : 700;
  const f = fit(isTitle ? String(spec.text).toUpperCase() : spec.text, boxW, boxH, family, weight, style);
  const blockH = f.lines.length * f.lh; const startY = boxTop + (boxH - blockH) / 2 + f.size * 0.9;
  const lines = f.lines.map((l, i) => `<text x="${W / 2}" y="${(startY + i * f.lh).toFixed(1)}" text-anchor="middle" font-family="${family}" font-size="${f.size}" font-weight="${weight}" font-style="${style}" fill="${p.text}">${esc(l)}</text>`).join('');
  const refY = Math.min(startY + (f.lines.length - 1) * f.lh + f.size * 0.6 + 60, 985);
  const ref = spec.reference ? `<text x="${W / 2}" y="${refY.toFixed(1)}" text-anchor="middle" font-family="Poppins" font-size="36" font-weight="500" fill="${p.accent}">${esc(spec.reference)}</text>` : '';
  const label = isTitle ? `<text x="${W / 2}" y="250" text-anchor="middle" font-family="Poppins" font-size="30" font-weight="500" letter-spacing="6" fill="${p.accent}">AS WRITTEN BY ${esc(String(spec.name || '').toUpperCase())}</text>` : `<text x="${W / 2}" y="270" text-anchor="middle" font-family="Lora" font-size="220" font-weight="700" fill="${p.accent}" fill-opacity="0.9">“</text>`;
  let avatar = '';
  if (spec.avatar && fs.existsSync(spec.avatar)) {
    const ext = path.extname(spec.avatar).toLowerCase() === '.png' ? 'png' : 'jpeg';
    const b64 = fs.readFileSync(spec.avatar).toString('base64');
    avatar = `<clipPath id="av"><circle cx="${W / 2}" cy="1135" r="62"/></clipPath><circle cx="${W / 2}" cy="1135" r="66" fill="${p.accent}"/><image href="data:image/${ext};base64,${b64}" x="${W / 2 - 62}" y="1073" width="124" height="124" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>`;
  }
  const nameY = avatar ? 1245 : 1180;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
${bgFile ? `${spec.focus ? focusTag(bgFile, 0, 0, W, H, spec.focus) : imgTag(bgFile, 0, 0, W, H)}<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.5" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient><rect width="${W}" height="${H}" fill="url(#shade)"/>` : `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`}
<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${p.accent}" stroke-opacity="0.55" stroke-width="3"/>
${label}${lines}${ref}
<line x1="${W / 2 - 90}" y1="1060" x2="${W / 2 + 90}" y2="1060" stroke="${p.accent}" stroke-width="3"/>
${avatar}
<text x="${W / 2}" y="${nameY}" text-anchor="middle" font-family="Poppins" font-size="40" font-weight="700" fill="${p.text}">${esc(spec.name || '')}</text>
<text x="${W / 2}" y="${nameY + 50}" text-anchor="middle" font-family="Poppins" font-size="28" font-weight="400" fill="${p.accent}">${esc(spec.handle || '')}</text>
</svg>`;
  const png = new Resvg(svg, { font: FONT_OPTS, fitTo: { mode: 'width', value: W } }).render().asPng();
  return png;
}

// ---------- extra designs, so the Page does not look the same every day ----------
const imgTag = (file, x, y, w, h, align) => `<image href="data:image/${/\.png$/i.test(file) ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${align || 'xMidYMid'} slice"/>`;
// Place a photo in an area WITHOUT EVER cutting off the top of his head.
// Rule: his face sits 40% down the frame, so there is always room above his head. A photo wider than the area
// is shown whole, with a soft blurred copy of itself filling the space above and below.
function focusTag(file, x, y, w, h, focus) {
  const mime = /\.png$/i.test(file) ? 'png' : 'jpeg', data = `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  const id = 'f' + Math.round(Math.random() * 1e6);
  const clip = `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;
  if (!focus || !focus.w) return clip + `<image clip-path="url(#${id})" href="${data}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMin slice"/>`;
  const r = focus.w / focus.h;
  if (r <= w / h) {   // taller than the area: full width, trimmed top and bottom around his face
    // the face centre sits 40% down the frame, which leaves clear room above the head even in close selfies;
    // the crop can never start above the top of the photo, and never runs past its bottom
    const sh = w / r, oy = Math.min(0, Math.max(h - sh, h * 0.40 - focus.fy * sh));
    return clip + `<image clip-path="url(#${id})" href="${data}" x="${x}" y="${(y + oy).toFixed(1)}" width="${w}" height="${sh.toFixed(1)}"/>`;
  }
  // wider than the area: whole photo, blurred fill behind it
  const sh = w / r, top = y + (h - sh) / 2;
  return clip + `<filter id="${id}b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="40"/></filter>`
    + `<g clip-path="url(#${id})"><image href="${data}" x="${x - 60}" y="${y - 60}" width="${w + 120}" height="${h + 120}" preserveAspectRatio="xMidYMid slice" filter="url(#${id}b)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" fill-opacity="0.25"/>`
    + `<image href="${data}" x="${x}" y="${top.toFixed(1)}" width="${w}" height="${sh.toFixed(1)}"/></g>`;
}
const toPng = (svg) => new Resvg(svg, { font: FONT_OPTS, fitTo: { mode: 'width', value: W } }).render().asPng();
const paletteFor = (spec) => { const seed = crypto.createHash('md5').update(String(spec.seed || spec.text)).digest()[0]; return spec.style === 'timsauti' ? PALETTES[5] : PALETTES[seed % 4]; };
function textBlock(lines, x, y0, lh, anchor, attrs) { return lines.map((l, i) => `<text x="${x}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="${anchor}" ${attrs}>${esc(l)}</text>`).join(''); }
function fitRange(text, maxW, maxH, family, weight, style, big, small) {
  for (let size = big; size >= small; size -= 4) { const lines = wrap(text, size, maxW, family, weight, style); const lh = size * 1.25; if (lines.length * lh <= maxH && lines.every((l) => textWidth(l, size, family, weight, style) <= maxW)) return { size, lines, lh }; }
  const lines = wrap(text, small, maxW, family, weight, style); return { size: small, lines: lines.slice(0, Math.floor(maxH / (small * 1.25))), lh: small * 1.25 };
}
// ---------- Timsauti service poster (agency style): headline, tagline bar, offer box, photo, contact strip ----------
function poster(spec) {
  const P = spec.poster || {}; const teal = '#0b4f4a', deep = '#06302e', gold = '#d9ad4f', ink = '#0f1f2e';
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
  const head = String(P.headline || spec.text || '').toUpperCase().slice(0, 60);
  const hf = fitRange(head, bg ? 350 : 900, 340, 'Poppins', 700, 'normal', bg ? 80 : 96, 44);
  const hl = String(P.highlight || '').toUpperCase().trim();
  const headLines = hf.lines.map((l, i) => {
    const y = (260 + hf.size * 0.9 + i * hf.lh).toFixed(1);
    if (hl && l.includes(hl)) { const [a, b] = [l.slice(0, l.indexOf(hl)), l.slice(l.indexOf(hl) + hl.length)]; return `<text x="70" y="${y}" font-family="Poppins" font-size="${hf.size}" font-weight="700" fill="${ink}">${esc(a)}<tspan fill="${teal}">${esc(hl)}</tspan>${esc(b)}</text>`; }
    return `<text x="70" y="${y}" font-family="Poppins" font-size="${hf.size}" font-weight="700" fill="${i === hf.lines.length - 1 ? teal : ink}">${esc(l)}</text>`;
  }).join('');
  const headBottom = 260 + hf.lines.length * hf.lh + 20;
  const sub = String(P.subtitle || '').slice(0, 60); const sf = fitRange(sub, bg ? 570 : 860, 90, 'Poppins', 700, 'normal', 40, 26);
  const subY = headBottom + 10; const subW = Math.min((bg ? 620 : 900), Math.max(...sf.lines.map((l) => textWidth(l, sf.size, 'Poppins', 700, 'normal'))) + 44);
  const subBar = sub ? `<rect x="60" y="${subY}" width="${subW.toFixed(0)}" height="${(sf.lines.length * sf.lh + 24).toFixed(0)}" fill="${gold}"/>${textBlock(sf.lines, 80, subY + 12 + sf.size * 0.95, sf.lh, 'start', `font-family="Poppins" font-size="${sf.size}" font-weight="700" fill="${ink}"`)}` : '';
  const pts = (P.points || []).map((x) => String(x).slice(0, 34)).filter(Boolean).slice(0, 4); let ps = 36; while (ps > 24 && pts.some((t) => textWidth(t, ps, 'Poppins', 500) > (bg ? 600 : 940) - 120)) ps -= 2;
  const boxY = Math.max(subY + (sub ? sf.lines.length * sf.lh + 60 : 30), 700); const boxW = bg ? 600 : 940; const rowH = 74; const boxH = 110 + pts.length * rowH;
  const box = pts.length ? `<rect x="60" y="${boxY}" width="${boxW}" height="${boxH}" rx="22" fill="${deep}"/><rect x="90" y="${boxY - 28}" width="${Math.min(boxW - 60, textWidth(String(P.boxTitle || 'What we offer'), 38, 'Poppins', 700) + 60).toFixed(0)}" height="62" rx="10" fill="${teal}" stroke="${gold}" stroke-width="3"/><text x="120" y="${boxY + 14}" font-family="Poppins" font-size="38" font-weight="700" fill="#ffffff">${esc(P.boxTitle || 'What we offer')}</text>` +
    pts.map((t, i) => { const y = boxY + 90 + i * rowH; return `<circle cx="112" cy="${y}" r="20" fill="${gold}"/><path d="M102 ${y} l7 8 l14 -16" stroke="${deep}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="148" y="${y + 13}" font-family="Poppins" font-size="${ps}" font-weight="500" fill="#ffffff">${esc(t)}</text>`; }).join('') : '';
  const photo = bg ? `<clipPath id="ph"><path d="M640 120 h380 a40 40 0 0 1 40 40 v900 h-420 a200 200 0 0 1 -200 -200 v-540 a200 200 0 0 1 200 -200 z"/></clipPath>${imgTag(bg, 440, 120, 620, 940).replace('<image ', '<image clip-path="url(#ph)" ')}<path d="M640 120 h380 a40 40 0 0 1 40 40 v900 h-420 a200 200 0 0 1 -200 -200 v-540 a200 200 0 0 1 200 -200 z" fill="none" stroke="${gold}" stroke-width="6"/>` : '';
  const badgeTxt = (() => { let t = ''; for (const w of String(P.badge || '').toUpperCase().split(/\s+/).filter(Boolean)) { if ((t + ' ' + w).trim().length > 28) break; t = (t + ' ' + w).trim(); } return t; })(); let bs = 32; while (bs > 18 && badgeTxt.split(' ').some((w) => textWidth(w, bs, 'Poppins', 700) > 168)) bs -= 2; const bw = wrap(badgeTxt, bs, 168, 'Poppins', 700);
  const badge = badgeTxt ? `<g transform="translate(930 ${bg ? 1000 : 260})"><circle r="112" fill="#b3202a"/><circle r="100" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="6 6"/>${bw.slice(0, 3).map((l, i, a) => `<text x="0" y="${(i - (a.length - 1) / 2) * (bs + 6) + bs * 0.36}" text-anchor="middle" font-family="Poppins" font-size="${bs}" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('')}</g>` : '';
  const phone = esc(P.phone || '0728 245 824'), web = esc(P.web || '');
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8f3f1"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#pg)"/>
<path d="M0 ${H - 260} C 300 ${H - 360}, 700 ${H - 160}, ${W} ${H - 300} L ${W} ${H} L 0 ${H} Z" fill="${teal}" fill-opacity="0.10"/>
<circle cx="${W - 40}" cy="40" r="180" fill="${gold}" fill-opacity="0.12"/><circle cx="40" cy="${H - 300}" r="90" fill="${teal}" fill-opacity="0.08"/>
${logoMark(teal, gold)}
${photo}${headLines}${subBar}${box}${badge}
<rect x="0" y="${H - 130}" width="${W}" height="130" fill="${deep}"/><rect x="0" y="${H - 136}" width="${W}" height="8" fill="${gold}"/>
<circle cx="90" cy="${H - 65}" r="30" fill="${gold}"/><path d="M78 ${H - 80} c2 12 10 22 22 28 l6 -6 c2 -2 5 -2 7 0 l6 5 c2 2 2 5 0 7 l-5 5 c-20 -2 -40 -22 -42 -42 l5 -5 c2 -2 5 -2 7 0 l5 6 c2 2 2 5 0 7 z" fill="${deep}"/>
<text x="135" y="${H - 52}" font-family="Poppins" font-size="40" font-weight="700" fill="#ffffff">${phone}</text>
<circle cx="${W - 360}" cy="${H - 65}" r="30" fill="${gold}"/><circle cx="${W - 360}" cy="${H - 65}" r="16" fill="none" stroke="${deep}" stroke-width="4"/><path d="M${W - 376} ${H - 65} h32 M${W - 360} ${H - 81} c-8 10 -8 22 0 32 c8 -10 8 -22 0 -32" stroke="${deep}" stroke-width="3" fill="none"/>
<text x="${W - 315}" y="${H - 52}" font-family="Poppins" font-size="38" font-weight="700" fill="#ffffff">${web}</text></svg>`);
}

// ---------- Timsauti promo poster (owner's reference design): white page, red and navy condensed headline, faded photo, offer card, call bar ----------
function promo(spec) {
  const P = spec.poster || {}; const navy = '#13266b', red = '#d71920', gold = '#c9971c', grey = '#2b2f3a';
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
  const AN = 'Anton', BC = 'Barlow Condensed';
  const head = String(P.headline || spec.text || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 48);
  const isCut = bg && /\.png$/i.test(bg) && P.cutout !== false;
  const hw = isCut ? 490 : bg ? 560 : 960;
  const hf = fitRange(head, hw, 360, AN, 400, 'normal', 132, 64);
  const hl = String(P.highlight || '').toUpperCase().trim();
  let redFrom = hf.lines.length > 1 ? hf.lines.length - 1 : 0;
  if (hl) { const k = hf.lines.findIndex((l) => l.includes(hl)); if (k >= 0) redFrom = k; }
  let y = 210 + hf.size * 0.95;
  const headSvg = hf.lines.map((l, i) => { const t = `<text x="52" y="${y.toFixed(0)}" font-family="${AN}" font-size="${hf.size}" fill="${i >= redFrom && hf.lines.length > 1 ? red : (hf.lines.length === 1 ? red : navy)}">${esc(l)}</text>`; y += hf.size * 1.02; return t; }).join('');
  y = y - hf.size * 1.02 + 40;
  const rule = `<rect x="56" y="${y.toFixed(0)}" width="110" height="7" rx="3" fill="${red}"/>`; y += 30;
  const sub = String(P.subtitle || '').slice(0, 80); const sf = fitRange(sub, hw, 110, BC, 500, 'normal', 46, 32);
  const subSvg = sub ? textBlock(sf.lines, 52, y + sf.size * 0.85, sf.lh, 'start', `font-family="${BC}" font-size="${sf.size}" font-weight="500" fill="${grey}"`) : '';
  y += sub ? sf.lines.length * sf.lh : 0;
  const pts = (P.points || []).map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 4);
  const cardW = W - 80; const rowsN0 = Math.ceil(pts.length / 2); const cardH = 130 + rowsN0 * 105; const cardY = Math.max(y + 40, H - 190 - cardH);
  const title = String(P.boxTitle || 'What we offer').toUpperCase().slice(0, 30);
  const colW = (cardW - 80) / 2; let ps = 40; while (ps > 28 && pts.some((t) => textWidth(t, ps, BC, 600) > colW - 90)) ps -= 2;
  const rowsN = Math.ceil(pts.length / 2); const rowGap = 105;
  const ptsSvg = pts.map((t, i) => { const cx = 40 + 70 + (i % 2) * (colW + 20); const cy = cardY + 140 + Math.floor(i / 2) * rowGap; const lines = wrap(t, ps, colW - 90, BC, 600).slice(0, 2); return `<circle cx="${cx}" cy="${cy}" r="26" fill="${red}"/><path d="M${cx - 12} ${cy} l8 9 l16 -18" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` + lines.map((l, k) => `<text x="${cx + 46}" y="${(cy + ps * 0.35 + (k - (lines.length - 1) / 2) * ps * 1.05).toFixed(0)}" font-family="${BC}" font-size="${ps}" font-weight="600" fill="${navy}">${esc(l)}</text>`).join(''); }).join('');
  const card = pts.length ? `<g filter="url(#sh)"><rect x="40" y="${cardY}" width="${cardW}" height="${cardH}" rx="26" fill="#ffffff"/></g><path d="M40 ${cardY + 26} a26 26 0 0 1 26 -26 h${cardW - 52} a26 26 0 0 1 26 26 v56 h-${cardW} z" fill="${navy}"/><text x="${W / 2}" y="${cardY + 58}" text-anchor="middle" font-family="${AN}" font-size="44" fill="#ffffff" letter-spacing="1">${esc(title)}</text><rect x="${W / 2 - 60}" y="${cardY + 82}" width="120" height="5" fill="${gold}"/>${ptsSvg}` : '';
  const cut = bg && /\.png$/i.test(bg) && P.cutout !== false;   // a person cut out with no background: stand them on the page, no fading
  const photo = cut ? `<circle cx="830" cy="420" r="330" fill="${navy}" fill-opacity="0.07"/><circle cx="980" cy="200" r="140" fill="${red}" fill-opacity="0.08"/>` + `<image href="data:image/png;base64,${fs.readFileSync(bg).toString('base64')}" x="550" y="${Math.max(150, cardY - 640 + 40)}" width="530" height="640" preserveAspectRatio="xMidYMax meet"/>` : bg ? `<defs><linearGradient id="fx" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.35" stop-color="#fff" stop-opacity="1"/></linearGradient><linearGradient id="fy" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="mx"><rect x="500" y="0" width="580" height="820" fill="url(#fx)"/></mask><mask id="my"><rect x="500" y="0" width="580" height="820" fill="url(#fy)"/></mask></defs><g mask="url(#my)"><g mask="url(#mx)">${imgTag(bg, 500, 0, 580, 820)}</g></g>` : `<circle cx="${W - 60}" cy="80" r="260" fill="${navy}" fill-opacity="0.06"/><circle cx="${W - 20}" cy="420" r="160" fill="${red}" fill-opacity="0.06"/>`;
  const phones = esc(P.phones || '0733 566 667  |  0728 245 824');
  const cta = esc(P.cta || 'Get Started Today');
  const barY = H - 150;
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#13266b" flood-opacity="0.18"/></filter><linearGradient id="pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f8"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#pb)"/>
${photo}
${logoMark(navy, red).replace('x="55" y="40" width="340" height="172"', 'x="48" y="28" width="300" height="150"')}
${headSvg}${rule}${subSvg}${card}
<rect x="30" y="${barY}" width="${W - 60}" height="104" rx="22" fill="${navy}"/><path d="M52 ${barY} h350 l-40 104 h-310 a22 22 0 0 1 -22 -22 v-60 a22 22 0 0 1 22 -22 z" fill="${red}"/>
<text x="58" y="${barY + 68}" font-family="${BC}" font-size="46" font-weight="700" fill="#ffffff">${cta}</text>
<circle cx="440" cy="${barY + 52}" r="30" fill="#ffffff"/><path d="M428 ${barY + 36} c2 12 10 22 22 28 l6 -6 c2 -2 5 -2 7 0 l6 5 c2 2 2 5 0 7 l-5 5 c-20 -2 -40 -22 -42 -42 l5 -5 c2 -2 5 -2 7 0 l5 6 c2 2 2 5 0 7 z" fill="${navy}"/>
<text x="486" y="${barY + 68}" font-family="${BC}" font-size="47" font-weight="700" fill="#ffffff">${phones}</text>
</svg>`);
}


// ---------- Timsauti clean poster (owner's template): white page, flat logo, small kicker, big red headline, navy line, person standing at the right ----------
function clean(spec) {
  const P = spec.poster || {}; const navy = '#13266b', red = '#e3141b', grey = '#3a3f4b';
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
  const PO = 'Poppins';
  const words = String(P.headline || spec.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let kicker = P.kicker, main = P.main, rest = P.rest;
  if (!main) {
    const hl = String(P.highlight || '').trim(); const H = words.join(' ');
    const k = hl ? H.toLowerCase().indexOf(hl.toLowerCase()) : -1;
    if (k >= 0 && hl.split(' ').length <= 2) { kicker = H.slice(0, k).trim(); main = H.substr(k, hl.length); rest = H.slice(k + hl.length).trim(); }
    else if (words.length >= 3) { const kn = (words[0].length <= 3 && words.length >= 4) ? 2 : 1; let mn = words.length - kn > 3 ? 2 : 1; if (mn === 2 && /^(to|for|of|in|on|your|and|the|a|an|with|that|is|are|can|will|from|by|at)$/i.test(words[kn + 1])) mn = 1; kicker = words.slice(0, kn).join(' '); main = words.slice(kn, kn + mn).join(' '); rest = words.slice(kn + mn).join(' '); }
    else { kicker = ''; main = words.join(' '); rest = ''; }
    if (!kicker && rest && rest.split(' ').length > 1) { /* keep as is */ }
  }
  kicker = String(kicker || '').toUpperCase().slice(0, 24); main = String(main || '').toUpperCase().slice(0, 24); rest = (() => { let t = ''; for (const w of String(rest || '').toUpperCase().split(' ')) { if ((t + ' ' + w).trim().length > 40) break; t = (t + ' ' + w).trim(); } return t; })();
  const tw = bg ? 500 : 900;
  let y = 400; let svg = '';
  if (kicker) { let ks = 54; while (ks > 30 && textWidth(kicker.split('').join(' '), ks, PO, 500) > tw) ks -= 2; svg += `<text x="56" y="${y}" font-family="${PO}" font-size="${ks}" font-weight="500" letter-spacing="${(ks * 0.18).toFixed(1)}" fill="${navy}">${esc(kicker)}</text>`; y += ks * 0.35; }
  const mf = fitRange(main, tw, 300, PO, 700, 'normal', 128, 60);
  mf.lines.forEach((l) => { y += mf.size * 0.98; svg += `<text x="50" y="${y.toFixed(0)}" font-family="${PO}" font-size="${mf.size}" font-weight="700" fill="${red}" letter-spacing="-2">${esc(l)}</text>`; y += mf.size * 0.02; });
  if (rest) { const rf = fitRange(rest, tw, 200, PO, 700, 'normal', Math.round(mf.size * 0.72), 40); rf.lines.forEach((l) => { y += rf.size * 1.02; svg += `<text x="54" y="${y.toFixed(0)}" font-family="${PO}" font-size="${rf.size}" font-weight="600" fill="${navy}" letter-spacing="-1">${esc(l)}</text>`; }); }
  y += 34; svg += `<rect x="56" y="${y.toFixed(0)}" width="200" height="9" fill="${red}"/><rect x="256" y="${y.toFixed(0)}" width="130" height="9" fill="${navy}"/>`; y += 60;
  const sub = String(P.subtitle || '').slice(0, 90);
  if (sub) { const sf = fitRange(sub, bg ? 430 : 820, 130, PO, 400, 'normal', 34, 26); svg += textBlock(sf.lines, 56, y + sf.size * 0.8, sf.lh, 'start', `font-family="${PO}" font-size="${sf.size}" font-weight="400" fill="${grey}"`); y += sf.lines.length * sf.lh + 30; }
  const pts = (P.points || []).map((x) => String(x).slice(0, 34)).filter(Boolean).slice(0, 4);
  let ps = 32; while (ps > 24 && pts.some((t) => textWidth(t, ps, PO, 500) > (bg ? 380 : 800))) ps -= 2;
  pts.forEach((t) => { y += 8; const cy = y + ps * 0.45; svg += `<circle cx="74" cy="${cy.toFixed(0)}" r="17" fill="${red}"/><path d="M66 ${cy.toFixed(0)} l6 6 l11 -12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="104" y="${(cy + ps * 0.36).toFixed(0)}" font-family="${PO}" font-size="${ps}" font-weight="500" fill="${navy}">${esc(t)}</text>`; y += ps * 1.55; });
  let person = '';
  if (bg) { const b = fs.readFileSync(bg); const iw = b.readUInt32BE(16), ih = b.readUInt32BE(20); let ph = 1020, pw = iw * ph / ih; if (pw > 700) { pw = 700; ph = ih * pw / iw; } const px = W - pw + Math.min(60, pw * 0.08); person = `<image href="data:image/png;base64,${b.toString('base64')}" x="${px.toFixed(0)}" y="${(H - ph).toFixed(0)}" width="${pw.toFixed(0)}" height="${ph.toFixed(0)}"/>`; }
  const logoF = path.join(__dirname, 'assets', 'timsauti_logo_flat.png');
  // The logo goes where it fits best: above the person on the right when there is clear space there, otherwise top left
  let personTop = H; if (bg) { const m = person.match(/ y="(\d+)"/); if (m) personTop = +m[1]; }
  const logoRight = bg && personTop >= 380;
  const logo = fs.existsSync(logoF) ? `<image href="data:image/png;base64,${fs.readFileSync(logoF).toString('base64')}" x="${logoRight ? W - 430 : 70}" y="50" width="${logoRight ? 370 : 400}" height="${logoRight ? 185 : 200}" preserveAspectRatio="${logoRight ? 'xMaxYMid' : 'xMinYMid'} meet"/>` : logoMark(navy, red);
  if (logoRight) svg = svg.replace(/(<text x="5[0-9]" y=")(\d+)/g, (a, b, c) => b + (+c - 150)).replace(/(<rect x="(?:56|256)" y=")(\d+)/g, (a, b, c) => b + (+c - 150)).replace(/(<circle cx="74" cy=")(\d+)/g, (a, b, c) => b + (+c - 150)).replace(/(<path d="M66 )(\d+)/g, (a, b, c) => b + (+c - 150)).replace(/(<text x="104" y=")(\d+)/g, (a, b, c) => b + (+c - 150)).replace(/(<tspan x="56" dy=")/g, '$1');
  const phones = esc(P.phones || '0733 566 667  |  0728 245 824');
  const cy0 = H - 150;
  const contact = `<rect x="50" y="${cy0}" width="300" height="58" rx="29" fill="${red}"/><text x="200" y="${cy0 + 39}" text-anchor="middle" font-family="${PO}" font-size="26" font-weight="700" fill="#fff">${esc(P.cta || 'GET STARTED TODAY')}</text><text x="56" y="${cy0 + 108}" font-family="${PO}" font-size="28" font-weight="700" fill="${navy}">${phones}</text>`;
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${person}${logo}${svg}${contact}</svg>`);
}

// Timsauti logo top left (tools/assets/timsauti_logo.png); the text wordmark is the fallback
function logoMark(teal, gold) {
  const f = path.join(__dirname, 'assets', 'timsauti_logo.png');
  if (fs.existsSync(f)) return `<image href="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" x="55" y="40" width="340" height="172" preserveAspectRatio="xMinYMid meet"/>`;
  return `<text x="70" y="120" font-family="Poppins" font-size="46" font-weight="700" fill="${teal}">TIMSAUTI</text><text x="72" y="160" font-family="Poppins" font-size="22" font-weight="500" letter-spacing="6" fill="${gold}">DIGITAL AGENCY</text>`;
}
const LAYOUTS = {
  poster,
  promo,
  clean,
  // Real photo with only a slim name strip: the message lives in the caption
  photo_plain(spec) {
    const p = paletteFor(spec); const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
    return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient></defs>
${bg ? imgTag(bg, 0, 0, W, H) : `<rect width="${W}" height="${H}" fill="${p.a}"/>`}<rect width="${W}" height="${H}" fill="url(#fade)"/>
<rect x="60" y="1236" width="10" height="64" fill="${p.accent}"/>
<text x="90" y="1266" font-family="Poppins" font-size="36" font-weight="700" fill="#ffffff">${esc(spec.name || '')}</text>
<text x="90" y="1300" font-family="Poppins" font-size="24" font-weight="400" fill="${p.accent}">${esc(spec.handle || '')}</text></svg>`);
  },
  // Photo on top, solid colour band below with the line in large serif type
  band(spec) {
    const p = paletteFor(spec); const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null; const top = 780;
    const f = fitRange(spec.text, 920, 380, 'Lora', 700, 'normal', 64, 36);
    const y0 = top + 70 + f.size * 0.9;
    const ref = spec.reference ? `<text x="80" y="${(y0 + f.lines.length * f.lh + 10).toFixed(1)}" font-family="Poppins" font-size="30" font-weight="500" fill="${p.accent}">${esc(spec.reference)}</text>` : '';
    return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
${bg ? focusTag(bg, 0, 0, W, top, spec.focus) : `<rect width="${W}" height="${top}" fill="${p.b}"/>`}
<rect x="0" y="${top}" width="${W}" height="${H - top}" fill="${p.a}"/><rect x="0" y="${top}" width="${W}" height="10" fill="${p.accent}"/>
${textBlock(f.lines, 80, y0, f.lh, 'start', `font-family="Lora" font-size="${f.size}" font-weight="700" fill="${p.text}"`)}${ref}
<text x="80" y="1300" font-family="Poppins" font-size="30" font-weight="700" fill="${p.text}">${esc(spec.name || '')}</text>
<text x="${W - 80}" y="1300" text-anchor="end" font-family="Poppins" font-size="24" font-weight="400" fill="${p.accent}">${esc(spec.handle || '')}</text></svg>`);
  },
  // Clean light page, bold dark sans text, accent bar: looks like a printed quote
  minimal(spec) {
    const p = paletteFor(spec); const f = fitRange(spec.text, 900, 640, 'Poppins', 700, 'normal', 84, 44);
    const y0 = 360 + Math.max(0, (760 - f.lines.length * f.lh - (spec.reference ? 70 : 0)) / 2) + f.size * 0.9;
    const ref = spec.reference ? `<text x="90" y="${(y0 + f.lines.length * f.lh + 20).toFixed(1)}" font-family="Lora" font-style="italic" font-size="38" fill="${p.b}">${esc(spec.reference)}</text>` : '';
    return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#f7f2e8"/><rect x="90" y="${(y0 - f.size * 0.9 - 60).toFixed(0)}" width="140" height="14" fill="${p.accent}"/>
${textBlock(f.lines, 90, y0, f.lh, 'start', `font-family="Poppins" font-size="${f.size}" font-weight="700" fill="#1c1c1c"`)}${ref}
<rect x="0" y="${H - 120}" width="${W}" height="120" fill="${p.a}"/>
<text x="90" y="${H - 50}" font-family="Poppins" font-size="34" font-weight="700" fill="#ffffff">${esc(spec.name || '')}</text>
<text x="${W - 90}" y="${H - 50}" text-anchor="end" font-family="Poppins" font-size="24" fill="${p.accent}">${esc(spec.handle || '')}</text></svg>`);
  },
  // Big uppercase statement, first line in gold, on a deep colour
  bold(spec) {
    const p = paletteFor(spec); const t = String(spec.text).toUpperCase();
    const f = fitRange(t, 920, 760, 'Poppins', 700, 'normal', 96, 44);
    const y0 = 300 + (760 - f.lines.length * f.lh) / 2 + f.size * 0.9;
    const lines = f.lines.map((l, i) => `<text x="80" y="${(y0 + i * f.lh).toFixed(1)}" font-family="Poppins" font-size="${f.size}" font-weight="700" fill="${i === 0 ? p.accent : p.text}">${esc(l)}</text>`).join('');
    const ref = spec.reference ? `<text x="80" y="1130" font-family="Poppins" font-size="32" font-weight="500" fill="${p.accent}">${esc(spec.reference)}</text>` : '';
    return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${p.a}"/><rect x="${W - 260}" y="0" width="260" height="${H}" fill="${p.b}" fill-opacity="0.6"/>
${lines}${ref}<rect x="80" y="1200" width="80" height="6" fill="${p.accent}"/>
<text x="80" y="1260" font-family="Poppins" font-size="32" font-weight="700" fill="${p.text}">${esc(spec.name || '')}</text>
<text x="80" y="1298" font-family="Poppins" font-size="24" fill="${p.accent}">${esc(spec.handle || '')}</text></svg>`);
  },
  // Side stripe with a large quote mark, serif text left aligned
  split(spec) {
    const p = paletteFor(spec); const f = fitRange(spec.text, 760, 760, 'Lora', 500, 'italic', 76, 40);
    const y0 = 300 + (760 - f.lines.length * f.lh) / 2 + f.size * 0.9;
    const ref = spec.reference ? `<text x="250" y="${(y0 + f.lines.length * f.lh + 10).toFixed(1)}" font-family="Poppins" font-size="32" font-weight="500" fill="${p.accent}">${esc(spec.reference)}</text>` : '';
    return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${p.b}"/><rect width="190" height="${H}" fill="${p.accent}"/>
<text x="95" y="330" text-anchor="middle" font-family="Lora" font-size="260" font-weight="700" fill="${p.a}">“</text>
${textBlock(f.lines, 250, y0, f.lh, 'start', `font-family="Lora" font-size="${f.size}" font-weight="500" font-style="italic" fill="${p.text}"`)}${ref}
<text x="250" y="1240" font-family="Poppins" font-size="34" font-weight="700" fill="${p.text}">${esc(spec.name || '')}</text>
<text x="250" y="1282" font-family="Poppins" font-size="24" fill="${p.accent}">${esc(spec.handle || '')}</text></svg>`);
  }
};
// ---------- Sauti Media poster: light text card or full photo, slim red bar branding bottom left, small logo top right ----------
function sautiCard(spec) {
  const red = '#e0261b', navy = '#0b1f4d', white = '#ffffff';
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null;
  const logoF = spec.logo && fs.existsSync(spec.logo) ? spec.logo : path.join(__dirname, 'assets', 'sauti_logo.png');
  const logo = fs.existsSync(logoF) ? `<image href="data:image/png;base64,${fs.readFileSync(logoF).toString('base64')}" x="${W - 250}" y="34" width="210" height="208" preserveAspectRatio="xMaxYMin meet"/>` : '';
  const head = String(spec.text || '').toUpperCase();
  const label = String(spec.label || 'NEWS').toUpperCase().slice(0, 28);
  const lw = textWidth(label, 30, 'Poppins', 700) + label.length * 2 + 52;
  const textCol = bg ? white : navy, subCol = bg ? '#e6e8ee' : '#4a5568';
  // headline block sits low on a photo (over the shade), centred on a text card
  const f = fitRange(head, 940, bg ? 380 : 620, 'Anton', 400, 'normal', bg ? 104 : 128, 54);
  const blockH = f.lines.length * f.lh * 0.92;
  const subF = spec.sub ? fitRange(String(spec.sub), 940, 110, 'Poppins', 500, 'normal', 36, 26) : null;
  const subH = subF ? subF.lines.length * subF.lh + 24 : 0;
  const yStart = bg ? H - 210 - subH - blockH : Math.max(330, (H - blockH - subH) / 2 - 10);
  // owner, 11 Nov: breaking news must shout. A full width red band with BREAKING NEWS in very large letters, and the photo darkened behind it,
  // so the eye goes to the words first and the photo (which may only be closely related to the story) stays in the background
  const brk = /^BREAKING/.test(label);
  const ly = yStart - (brk ? 168 : 86);
  // optional highlight: one headline line set in a red box, the way the owner's best posters do it
  const hi = spec.highlight && f.lines.length > 1 ? Math.min(1, f.lines.length - 1) : -1;
  const lines = f.lines.map((l, i) => { const y = yStart + f.size * 0.88 + i * f.lh * 0.92;
    const box = i === hi ? `<polygon points="${52},${(y - f.size * 0.86).toFixed(0)} ${(70 + textWidth(l, f.size, 'Anton', 400) + l.length * 1.5 + 30).toFixed(0)},${(y - f.size * 0.86).toFixed(0)} ${(70 + textWidth(l, f.size, 'Anton', 400) + l.length * 1.5 + 14).toFixed(0)},${(y + f.size * 0.16).toFixed(0)} ${36},${(y + f.size * 0.16).toFixed(0)}" fill="${red}"/>` : '';
    return box + `<text x="70" y="${y.toFixed(0)}" font-family="Anton" font-size="${f.size}" fill="${i === hi ? white : (i === 0 && !bg ? red : textCol)}">${esc(l)}</text>`; }).join('');
  const sub = subF ? textBlock(subF.lines, 70, yStart + blockH + 24 + subF.size, subF.lh, 'start', `font-family="Poppins" font-size="${subF.size}" font-weight="500" fill="${subCol}"`) : '';
  // a news outlet's photo (spec.wide = its size): shown whole above the headline on a blurred copy of itself, so no face is ever cut
  let wideTop = '';
  if (bg && spec.wide && spec.wide.w && spec.wide.h) {
    const top = 70, room = Math.max(320, ly - 30 - top), r = spec.wide.w / spec.wide.h;
    let pw = W, ph = W / r; if (ph > room) { ph = room; pw = ph * r; }
    const px = (W - pw) / 2, data = `data:image/jpeg;base64,${fs.readFileSync(bg).toString('base64')}`;
    wideTop = `<filter id="wb" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="45"/></filter><clipPath id="wc"><rect width="${W}" height="${H}"/></clipPath>`
      + `<g clip-path="url(#wc)"><image href="${data}" x="-80" y="-80" width="${W + 160}" height="${H + 160}" preserveAspectRatio="xMidYMid slice" filter="url(#wb)"/><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.35"/>`
      + `<image href="${data}" x="${px.toFixed(1)}" y="${top}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}"/></g>`;
  }
  const back = bg ? `${wideTop ? wideTop : spec.focus ? focusTag(bg, 0, 0, W, H, spec.focus) : spec.lift ? `<clipPath id="lf"><rect width="${W}" height="${H}"/></clipPath><g clip-path="url(#lf)">${imgTag(bg, -W * 0.08, -H * 0.1, W * 1.16, H * 1.16)}</g>` : imgTag(bg, 0, 0, W, H)}<defs><linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient><linearGradient id="tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sh)"/><rect x="${W - 300}" y="0" width="300" height="290" fill="url(#tp)"/>`
    : `<rect width="${W}" height="${H}" fill="#f5f7fb"/><rect x="0" y="0" width="${W}" height="12" fill="${red}"/><circle cx="-60" cy="${H + 40}" r="360" fill="${navy}" fill-opacity="0.05"/>`;
  const brand = `<rect x="70" y="${H - 150}" width="8" height="74" fill="${red}"/><text x="98" y="${H - 116}" font-family="Poppins" font-size="38" font-weight="700" fill="${textCol}">Sauti Media</text><text x="98" y="${H - 80}" font-family="Poppins" font-size="27" font-weight="500" fill="${red}">#sautimedia</text>`;
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${back}${brk && bg ? `<rect width="${W}" height="${H}" fill="#000" fill-opacity="0.45"/>` : ''}${logo}
${brk ? `<rect x="0" y="${ly}" width="${W}" height="136" fill="${red}"/><rect x="0" y="${ly + 136}" width="${W}" height="8" fill="${white}"/><text x="${W / 2}" y="${ly + 106}" text-anchor="middle" font-family="Anton" font-size="104" letter-spacing="6" fill="${white}">BREAKING NEWS</text>` : `<rect x="70" y="${ly}" width="${lw}" height="56" rx="8" fill="${red}"/><text x="${70 + lw / 2}" y="${ly + 38}" text-anchor="middle" font-family="Poppins" font-size="30" font-weight="700" letter-spacing="2" fill="${white}">${esc(label)}</text>`}
${lines}${sub}${brand}${bg && spec.credit ? (/^Photo: /.test(spec.credit)
    ? `<text x="${W - 26}" y="${H - 24}" text-anchor="end" font-family="Poppins" font-size="19" font-weight="500" fill="#ffffff" fill-opacity="0.78">${esc(String(spec.credit).slice(0, 60))}</text>`   // a news outlet's photo: small but readable
    : `<text x="${W - 22}" y="${H - 18}" text-anchor="end" font-family="Poppins" font-size="14" fill="#ffffff" fill-opacity="0.38">${esc(String(spec.credit).slice(0, 70))}</text>`) : ''}</svg>`);
}
// Thread poster ("9 LESSONS ..."): a real photo with a bold serif title on top and a dark fade, the style of viral lesson threads
function threadCard(spec) {
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null; const gold = spec.accent || '#f2b632';
  const f = fitRange(String(spec.title || '').toUpperCase(), 960, 330, 'Lora', 700, 'normal', 96, 52);
  const lines = f.lines.map((l, i) => `<text x="${W / 2}" y="${(150 + f.size * 0.9 + i * f.lh).toFixed(0)}" text-anchor="middle" font-family="Lora" font-weight="700" font-size="${f.size}" fill="#ffffff">${esc(l)}</text>`).join('');
  const yEnd = 150 + f.lines.length * f.lh + 10;
  // a library photo with no known face position sits below the title, so the title never covers a face
  const back = bg ? (spec.focus ? focusTag(bg, 0, 0, W, H, spec.focus) : `<rect width="${W}" height="${H}" fill="#14110f"/><circle cx="${W / 2}" cy="${H - 300}" r="520" fill="${gold}" fill-opacity="0.10"/>` + `<image href="data:image/${/\.png$/i.test(bg) ? 'png' : 'jpeg'};base64,${fs.readFileSync(bg).toString('base64')}" x="60" y="${yEnd + 100}" width="${W - 120}" height="${H - yEnd - 100}" preserveAspectRatio="xMidYMax meet"/>`) : `<rect width="${W}" height="${H}" fill="#1b1410"/>`;
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${back}
<defs><linearGradient id="tt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.86"/><stop offset="0.42" stop-color="#000" stop-opacity="0.35"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#tt)"/>${lines}
<rect x="${W / 2 - 160}" y="${yEnd}" width="320" height="4" fill="${gold}"/>
<text x="${W / 2}" y="${yEnd + 60}" text-anchor="middle" font-family="Lora" font-style="italic" font-weight="500" font-size="40" fill="${gold}">${esc(spec.sub || '(A thread)')}</text>
<text x="${W / 2}" y="${H - 60}" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="30" fill="#ffffff">${esc(spec.handle || '')}</text></svg>`);
}
// His photo shaped to Facebook's feed size (4:5), framed so his whole head and face are always in view
function photoFrame(file, focus) {
  if (!focus || !focus.w) return null;
  if (focus.skip) return null;   // photo where his head is already cut in the original: never used
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${focusTag(file, 0, 0, W, H, focus)}</svg>`);
}
// Timsauti real work: the owner's photo, with a white band carrying the logo and both phone numbers
function workCard(spec) {
  const bg = spec.bg && fs.existsSync(spec.bg) ? spec.bg : null; const band = 190;
  const logoF = path.join(__dirname, 'assets', 'timsauti_logo_flat.png');
  const logo = fs.existsSync(logoF) ? `<image href="data:image/png;base64,${fs.readFileSync(logoF).toString('base64')}" x="50" y="${H - band + 25}" width="330" height="140" preserveAspectRatio="xMinYMid meet"/>` : '';
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${bg ? imgTag(bg, 0, 0, W, H - band) : ''}<rect x="0" y="${H - band}" width="${W}" height="${band}" fill="#ffffff"/><rect x="0" y="${H - band}" width="${W}" height="8" fill="#d7261e"/>${logo}
<text x="${W - 50}" y="${H - band + 85}" text-anchor="end" font-family="Poppins" font-size="30" font-weight="700" fill="#0b1f4d">OUR WORK</text><text x="${W - 50}" y="${H - band + 132}" text-anchor="end" font-family="Poppins" font-size="30" font-weight="600" fill="#d7261e">0733 566 667  |  0728 245 824</text></svg>`);
}
module.exports = { threadCard, workCard, renderCard, photoFrame, sautiCard, LAYOUTS: Object.keys(LAYOUTS) };

// Makasa wit card (owner, 12 Nov): short real life wisdom in the "Not invited = Don't go!" style, on a note card,
// with green underlines and hand drawn red circles, signed with his name so every share carries it.
function witCard({ lines, name = 'Timothy Makasa', tag = '#Makasa' }) {
  const fs = require('fs'), path = require('path'); const { Resvg } = require('@resvg/resvg-js');
  const FONTS = path.join(__dirname, '..', 'assets', 'fonts'); const fontFiles = fs.readdirSync(FONTS).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONTS, f));
  const opts = { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Lora' } };
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const measure = (t, size) => { try { const b = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="300"><text x="10" y="200" font-family="Lora" font-size="${size}">${esc(t)}</text></svg>`, opts).getBBox(); return b ? b.width : t.length * size * 0.5; } catch (e) { return t.length * size * 0.5; } };
  const W = 1080, H = 1080, PX = 60, PY = 140, PW = W - 2 * PX, PH = 720;
  const n = lines.length;
  let size = 68; const lineW = (a, b, sz) => measure(a, sz) + measure(b, sz) + sz * 1.9;   // text plus the "=" and circle room
  while (size > 40 && Math.max(...lines.map(([a, b]) => lineW(a, b, size))) > PW - 110) size -= 2;
  const gap = Math.min(160, (PH - 160) / Math.max(1, n - 1 || 1));
  let y = PY + PH / 2 - (gap * (n - 1)) / 2 + size * 0.3;
  const parts = [`<rect width="${W}" height="${H}" fill="#0d0d0f"/>`,
    `<rect x="${PX + 8}" y="${PY + 10}" width="${PW}" height="${PH}" fill="#000" opacity="0.5"/>`,
    `<rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" fill="#e6e6e3"/>`];
  const widest = Math.max(...lines.map(([a, b]) => lineW(a, b, size))); const x0 = PX + (PW - widest) / 2 + size * 0.15;
  lines.forEach(([a, b], i) => {
    const wa = measure(a, size), wb = measure(b, size), we = measure('=', size);
    const xe = x0 + wa + size * 0.32, xb = xe + we + size * 0.55; const rot = (i % 2 ? -2.5 : 2);
    parts.push(`<text x="${x0}" y="${y}" font-family="Lora" font-size="${size}" fill="#262626">${esc(a)}</text>`);
    parts.push(`<path d="M${x0 - 6} ${y + size * 0.2} Q${x0 + wa / 2} ${y + size * 0.28} ${x0 + wa + 4} ${y + size * 0.18}" stroke="#2f9e7a" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.9"/>`);
    parts.push(`<path d="M${x0 - 10} ${y + size * 0.31} Q${x0 + wa / 2} ${y + size * 0.36} ${x0 + wa - 8} ${y + size * 0.28}" stroke="#2f9e7a" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>`);
    parts.push(`<text x="${xe}" y="${y}" font-family="Lora" font-size="${size}" fill="#262626">=</text>`);
    parts.push(`<text x="${xb}" y="${y}" font-family="Lora" font-size="${size}" fill="#262626">${esc(b)}</text>`);
    const cx = xb + wb / 2, cy = y - size * 0.32, rx = wb / 2 + size * 0.28, ry = size * 0.62;
    parts.push(`<g transform="rotate(${rot} ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#9b2c40" stroke-width="3.5" opacity="0.9"/><ellipse cx="${cx + 4}" cy="${cy - 3}" rx="${rx + 7}" ry="${ry - 5}" fill="none" stroke="#9b2c40" stroke-width="2" opacity="0.7"/></g>`);
    y += gap;
  });
  parts.push(`<text x="${PX + PW - 26}" y="${PY + PH - 26}" text-anchor="end" font-family="Lora" font-style="italic" font-size="26" fill="#7a7a7a">${esc(name)}</text>`);
  parts.push(`<text x="${W / 2}" y="${PY + PH + 112}" text-anchor="middle" font-family="Lora" font-style="italic" font-size="52" fill="#f2f2f2">${esc(name)}</text>`);
  parts.push(`<rect x="${W / 2 - 60}" y="${PY + PH + 138}" width="120" height="4" fill="#2f9e7a"/>`);
  parts.push(`<text x="${W / 2}" y="${PY + PH + 188}" text-anchor="middle" font-family="Poppins" font-size="28" fill="#bdbdbd">${esc(tag)}</text>`);
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`, opts).render().asPng();
}
module.exports.witCard = witCard;

// ---------- Sauti Media English Corner (owner, 14 Nov): one common error per card, clean white so it reads well and is shared ----------
function englishCard({ wrong, right, rule, wrongEx, rightEx, num }) {
  const navy = '#0a1a40', red = '#d7261e', green = '#14833b', grey = '#5b6478';
  const logoF = path.join(__dirname, 'assets', 'sauti_logo.png');
  const logo = fs.existsSync(logoF) ? `<image href="data:image/png;base64,${fs.readFileSync(logoF).toString('base64')}" x="56" y="40" width="170" height="168" preserveAspectRatio="xMinYMin meet"/>` : '';
  const P = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`, logo];
  P.push(`<rect x="${W - 376}" y="62" width="320" height="58" rx="29" fill="${red}"/><text x="${W - 216}" y="101" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="25" letter-spacing="3" fill="#fff">ENGLISH CORNER</text>`);
  if (num) P.push(`<text x="${W - 216}" y="158" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="24" fill="${grey}">Lesson ${num}</text>`);
  P.push(`<text x="60" y="318" font-family="Anton" font-size="104" fill="${navy}">SAY IT RIGHT</text><rect x="60" y="340" width="150" height="8" rx="4" fill="${red}"/>`);
  const cross = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${red}"/><path d="M${cx - r * 0.38} ${cy - r * 0.38} L${cx + r * 0.38} ${cy + r * 0.38} M${cx + r * 0.38} ${cy - r * 0.38} L${cx - r * 0.38} ${cy + r * 0.38}" stroke="#fff" stroke-width="${r * 0.22}" stroke-linecap="round"/>`;
  const tick = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${green}"/><path d="M${cx - r * 0.42} ${cy + r * 0.02} L${cx - r * 0.1} ${cy + r * 0.34} L${cx + r * 0.45} ${cy - r * 0.32}" stroke="#fff" stroke-width="${r * 0.22}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const phrase = (t, y, col, strike) => { const f = fitRange(t, 740, 110, 'Poppins', 700, 'normal', 62, 34); const s = f.size, lines = f.lines, lh = s * 1.15; const y0 = y - ((lines.length - 1) * lh) / 2 + s * 0.35;
    let out = textBlock(lines.map(esc), 220, y0, lh, 'start', `font-family="Poppins" font-weight="700" font-size="${s}" fill="${col}"`);
    if (strike) lines.forEach((l, i) => { const w = textWidth(l, s, 'Poppins', 700); out += `<rect x="220" y="${(y0 + i * lh - s * 0.33).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(4, s * 0.07).toFixed(1)}" fill="${red}"/>`; }); return out; };
  P.push(`<rect x="60" y="380" width="${W - 120}" height="170" rx="28" fill="#fdeeee"/>${cross(140, 465, 46)}<text x="220" y="420" font-family="Poppins" font-weight="700" font-size="22" letter-spacing="3" fill="${red}">NOT</text>${phrase(wrong, 480, '#8a1c17', true)}`);
  P.push(`<rect x="60" y="578" width="${W - 120}" height="170" rx="28" fill="#e9f7ef"/>${tick(140, 663, 46)}<text x="220" y="618" font-family="Poppins" font-weight="700" font-size="22" letter-spacing="3" fill="${green}">SAY</text>${phrase(right, 678, '#0d5c29', false)}`);
  let y = 820; P.push(`<text x="60" y="${y}" font-family="Poppins" font-weight="700" font-size="24" letter-spacing="3" fill="${red}">WHY</text>`); y += 50;
  for (const l of wrap(rule, 36, W - 120, 'Poppins', 500).slice(0, 3)) { P.push(`<text x="60" y="${y}" font-family="Poppins" font-weight="500" font-size="36" fill="${navy}">${esc(l)}</text>`); y += 50; }
  y += 22; P.push(`<rect x="60" y="${y}" width="${W - 120}" height="2" fill="#e3e6ee"/>`); y += 58;
  const ex = (t, icon, col) => { const ls = wrap(t, 30, W - 200, 'Lora', 400, 'italic').slice(0, 2); const out = icon(84, y - 10, 18) + textBlock(ls.map(esc), 120, y, 42, 'start', `font-family="Lora" font-style="italic" font-size="30" fill="${col}"`); y += ls.length * 42 + 22; return out; };
  P.push(ex(wrongEx, cross, grey)); P.push(ex(rightEx, tick, navy));
  P.push(`<rect x="0" y="${H - 96}" width="${W}" height="96" fill="${navy}"/><rect x="0" y="${H - 102}" width="${W}" height="6" fill="${red}"/>`);
  P.push(`<text x="60" y="${H - 38}" font-family="Poppins" font-weight="700" font-size="30" fill="#fff">Sauti Media English Corner</text><text x="${W - 60}" y="${H - 38}" text-anchor="end" font-family="Poppins" font-weight="600" font-size="28" fill="#f2b632">#sautimedia</text>`);
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${P.join('')}</svg>`);
}
module.exports.englishCard = englishCard;
