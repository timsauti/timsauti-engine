// Builds the Tech na Pesa website into dist/. Stories come from content/stories (newsroom) and content/community (approved reader stories).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');
const SITE = process.env.SITE_URL || 'https://technapesa.co.ke';
const BASE = process.env.BASE_PATH || '';           // e.g. /technapesa when served from github.io/technapesa
const FB = 'https://www.facebook.com/570910356269659';
const CATS = {
  tech: { name: 'Tech', blurb: 'Phones, apps, AI, startups and the digital services that run Kenya.' },
  money: { name: 'Money and M-Pesa', blurb: 'M-PESA, banks, loans, savings and investments, explained in plain language.' },
  scams: { name: 'Scam Alerts', blurb: 'The latest tricks doing the rounds, and exactly how to protect yourself.' },
  hustles: { name: 'Hustles and Jobs', blurb: 'Real side hustles, jobs and opportunities, checked before we share them.' },
  howto: { name: 'How To', blurb: 'Short, step by step guides for KRA, eCitizen, SHA, M-PESA and more.' },
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const u = (p) => BASE + p;
const fmt = (d) => new Date(d + (String(d).length === 10 ? 'T09:00:00+03:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
const read = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
const DATA = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'data', f), 'utf8')); } catch (e) { return d; } };
const TOOLS = DATA('tools.json', {}), RATES = DATA('rates.json', null), WINNERS = DATA('winners.json', []).filter((w) => !w.none);
const CHALLENGES = read(path.join(ROOT, 'content', 'challenges')).filter((c) => c.status !== 'draft').sort((a, b) => String(b.opens).localeCompare(a.opens));
const ENTRIES = read(path.join(ROOT, 'content', 'entries'));
const chState = (c) => { const n = Date.now(); return n < Date.parse(c.opens) ? 'soon' : n < Date.parse(c.entriesClose) ? 'entries' : n < Date.parse(c.votingCloses) ? 'voting' : 'closed'; };
const news = read(path.join(ROOT, 'content', 'stories')).sort((a, b) => String(b.date).localeCompare(a.date));
const comm = read(path.join(ROOT, 'content', 'community')).map((s) => Object.assign({ community: true }, s)).sort((a, b) => String(b.date).localeCompare(a.date));
const img = (s) => u(`/img/cards/${s.slug}.png`);
const href = (s) => u(s.community ? `/community/${s.slug}/` : `/story/${s.slug}/`);
const wslug = (s) => (String(s.author || 'reader').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reader') + (s.author_key ? '-' + s.author_key : '');
const whref = (s) => u(`/writers/${wslug(s)}/`);
const sbScripts = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script><script src="${u('/config.js')}"></script><script src="${u('/community.js')}"></script>`;
{ const av = {}; for (const s of comm) if (s.avatar && !av[wslug(s)]) av[wslug(s)] = s.avatar; for (const s of comm) if (!s.avatar && av[wslug(s)]) s.avatar = av[wslug(s)]; }   // a writer's newest approved photo shows on all their stories
const initial = (n) => esc(String(n || '?').trim().slice(0, 1).toUpperCase());
// Facebook style community post: profile photo, name, county, time, the story text with See more, photo, and actions
const avatarHtml = (s, size) => s.avatar ? `<img class="pp" src="${u('/' + s.avatar)}" alt="" style="width:${size}px;height:${size}px">` : `<span class="avatar pp" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${initial(s.author)}</span>`;
const winnerOf = (s) => WINNERS.find((w) => w.slug === s.slug);
const isWinnerWriter = (s) => WINNERS.some((w) => w.author && w.author === s.author);
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';
function post(s) {
  const text = (s.body || []).filter((x) => typeof x === 'string'), first = text.join('\n\n'), short = first.length > 320;
  const url = SITE + href(s).replace(BASE, '');
  return `<article class="post" data-slug="${esc(s.slug)}"><header><a href="${whref(s)}">${avatarHtml(s, 48)}</a><div><a href="${whref(s)}" class="pn">${esc(s.author)}</a>${isWinnerWriter(s) ? '<span class="badge">Story of the Month winner</span>' : ''}<div class="pm">${s.county ? esc(s.county) + ' &middot; ' : ''}<time data-ago="${esc(s.date)}">${fmt(s.date)}</time> &middot; ${CATS[s.cat] ? CATS[s.cat].name : 'Community'}</div></div></header>
<a class="pt" href="${href(s)}">${esc(s.title)}</a><div class="px${short ? ' clip' : ''}">${text.map((x) => `<p>${esc(x)}</p>`).join('')}</div>${short ? `<button class="more" onclick="this.previousElementSibling.classList.remove('clip');this.remove()">See more</button>` : ''}
${s.photo ? `<a href="${href(s)}"><img class="pimg" loading="lazy" src="${u('/' + s.photo)}" alt=""></a>` : ''}
<div class="pc"><span class="likes" data-count="${esc(s.slug)}"></span><span class="rstat" data-rating="${esc(s.slug)}"></span><a class="ccount" data-ccount="${esc(s.slug)}" href="${href(s)}#comments"></a></div>
<footer><button class="act" data-like="${esc(s.slug)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zm0 0 4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/></svg>Like</button><a class="act" href="${href(s)}#comments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v11H8l-4 4z"/></svg>Comment</a><a class="act wa" href="https://wa.me/?text=${encodeURIComponent(s.title + ' ' + url)}" rel="noopener">${ICON.wa}WhatsApp</a><a class="act" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" rel="noopener">${ICON.fb}Share</a></footer></article>`;
}
function composer() {
  return `<a class="post composer" href="${u('/write/')}"><span class="avatar pp" style="width:48px;height:48px">+</span><span class="fake-input">What is your money, hustle or scam story?</span><span class="btn">Post</span></a>`;
}
function storiesRow() {
  const seen = new Set(), ws = []; for (const s of comm) { const k = wslug(s); if (!seen.has(k)) { seen.add(k); ws.push(s); } }
  return `<div class="srow"><a class="sitem add" href="${u('/write/')}"><span class="ring"><span class="avatar pp" style="width:62px;height:62px;font-size:30px">+</span></span><small>Your story</small></a>${ws.slice(0, 14).map((s) => `<a class="sitem" href="${href(s)}"><span class="ring">${avatarHtml(s, 62)}</span><small>${esc(String(s.author).split(' ')[0])}</small></a>`).join('')}</div>`;
}
function feed(list, limit) {
  const l = list.slice(0, limit || 50);
  return storiesRow() + composer() + (l.length ? l.map(post).join('') : `<div class="post empty-post"><span class="avatar pp" style="width:64px;height:64px;font-size:28px">1</span><h3>Be the first voice on Tech na Pesa</h3><p>Write about a hustle, a money lesson or a scam you beat. Your name and profile photo appear right here for every visitor to see.</p><a class="btn" href="${u('/write/')}">Write the first story</a></div>`);
}
function feedSide() {
  const ws = {}; for (const s of comm) (ws[wslug(s)] = ws[wslug(s)] || []).push(s);
  const top = Object.entries(ws).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  return `<aside class="fside"><div class="panel"><h3>Join the community</h3><p>Create a free account, add your profile photo and share what you know. Every story is checked before it goes live.</p><a class="btn" href="${u('/write/')}" style="width:100%;justify-content:center">Share your story</a></div>`
    + (top.length ? `<div class="panel"><h3>Top writers</h3>${top.map(([k, l]) => `<a class="tw" href="${u('/writers/' + k + '/')}">${avatarHtml(l[0], 40)}<span><b>${esc(l[0].author)}</b><small>${l.length} ${l.length === 1 ? 'story' : 'stories'}${l[0].county ? ' &middot; ' + esc(l[0].county) : ''}</small></span></a>`).join('')}</div>` : '')
    + `<a class="panel prize-card" href="${u('/prize/')}"><span class="chip" style="color:#f4b631">Monthly prize</span><h3>Win KSh 500</h3><p>The best rated reader story each month wins KSh 500, sent by M-PESA. Rate stories to choose the winner.</p><span class="btn gold">How it works</span></a>`
    + `<div class="panel mini-check"><h3>Got a strange message?</h3><p>Check it in one second with the Scam Checker.</p><a class="btn gold" href="${u('/scam-checker/')}">Check a message</a></div></aside>`;
}

const ICON = {
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3z"/></svg>',
  fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V7c0-.9.6-1 1-1h2.5V2.1L14.2 2C10.6 2 10 4.6 10 6.3V9H7.5v4H10v9h4v-9h3l.5-4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};

function layout({ title, desc, canon, image, body, on, type, extraHead }) {
  const t = title ? `${title} | Tech na Pesa` : 'Tech na Pesa: tech, money and digital life in Kenya';
  const d = desc || 'Fast, checked tech and money news for Kenya: M-PESA, phones and apps, scam alerts, real side hustles, jobs and simple how to guides.';
  const ogi = image ? SITE + image.replace(BASE, '') : SITE + '/img/og.png';
  const ticker = news.concat(comm).sort((a, b) => String(b.date).localeCompare(a.date)).slice(0, 10).map((s) => `<a href="${href(s)}">${esc(s.title)}</a>`).join('');
  const nav = [['tech', 'Tech'], ['money', 'Money'], ['scams', 'Scam Alerts'], ['hustles', 'Hustles'], ['howto', 'How To']].map(([k, n]) => `<a href="${u('/c/' + k + '/')}"${on === k ? ' class="on"' : ''}>${n}</a>`).join('')
    + `<a href="${u('/challenges/')}"${on === 'challenges' ? ' class="on"' : ''}>Challenges</a><a href="${u('/tools/')}"${on === 'tools' ? ' class="on"' : ''}>Money Tools</a><a href="${u('/scam-checker/')}"${on === 'checker' ? ' class="on"' : ''}>Scam Checker</a><a href="${u('/community/')}"${on === 'community' ? ' class="on"' : ''}>Community</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t)}</title><meta name="description" content="${esc(d)}"><link rel="canonical" href="${esc(canon || SITE + '/')}">
<meta property="og:site_name" content="Tech na Pesa"><meta property="og:title" content="${esc(title || 'Tech na Pesa')}"><meta property="og:description" content="${esc(d)}">
<meta property="og:image" content="${esc(ogi)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:type" content="${type || 'website'}"><meta property="og:url" content="${esc(canon || SITE + '/')}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#07142a">
<link rel="icon" href="${u('/img/icon.png')}"><link rel="manifest" href="${u('/manifest.webmanifest')}"><link rel="apple-touch-icon" href="${u('/img/icon.png')}"><link rel="alternate" type="application/rss+xml" title="Tech na Pesa" href="${u('/feed.xml')}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${u('/style.css')}">${extraHead || ''}</head><body>
<header class="top"><div class="wrap"><a class="brand" href="${u('/')}"><img src="${u('/img/icon.png')}" alt=""><span>TECH<span class="na"> na </span><span class="pesa">PESA</span></span></a>
<nav class="nav" id="nav">${nav}</nav><a class="btn" href="${u('/write/')}">Share your story</a><button class="burger" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('open')">&#9776;</button></div></header>
<div class="pulse"><div class="wrap"><span class="live"><svg viewBox="0 0 46 18"><polyline fill="none" stroke="#2fe6a7" stroke-width="2" points="0,9 14,9 18,2 23,16 27,6 30,9 46,9"/></svg>THE PULSE</span><div class="ticker"><div class="run">${ticker}${ticker}</div></div></div></div>
<main>${body}</main>
<footer><div class="wrap"><div class="fgrid"><div><a class="brand" href="${u('/')}" style="margin:0 0 10px"><img src="${u('/img/icon.png')}" alt=""><span>TECH<span class="na"> na </span><span class="pesa">PESA</span></span></a>
<p style="margin:0">Your phone, your money, your Kenya. Made simple. Every newsroom story is checked against named sources before it is published.</p></div>
<div><h4>Sections</h4>${Object.entries(CATS).map(([k, c]) => `<a href="${u('/c/' + k + '/')}">${c.name}</a>`).join('')}</div>
<div><h4>Join in</h4><a href="${u('/write/')}">Share your story</a><a href="${u('/prize/')}">Win KSh 500 monthly</a><a href="${u('/tools/')}">Money Tools</a><a href="${u('/scam-checker/')}">Scam Checker and Radar</a><a href="${u('/community/')}">Community stories</a><a href="${FB}" rel="noopener">Facebook</a><a href="${u('/feed.xml')}">RSS feed</a></div></div>
<div class="legal">&copy; ${new Date().getFullYear()} Tech na Pesa. Information, not financial advice. <a style="display:inline" href="${u('/rules/')}">Community rules</a> &middot; <a style="display:inline" href="${u('/privacy/')}">Privacy</a> &middot; <a style="display:inline" href="${u('/terms/')}">Terms</a></div></div></footer>
<script>window.TNP_BASE=${JSON.stringify(BASE)};if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register(${JSON.stringify(u('/sw.js'))}).catch(function(){})});</script><script src="${u('/app.js')}" defer></script><script src="${u('/tools.js')}" defer></script></body></html>`;
}

const card = (s) => `<a class="card cat-${s.community ? 'community' : s.cat}" href="${href(s)}"><img loading="lazy" src="${img(s)}" alt=""><div class="in"><span class="chip">${s.community ? 'Community' : CATS[s.cat].name}</span><h3>${esc(s.title)}</h3><p>${esc(s.dek || '')}</p><span class="meta">${fmt(s.date)}${s.community ? ' &middot; by <b>' + esc(s.author) + '</b>' : ''}</span></div></a>`;

function bodyHtml(blocks) {
  return blocks.map((b) => typeof b === 'string' ? `<p>${esc(b)}</p>` : b.h ? `<h2>${esc(b.h)}</h2>` : b.list ? `<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : b.steps ? `<ol class="steps">${b.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '').join('');
}
function shareBar(s) {
  const url = SITE + href(s).replace(BASE, ''), text = s.title + ' ' + url;
  return `<div class="share"><a class="wa" href="https://wa.me/?text=${encodeURIComponent(text)}" rel="noopener">${ICON.wa}WhatsApp</a><a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" rel="noopener">${ICON.fb}Facebook</a><a href="https://x.com/intent/post?text=${encodeURIComponent(text)}" rel="noopener">${ICON.x}X</a><button data-copy="${esc(url)}">${ICON.link}Copy link</button></div>`;
}

function write(p, html) { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); }

// ---------- build
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'static'), OUT, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(OUT, 'style.css'));
for (const f of ['app.js', 'community.js', 'checker.js', 'tools.js', 'sw.js']) fs.copyFileSync(path.join(__dirname, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({ name: 'Tech na Pesa', short_name: 'Tech na Pesa', description: 'Tech, money and digital life in Kenya', start_url: (BASE || '') + '/', scope: (BASE || '') + '/', display: 'standalone', background_color: '#07142a', theme_color: '#07142a', icons: [{ src: (BASE || '') + '/img/icon.png', sizes: '256x256', type: 'image/png' }, { src: (BASE || '') + '/img/logo.png', sizes: '1080x1080', type: 'image/png', purpose: 'any maskable' }] }));
fs.writeFileSync(path.join(OUT, 'config.js'), `window.TNP_CONFIG=${JSON.stringify({ url: process.env.SUPABASE_URL || '', key: process.env.SUPABASE_ANON_KEY || '', base: BASE, google: process.env.GOOGLE_SIGNIN === '1' })};`);

// money strip, prize banner
const ksh = (n) => 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function pesaToday() {
  const f = TOOLS.fuel || {}, r = RATES;
  return `<div class="pesa"><div class="wrap"><div class="ptiles">
<a class="pt1" href="${u('/tools/')}#fuel"><small>Petrol, ${esc(f.town || 'Nairobi')}</small><b>${f.petrol ? ksh(f.petrol) : 'See tools'}</b><em>per litre to ${f.to ? fmt(f.to) : ''}</em></a>
<a class="pt1" href="${u('/tools/')}#fuel"><small>Diesel, ${esc(f.town || 'Nairobi')}</small><b>${f.diesel ? ksh(f.diesel) : 'See tools'}</b><em>per litre</em></a>
<a class="pt1" href="${u('/tools/')}#rates"><small>1 US dollar</small><b>${r ? ksh(r.usd) : 'Updating'}</b><em>${r ? 'market rate, ' + fmt(r.date) : 'refreshes daily'}</em></a>
<div class="pt1 calc-mini"><small>M-PESA charge calculator</small><div class="cm"><input type="number" inputmode="numeric" min="1" placeholder="Amount in KSh" data-mini-amount><div data-mini-out><em>Type an amount</em></div></div></div>
</div></div></div><script>window.TNP_TARIFF=${JSON.stringify((TOOLS.mpesa || {}).bands || [])};</script>`;
}
function challengeBanner() {
  const c = CHALLENGES.find((x) => ['entries', 'voting'].includes(chState(x))); if (!c) return '';
  const st = chState(c);
  return `<div class="wrap"><a class="chbanner" href="${u('/challenges/' + c.slug + '/')}"><div><span class="chip" style="color:#2fe6a7">${st === 'entries' ? 'Challenge open for entries' : 'Voting is open'}</span><h3>${esc(c.title)}</h3><p>Prize: ${esc(c.prize || '')}${c.sponsor ? ' &middot; Sponsored by ' + esc(c.sponsor.name) : ''}</p></div><span class="btn gold">${st === 'entries' ? 'Enter now' : 'Vote now'}</span></a></div>`;
}
function winnerBanner() {
  const w = WINNERS[WINNERS.length - 1]; if (!w) return '';
  const s = comm.find((x) => x.slug === w.slug); const m = new Date(w.month + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return `<div class="wrap"><a class="winner" href="${s ? href(s) : u('/prize/')}">${s ? avatarHtml(s, 64) : ''}<div><span class="chip" style="color:#f4b631">Story of the Month, ${m}</span><h3>${esc(w.title)}</h3><p>By ${esc(w.author)}${w.county ? ', ' + esc(w.county) : ''} &middot; rated ${w.avg} stars by ${w.n} readers &middot; wins KSh ${w.prize || 500}</p></div></a></div>`;
}

// home
const lead = news.find((s) => s.featured) || news[0];
const rest = news.filter((s) => s !== lead);
const home = `
<div class="hero"><div class="wrap hero-grid">
<a class="lead cat-${lead.cat}" href="${href(lead)}"><img src="${img(lead)}" alt=""><div class="txt"><span class="chip">${CATS[lead.cat].name}</span><h1>${esc(lead.title)}</h1><p>${esc(lead.dek)}</p></div></a>
<div class="side">${rest.slice(0, 4).map((s) => `<a class="mini cat-${s.cat}" href="${href(s)}"><img src="${img(s)}" alt=""><div><span class="chip">${CATS[s.cat].name}</span><h3>${esc(s.title)}</h3></div></a>`).join('')}</div>
</div></div>
${pesaToday()}${challengeBanner()}${winnerBanner()}
<section class="feedsec"><div class="wrap"><div class="sec-h"><div><span class="chip cat-community">Live from our readers</span><h2>Community Feed</h2></div><a href="${u('/community/')}">See all</a></div><div class="feedgrid"><div class="feed">${feed(comm, 8)}</div>${feedSide()}</div></div></section>${sbScripts}
<section><div class="wrap"><div class="sec-h"><h2>Latest from the newsroom</h2><a href="${u('/c/tech/')}">All sections</a></div><div class="grid">${news.slice(0, 6).map(card).join('')}</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="band"><div><span class="chip cat-scams">Scam Checker</span><h2>Got a message that feels off?</h2><p>Paste any SMS, WhatsApp or email into our Scam Checker. In one second it highlights the tricks fraudsters use, from fake reversals to job fees. Then warn others on Scam Radar.</p><a class="btn gold" href="${u('/scam-checker/')}">Check a message now</a></div>
<div><div class="fake-sms"><small>From: 0712 xxx xxx</small>Dear customer, <mark>you have won</mark> KSh 50,000 in the Safaricom promotion. Send <mark>KSh 500 processing fee</mark> to this number <mark>within 1 hour</mark> to claim.</div><span class="risk">High risk: 3 warning signs</span></div></div></div></section>
<section><div class="wrap comm"><div><span class="chip cat-community">Community</span><h2>Your story belongs here</h2><p style="color:var(--muted);margin:0 0 18px">Started a hustle, beaten a scammer, found a tool that saves you money? Create a free account, write it in your own words and share it straight to WhatsApp. Every story is reviewed before it goes live, so the community stays safe and useful.</p><a class="btn" href="${u('/write/')}">Share your story</a> <a class="btn ghost" style="color:var(--ink)" href="${u('/community/')}">Read the community</a></div>
<div class="steps3"><div><b>1</b>Create a free account with your email or Google</div><div><b>2</b>Write your story and add a photo</div><div><b>3</b>Our editors review it, then it goes live with your name</div><div><b>4</b>Share it to WhatsApp, Facebook and X in one tap</div></div></div></section>
${news.length < 10 ? '' : Object.keys(CATS).filter((k) => news.filter((s) => s.cat === k).length >= 3).map((k) => `<section style="padding-top:10px"><div class="wrap"><div class="sec-h"><h2>${CATS[k].name}</h2><a href="${u('/c/' + k + '/')}">More</a></div><div class="grid">${news.filter((s) => s.cat === k).slice(0, 3).map(card).join('')}</div></div></section>`).join('')}`;
write('index.html', layout({ body: home, canon: SITE + '/' }));

// categories
for (const [k, c] of Object.entries(CATS)) {
  const list = news.filter((s) => s.cat === k);
  write(`c/${k}/index.html`, layout({ title: c.name, desc: c.blurb, canon: `${SITE}/c/${k}/`, on: k, body: `<div class="pagehead cat-${k}"><div class="wrap"><span class="chip">Section</span><h1>${c.name}</h1><p>${c.blurb}</p></div></div><section><div class="wrap">${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty">New ${c.name.toLowerCase()} stories are on the way. Check back soon, or <a href="${u('/write/')}" style="text-decoration:underline">share your own</a>.</div>`}</div></section>` }));
}

// story pages (newsroom and community)
for (const s of news.concat(comm)) {
  const related = news.filter((x) => x !== s && (s.community || x.cat === s.cat)).concat(news.filter((x) => x !== s)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: s.title, description: s.dek || '', image: [SITE + '/img/og/' + s.slug + '.png'], datePublished: s.date, publisher: { '@type': 'Organization', name: 'Tech na Pesa', logo: { '@type': 'ImageObject', url: SITE + '/img/icon.png' } }, author: s.community ? { '@type': 'Person', name: s.author } : { '@type': 'Organization', name: 'Tech na Pesa' } };
  const by = s.community ? `<div class="byline">${avatarHtml(s, 44)}<span>By <a href="${whref(s)}" style="text-decoration:underline"><b>${esc(s.author)}</b></a>${s.county ? ', ' + esc(s.county) : ''} &middot; ${fmt(s.date)} &middot; Community story</span></div>` : `<div class="byline"><span class="avatar">T</span><span>Tech na Pesa newsroom &middot; ${fmt(s.date)}</span></div>`;
  const html = `<article class="art cat-${s.community ? 'community' : s.cat}"><span class="chip">${s.community ? 'Community' : CATS[s.cat].name}</span><h1>${esc(s.title)}</h1>${s.dek ? `<p class="dek">${esc(s.dek)}</p>` : ''}${by}
<div class="cover"><img src="${img(s)}" alt=""></div>${shareBar(s)}<div class="body">${bodyHtml(s.body)}</div>${s.q ? `<div class="ask">${esc(s.q)}</div>` : ''}${shareBar(s)}
${s.sources && s.sources.length ? `<div class="src">Sources: ${s.sources.map((x) => `<a href="${esc(x.url)}" rel="noopener nofollow">${esc(x.name)}</a>`).join(', ')}</div>` : ''}
<div class="rate-box" data-rate="${esc(s.slug)}"><div><b>Rate this story</b><small data-rating="${esc(s.slug)}">Be the first to rate it</small></div><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} stars">${STAR}</button>`).join('')}</div></div>
<div class="comments" id="comments" data-comments="${esc(s.slug)}"><h2>Comments</h2><div class="clist"><div class="hint">Loading comments...</div></div></div>
${s.community ? `<div class="note info">This story was written by a member of the Tech na Pesa community and reviewed by our editors before publishing. Views are the writer's own. <a href="${u('/write/')}" style="text-decoration:underline">Share yours</a>.</div>` : ''}</article>
<section style="padding-top:20px"><div class="wrap"><div class="sec-h"><h2>Read next</h2></div><div class="grid">${related.map(card).join('')}</div></div></section>
<section class="feedsec"><div class="wrap"><div class="sec-h"><div><span class="chip cat-community">Live from our readers</span><h2>Community Feed</h2></div><a href="${u('/community/')}">See all</a></div><div class="feedgrid"><div class="feed">${feed(comm.filter((x) => x !== s), 3)}</div>${feedSide()}</div></div></section>${sbScripts}`;
  write((s.community ? 'community/' : 'story/') + s.slug + '/index.html', layout({ title: s.title, desc: s.dek, canon: SITE + href(s).replace(BASE, ''), image: u(`/img/og/${s.slug}.png`), type: 'article', body: html, extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` }));
}

// writer pages: every reader who has published gets a page with their name and all their stories
const writers = {}; for (const s of comm) (writers[wslug(s)] = writers[wslug(s)] || []).push(s);
for (const [k, list] of Object.entries(writers)) {
  const w = list[0];
  write(`writers/${k}/index.html`, layout({ title: w.author + ' on Tech na Pesa', desc: `Stories by ${w.author}${w.county ? ' from ' + w.county : ''} on Tech na Pesa.`, canon: `${SITE}/writers/${k}/`, on: 'community',
    body: `<div class="pagehead cat-community"><div class="wrap" style="display:flex;gap:22px;align-items:center">${avatarHtml(w, 104)}<div><span class="chip">Tech na Pesa writer</span><h1>${esc(w.author)}</h1><p>${w.county ? esc(w.county) + ' &middot; ' : ''}${list.length} published ${list.length === 1 ? 'story' : 'stories'}</p></div></div></div><section><div class="wrap"><div class="feedgrid"><div class="feed">${list.map(post).join('')}</div>${feedSide()}</div></div></section>${sbScripts}` }));
}
// scam checker and radar
write('scam-checker/index.html', layout({ title: 'Scam Checker and Scam Radar', desc: 'Paste a suspicious SMS, WhatsApp or email and see the warning signs in one second. Then warn other Kenyans on Scam Radar.', canon: SITE + '/scam-checker/', on: 'checker',
  body: `<div class="pagehead cat-scams"><div class="wrap"><span class="chip">Free tool</span><h1>Scam Checker</h1><p>Paste any message you are unsure about. We highlight the tricks fraudsters use. Nothing you paste here leaves your phone unless you choose to report it.</p></div></div>
<section><div class="wrap two"><div class="panel"><label for="msg">Paste the message</label><textarea id="msg" placeholder="Example: Dear customer, you have won KSh 50,000. Send KSh 500 processing fee to claim..."></textarea>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="check">Check this message</button><button class="btn ghost" style="color:var(--ink)" id="clear">Clear</button></div>
<div id="result" hidden><div class="meter"><i id="bar"></i></div><div id="verdict" style="font-family:var(--head);font-size:22px;font-weight:700"></div><div id="marked"></div><div class="flags" id="flags"></div>
<p class="hint">This checker looks for common warning signs. It is a guide, not a guarantee: a message with no flags can still be a scam. When in doubt, call the company on its official number, never the number in the message.</p>
<button class="btn gold" id="report" style="margin-top:6px">Warn others on Scam Radar</button><div id="rstatus"></div></div></div>
<div class="panel"><h2 style="font-family:var(--head);margin:0 0 10px">Golden rules</h2><ol style="padding-left:20px;margin:0"><li>Safaricom will never ask for your M-PESA PIN.</li><li>Real reversals come only from Safaricom's Reversal channel, never a phone call.</li><li>No genuine job asks you to pay to be hired.</li><li>Government recruitment and services are announced on official .go.ke sites.</li><li>If it is urgent, secret and about money, stop and check.</li></ol></div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-h"><h2>Scam Radar</h2><span class="hint">Messages reported by readers, checked by our editors. Phone numbers and names are hidden.</span></div><div class="radar" id="radar"><div class="empty" style="grid-column:1/-1">Loading reports...</div></div></div></section>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script><script src="${u('/config.js')}"></script><script src="${u('/community.js')}"></script><script src="${u('/checker.js')}"></script>` }));

// community feed, write, join, me
const sb = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script><script src="${u('/config.js')}"></script><script src="${u('/community.js')}"></script>`;
write('community/index.html', layout({ title: 'Community Feed', desc: 'Stories by Kenyans about money, hustles, tech and beating scams, reviewed by our editors.', canon: SITE + '/community/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Community</span><h1>Community Feed</h1><p>Real experiences with money, hustles, tech and scams, by Kenyans for Kenyans. Every story is reviewed before it goes live.</p></div></div>
<section class="feedsec"><div class="wrap"><div class="feedgrid"><div class="feed">${feed(comm, 200)}</div>${feedSide()}</div></div></section>${sbScripts}` }));
write('write/index.html', layout({ title: 'Share your story', canon: SITE + '/write/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Community</span><h1>Share your story</h1><p>Write about a hustle, a money lesson, a scam you beat or a tool that helps. Our editors review every story, usually within a few hours.</p></div></div>
<section><div class="wrap two"><div class="panel" id="writer"><div class="note info">Loading...</div></div><div class="panel"><h2 style="font-family:var(--head);margin:0 0 10px">What gets published</h2><ul style="padding-left:20px;margin:0"><li>True, first hand experiences and useful tips.</li><li>Clear writing in English, at least 80 words.</li><li>No naming or accusing private people, no phone numbers.</li><li>No promotions, referral links or get rich quick schemes.</li><li>No hate, insults or politics of division.</li></ul><p class="hint">Full details in our <a href="${u('/rules/')}" style="text-decoration:underline">community rules</a>.</p></div></div></section>${sb}` }));
write('join/index.html', layout({ title: 'Join Tech na Pesa', canon: SITE + '/join/', on: 'community',
  body: `<section><div class="wrap" style="max-width:520px"><div class="panel" id="joiner"><div class="note info">Loading...</div></div></div></section>${sb}` }));
write('me/index.html', layout({ title: 'My stories', canon: SITE + '/me/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Your account</span><h1>My stories</h1><p>See the status of everything you have shared.</p></div></div><section><div class="wrap" id="mine"><div class="note info">Loading...</div></div></section>${sb}` }));

// money tools
{
  const m = TOOLS.mpesa || { bands: [] }, f = TOOLS.fuel || {}, r = RATES;
  const srcs = (a) => (a || []).map((x) => `<a href="${esc(x.url)}" rel="noopener nofollow">${esc(x.name)}</a>`).join(', ');
  write('tools/index.html', layout({ title: 'Money Tools: M-PESA charges, fuel prices and exchange rates', desc: 'Work out M-PESA charges before you send, and see today\'s fuel prices and the shilling exchange rate.', canon: SITE + '/tools/', on: 'tools',
    body: `<div class="pagehead cat-money"><div class="wrap"><span class="chip">Free tools</span><h1>Money Tools</h1><p>Know the cost before you send, fuel or change money. Checked against official figures, with dates.</p></div></div>
<section><div class="wrap two"><div class="panel" id="calc"><h2 class="h2s">M-PESA charge calculator</h2><label>Amount in KSh</label><input id="amt" type="number" inputmode="numeric" min="1" max="250000" placeholder="e.g. 2,500">
<div class="calc-out" id="cout"><div><small>Send to an M-PESA user</small><b id="o1">KSh 0</b></div><div><small>Withdraw at an agent</small><b id="o2">KSh 0</b></div><div><small>Total if you send and they withdraw</small><b id="o3">KSh 0</b></div></div>
<p class="hint">${esc(m.note || '')} Checked ${m.checked ? fmt(m.checked) : ''}. Sources: ${srcs(m.sources)}.</p>
<details><summary>See the full tariff table</summary><table class="tt"><tr><th>Amount (KSh)</th><th>Send</th><th>Withdraw</th></tr>${m.bands.map((x) => `<tr><td>${x[0].toLocaleString('en-KE')} to ${x[1].toLocaleString('en-KE')}</td><td>${x[2] ? x[2] : 'Free'}</td><td>${x[3] == null ? 'Not allowed' : x[3]}</td></tr>`).join('')}</table></details></div>
<div><div class="panel" id="fuel"><h2 class="h2s">Fuel prices, ${esc(f.town || 'Nairobi')}</h2><div class="fuel"><div><small>Super petrol</small><b>${f.petrol ? ksh(f.petrol) : ''}</b></div><div><small>Diesel</small><b>${f.diesel ? ksh(f.diesel) : ''}</b></div><div><small>Kerosene</small><b>${f.kerosene ? ksh(f.kerosene) : ''}</b></div></div><p class="hint">Per litre, ${f.from ? fmt(f.from) : ''} to ${f.to ? fmt(f.to) : ''}. ${esc(f.note || '')} Source: ${srcs(f.sources)}.</p>
<label>Litres you need</label><input id="lit" type="number" inputmode="decimal" min="1" placeholder="e.g. 20"><div class="hint" id="litout"></div></div>
<div class="panel" id="rates" style="margin-top:22px"><h2 class="h2s">Shilling exchange rates</h2>${r ? `<div class="fuel"><div><small>1 US dollar</small><b>${ksh(r.usd)}</b></div><div><small>1 euro</small><b>${ksh(r.eur)}</b></div><div><small>1 British pound</small><b>${ksh(r.gbp)}</b></div></div><p class="hint">Market rates for ${fmt(r.date)} from <a href="${esc(r.url)}" rel="noopener nofollow">${esc(r.source)}</a>. Banks and forex bureaus add their own margin. 1 KSh buys about ${r.ugx} Uganda shillings and ${r.tzs} Tanzania shillings.</p>` : '<p class="hint">Rates refresh every day. Check back shortly.</p>'}</div></div></div></section>
<script>window.TNP_TARIFF=${JSON.stringify(m.bands)};window.TNP_FUEL=${JSON.stringify({ petrol: f.petrol, diesel: f.diesel })};</script>` }));
}
// challenges
const fmtT = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi' });
function howChosen(c) {
  const J = c.judges || [], K = c.criteria || [], w = c.voteWeight == null ? 0.3 : c.voteWeight;
  if (!J.length) return `<div class="panel" style="margin-top:22px"><h2 class="h2s">How the winner is chosen</h2><p style="margin:0">The entry with the most free public votes when voting closes wins, after our fairness check.</p></div>`;
  return `<div class="panel" style="margin-top:22px"><h2 class="h2s">How the winner is chosen</h2>
<div class="split"><div><b>${Math.round((1 - w) * 100)}%</b><small>Judges' scores</small></div><div><b>${Math.round(w * 100)}%</b><small>Free public votes</small></div></div>
${K.length ? `<h3 class="h3s">What the judges look for</h3><ul class="crit">${K.map((k) => `<li><span>${esc(k.name)}</span><b>${k.weight}%</b>${k.about ? `<small>${esc(k.about)}</small>` : ''}</li>`).join('')}</ul>` : ''}
<h3 class="h3s">The judges</h3><div class="judges">${J.map((j) => `<div><span class="avatar pp" style="width:40px;height:40px;box-shadow:none">${initial(j.name)}</span><span><b>${esc(j.name)}</b><small>${esc(j.role || '')}</small></span></div>`).join('')}</div>
<p class="hint">Plus a <b>People's Choice</b> award for the entry with the most votes${c.peoplesPrize ? ': ' + esc(c.peoplesPrize) : ''}.</p></div>`;
}
const entryHref = (e) => u(`/challenges/${e.challenge}/${e.slug}/`);
const sponsorBlock = (c) => c.sponsor ? `<a class="sponsor" href="${esc(c.sponsor.url || '#')}" rel="noopener sponsored">${c.sponsor.logo ? `<img src="${u('/' + c.sponsor.logo)}" alt="">` : ''}<span><small>Sponsored by</small><b>${esc(c.sponsor.name)}</b></span></a>` : '';
const entryCard = (e, c) => `<div class="ecard" data-entry="${esc(e.id)}"><a href="${entryHref(e)}">${e.photo ? `<img loading="lazy" src="${u('/' + e.photo)}" alt="">` : `<img class="noph" loading="lazy" src="${u('/img/cards/' + e.slug + '.png')}" alt="">`}</a><div class="ein"><div class="eby">${avatarHtml(e, 34)}<span><b>${esc(e.author)}</b><small>${esc(e.county || '')}</small></span></div><a href="${entryHref(e)}" class="et">${esc(e.title)}</a>
<div class="evote"><span class="vc" data-votes="${esc(e.id)}">0 votes</span>${['entries', 'voting'].includes(chState(c)) ? `<button class="btn" data-vote="${esc(e.id)}" data-challenge="${esc(c.slug)}">Vote</button>` : ''}</div></div></div>`;
write('challenges/index.html', layout({ title: 'Challenges', desc: 'Monthly challenges for Kenyans: show your work, get votes from friends and win prizes from our sponsors.', canon: SITE + '/challenges/', on: 'challenges',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Win prizes</span><h1>Tech na Pesa Challenges</h1><p>Every month, a new challenge. Show your work, get your friends to vote, and win prizes from our sponsors. Entry is always free.</p><p style="margin-top:16px"><a class="btn gold" href="${u('/sponsor/')}">Sponsor a challenge</a></p></div></div>
<section><div class="wrap">${CHALLENGES.length ? `<div class="grid">${CHALLENGES.map((c) => { const st = chState(c), n = ENTRIES.filter((e) => e.challenge === c.slug).length; return `<a class="card chcard" href="${u('/challenges/' + c.slug + '/')}"><div class="chtop st-${st}"><span>${{ soon: 'Opens ' + fmtT(c.opens), entries: 'Open for entries', voting: 'Voting open', closed: 'Closed' }[st]}</span><b>${esc(c.prize || '')}</b></div><div class="in"><h3>${esc(c.title)}</h3><p>${esc(c.short || c.brief || '')}</p><span class="meta">${n} ${n === 1 ? 'entry' : 'entries'}${c.sponsor ? ' &middot; Sponsored by ' + esc(c.sponsor.name) : ''}</span></div></a>`; }).join('')}</div>`
    : `<div class="empty"><h3 style="font-family:var(--head);color:var(--ink);margin:0 0 6px">Our first challenge is on the way</h3>Follow Tech na Pesa on Facebook to hear the moment it opens. Are you a company or institution? <a href="${u('/sponsor/')}" style="text-decoration:underline">Sponsor the first one</a>.</div>`}</div></section>` }));
for (const c of CHALLENGES) {
  const st = chState(c), list = ENTRIES.filter((e) => e.challenge === c.slug);
  const winner = c.result && c.result.winner ? list.find((e) => e.slug === c.result.winner) : null;
  write(`challenges/${c.slug}/index.html`, layout({ title: c.title, desc: (c.short || c.brief || '').slice(0, 160), canon: `${SITE}/challenges/${c.slug}/`, on: 'challenges', image: c.image ? u('/' + c.image) : null,
    body: `<div class="pagehead cat-community chhead"><div class="wrap"><div><span class="chip">${{ soon: 'Coming soon', entries: 'Open for entries', voting: 'Voting open', closed: 'Challenge closed' }[st]}</span><h1>${esc(c.title)}</h1><p>${esc(c.brief || '')}</p>
<div class="chfacts"><div><small>Prize</small><b>${esc(c.prize || '')}</b></div><div><small>Entries close</small><b>${fmtT(c.entriesClose)}</b></div><div><small>Voting closes</small><b>${fmtT(c.votingCloses)}</b></div></div>
<div class="countdown" data-until="${esc(st === 'soon' ? c.opens : st === 'entries' ? c.entriesClose : c.votingCloses)}" data-label="${st === 'soon' ? 'Opens in' : st === 'entries' ? 'Entries close in' : 'Voting closes in'}"></div></div>${sponsorBlock(c)}</div></div>
${c.result && c.result.peoplesChoice && c.result.peoplesChoice !== c.result.winner ? (() => { const p = list.find((e) => e.slug === c.result.peoplesChoice); return p ? `<section style="padding-bottom:0"><div class="wrap"><a class="winner" href="${entryHref(p)}">${avatarHtml(p, 56)}<div><span class="chip" style="color:#2fe6a7">People's Choice</span><h3>${esc(p.title)}</h3><p>By ${esc(p.author)}${p.county ? ', ' + esc(p.county) : ''}</p></div></a></div></section>` : ''; })() : ''}
${winner ? `<section style="padding-bottom:0"><div class="wrap"><a class="winner" href="${entryHref(winner)}">${avatarHtml(winner, 64)}<div><span class="chip" style="color:#f4b631">Winner</span><h3>${esc(winner.title)}</h3><p>By ${esc(winner.author)}${winner.county ? ', ' + esc(winner.county) : ''} &middot; ${(c.result.top[0] || {}).votes || ''} votes</p></div></a></div></section>` : ''}
<section><div class="wrap two"><div><div class="sec-h"><h2>Entries</h2><span class="hint">${list.length} so far</span></div>${list.length ? `<div class="egrid">${list.map((e) => entryCard(e, c)).join('')}</div>` : '<div class="empty">No entries yet. Be the first!</div>'}</div>
<div><div class="panel" id="enter" data-enter="${esc(c.slug)}" data-photo="${c.needsPhoto ? 1 : 0}" data-state="${st}"><h2 class="h2s">How to take part</h2><ol class="rules">${(c.howTo || ['Create a free Tech na Pesa account.', 'Submit your entry below. Our editors check it, usually within an hour.', 'Once approved, share your entry link on WhatsApp and Facebook so friends can vote. Voting is always free.', (c.judges || []).length ? 'When voting closes, the judges\' scores and the public votes are combined to pick the winner.' : 'The entry with the most votes when voting closes wins.']).map((x) => `<li>${esc(x)}</li>`).join('')}</ol><div id="enterbox"></div></div>
${howChosen(c)}<div class="panel" style="margin-top:22px"><h2 class="h2s">${(c.judges || []).length ? 'People\'s Choice leaderboard' : 'Leaderboard'}</h2><div data-board-ch="${esc(c.slug)}"><div class="hint">Loading votes...</div></div></div>
<div class="panel" style="margin-top:22px"><h2 class="h2s">Rules</h2><ul class="rules">${(c.rules || []).concat(['Entry is free. Open to people in Kenya.', 'One entry per person. Voting is free: one vote per account, and you can move your vote until voting closes.', 'You cannot vote for yourself. Votes that look fake or bought are removed, and entries that cheat are disqualified.', 'Winners are checked by Tech na Pesa before prizes are handed over' + (c.sponsor ? ' by ' + c.sponsor.name : '') + '.']).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div></div></section>${sbScripts}` }));
  if ((c.judges || []).length) write(`challenges/${c.slug}/judge/index.html`, layout({ title: 'Judges: ' + c.title, canon: `${SITE}/challenges/${c.slug}/judge/`, on: 'challenges', extraHead: '<meta name="robots" content="noindex">',
    body: `<div class="pagehead"><div class="wrap"><span class="chip">Judges only</span><h1>${esc(c.title)}: scoring</h1><p>Enter the private code you received. Score each entry from 1 to 10 on each point. Scores save as you go and stay private until results are announced.</p></div></div>
<section><div class="wrap" id="judge" data-ch="${esc(c.slug)}" data-crit='${esc(JSON.stringify((c.criteria && c.criteria.length ? c.criteria : [{ name: 'Overall', weight: 100 }]).map((k) => k.name)))}'><div class="panel" style="max-width:520px"><label>Judge code</label><input id="jcode" autocomplete="off"><button class="btn" id="jgo" style="margin-top:14px">Open scoring</button><div id="jst"></div></div>
<div id="jlist" hidden>${list.map((e) => `<div class="panel jentry" data-id="${esc(e.id)}"><div class="jhead">${e.photo ? `<img src="${u('/' + e.photo)}" alt="">` : ''}<div><b>${esc(e.title)}</b><small>${esc(e.author)}${e.county ? ', ' + esc(e.county) : ''} &middot; <a href="${entryHref(e)}" target="_blank" rel="noopener" style="text-decoration:underline">open entry</a></small></div></div><div class="jcrit"></div></div>`).join('') || '<div class="empty">No approved entries yet.</div>'}</div></div></section>${sbScripts}` }));
  for (const e of list) {
    const url = `${SITE}/challenges/${c.slug}/${e.slug}/`, ask = `Please vote for my entry "${e.title}" in the ${c.title} on Tech na Pesa. It takes one minute: ${url}`;
    write(`challenges/${c.slug}/${e.slug}/index.html`, layout({ title: `Vote for ${e.author}: ${e.title}`, desc: `${e.author} entered the ${c.title}. Vote now.`, canon: url, on: 'challenges', image: u('/img/og/' + e.slug + '.png'), type: 'article',
      body: `<article class="art"><a class="chip cat-community" href="${u('/challenges/' + c.slug + '/')}">${esc(c.title)}</a><h1>${esc(e.title)}</h1><div class="byline">${avatarHtml(e, 44)}<span>Entry by <b>${esc(e.author)}</b>${e.county ? ', ' + esc(e.county) : ''}</span></div>
<div class="cover">${e.photo ? `<img src="${u('/' + e.photo)}" alt="">` : `<img src="${u('/img/cards/' + e.slug + '.png')}" alt="">`}</div>
<div class="bigvote" data-entry="${esc(e.id)}"><div><b data-votes="${esc(e.id)}">0 votes</b><small>${{ soon: '', entries: 'Voting is open', voting: 'Voting closes ' + fmtT(c.votingCloses), closed: 'Voting has closed' }[st]}</small></div>${['entries', 'voting'].includes(st) ? `<button class="btn gold" data-vote="${esc(e.id)}" data-challenge="${esc(c.slug)}">Vote for ${esc(String(e.author).split(' ')[0])}</button>` : ''}</div>
<div class="share"><a class="wa" href="https://wa.me/?text=${encodeURIComponent(ask)}" rel="noopener">${ICON.wa}Ask friends on WhatsApp</a><a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" rel="noopener">${ICON.fb}Facebook</a><button data-copy="${esc(url)}">${ICON.link}Copy link</button></div>
<div class="body">${bodyHtml(e.body || [])}</div>${sponsorBlock(c)}<p><a href="${u('/challenges/' + c.slug + '/')}" style="text-decoration:underline">See all entries in ${esc(c.title)}</a></p></article>${sbScripts}` }));
  }
}
// sponsor page: how companies and institutions sponsor a challenge
write('sponsor/index.html', layout({ title: 'Sponsor a challenge', desc: 'Put your brand in front of thousands of engaged Kenyans by sponsoring a Tech na Pesa challenge.', canon: SITE + '/sponsor/', on: 'challenges',
  body: `<div class="pagehead cat-money"><div class="wrap"><span class="chip">For companies and institutions</span><h1>Sponsor a challenge</h1><p>Your brand at the centre of a month of creativity. Entrants share their entries with friends on WhatsApp and Facebook, and every share carries your name.</p></div></div>
<section><div class="wrap two"><div><div class="panel"><h2 class="h2s">What you get</h2><ul class="rules"><li>Your name and logo on the challenge page, every entry page and every vote link shared on WhatsApp.</li><li>A challenge theme built around your brand or cause, for example best small business idea, best savings tip, best tech innovation by students.</li><li>Launch, reminder and winner posts on the Tech na Pesa Facebook Page.</li><li>A short report at the end: entries, votes, page visits and shares.</li><li>A seat on the judging panel for someone from your organisation, scoring on criteria you help set.</li><li>Free public voting, so your brand is linked to fair play, never to pay to win.</li><li>Your team can present the prize to the winner, with photos for your own channels.</li></ul></div>
<div class="panel" style="margin-top:22px"><h2 class="h2s">Who it suits</h2><p style="margin:0">Banks, SACCOs, fintechs, telcos, phone and electronics shops, colleges and universities, county programmes, NGOs and any brand that wants young, digital Kenyans to know it.</p></div></div>
<div class="panel" id="sponsorform"><h2 class="h2s">Talk to us</h2><p class="hint" style="margin-top:0">Leave your details and we will call you back with options and prices.</p><label>Company or institution</label><input id="sf_c" maxlength="120"><label>Your name</label><input id="sf_n" maxlength="80"><label>Phone or email</label><input id="sf_p" maxlength="120"><label>What would you like to sponsor? (optional)</label><textarea id="sf_m" maxlength="1500" style="min-height:110px"></textarea><button class="btn" id="sf_go" style="margin-top:14px">Send</button><div id="sf_st"></div></div></div></section>${sbScripts}` }));

// monthly prize
write('prize/index.html', layout({ title: 'Story of the Month: win KSh 500', desc: 'The best rated reader story every month wins KSh 500 sent by M-PESA.', canon: SITE + '/prize/', on: 'community',
  body: `<div class="pagehead cat-money"><div class="wrap"><span class="chip">Monthly prize</span><h1>Story of the Month: KSh 500</h1><p>Every month, the reader story with the best star rating wins KSh 500, sent by M-PESA. You, the readers, choose the winner.</p><p style="margin-top:16px"><a class="btn gold" href="${u('/write/')}">Write your story</a></p></div></div>
<section><div class="wrap two"><div class="panel"><h2 class="h2s">This month's leaderboard</h2><div id="board"><div class="hint">Loading ratings...</div></div></div>
<div class="panel"><h2 class="h2s">How it works</h2><ol class="rules"><li>Publish a reader story on Tech na Pesa during the month.</li><li>Readers rate stories from 1 to 5 stars. Writers cannot rate their own stories, and accounts must be at least 3 days old to rate.</li><li>On the 1st of the next month, the story with the highest average rating wins, as long as at least 5 readers rated it. Ties go to the story with more ratings.</li><li>We contact the winner by email to confirm their M-PESA number, then send KSh 500.</li><li>One prize per month. Open to readers in Kenya. Stories or ratings that look fake or bought are disqualified.</li></ol></div></div></section>
${WINNERS.length ? `<section style="padding-top:0"><div class="wrap"><div class="sec-h"><h2>Past winners</h2></div><div class="feed" style="max-width:720px">${WINNERS.slice().reverse().map((w) => { const s = comm.find((x) => x.slug === w.slug); return s ? post(s) : ''; }).join('')}</div></div></section>` : ''}${sbScripts}` }));

// legal pages
const page = (slug, title, paras) => write(slug + '/index.html', layout({ title, canon: `${SITE}/${slug}/`, body: `<article class="art"><h1>${title}</h1><div class="body">${bodyHtml(paras)}</div></article>` }));
page('rules', 'Community rules', [
  'Tech na Pesa is a place for useful, honest stories about tech, money and digital life in Kenya. These rules keep it that way.',
  { h: 'We publish' }, { list: ['First hand experiences, lessons and practical tips.', 'Warnings about scams, described without naming or exposing private individuals.', 'Respectful opinions about products and services.'] },
  { h: 'We do not publish' }, { list: ['Accusations against named private people, or anyone\'s phone number, ID or address.', 'Advertising, referral links, pyramid schemes, betting tips or promises of quick riches.', 'Hate speech, incitement, insults or content that targets any community.', 'Graphic violence, sexual content or anything involving children that is not appropriate.', 'Stories copied from other websites or written by someone else.'] },
  { h: 'How review works' }, 'Every story and Scam Radar report is checked before it goes live. We may correct spelling or shorten a story, and we may decline it without giving detailed reasons. You can ask us to remove your published story at any time from your account page.',
]);
page('privacy', 'Privacy policy', [
  'This policy explains what Tech na Pesa collects and why, in line with the Kenya Data Protection Act, 2019.',
  { h: 'What we collect' }, { list: ['Reading the site: no account is needed, and we do not sell any data.', 'When you create an account: your email address, the display name you choose and, if you wish, your county.', 'When you share a story or a Scam Radar report: the text and any photo you upload.', 'The Scam Checker runs on your own phone. Messages you check are not sent to us unless you press "Warn others on Scam Radar".'] },
  { h: 'How we use it' }, { list: ['To publish your stories with the display name you choose.', 'To contact you about your stories or your account.', 'To keep the community safe, including reviewing content before it goes live.'] },
  { h: 'Your rights' }, 'You can see, correct or delete your stories from your account page, and you can ask us to delete your account and data at any time through our Facebook Page. We keep data only as long as your account exists or the law requires.',
  { h: 'Where data is stored' }, 'Accounts and community stories are stored with our database provider, Supabase, on secure servers. Reports shown on Scam Radar have phone numbers and personal names removed.',
]);
page('terms', 'Terms of use', [
  'By using Tech na Pesa you agree to these terms.',
  { list: ['Our newsroom stories are information, not financial, legal or investment advice. Check with a qualified professional before making money decisions.', 'You own the stories you write. By publishing them here you allow Tech na Pesa to display, share and lightly edit them on the website and our social media pages, with credit to your display name.', 'You must only share content you have the right to share, and it must follow our community rules.', 'We may remove content or close accounts that break the rules.', 'Tech na Pesa links to other websites as sources; we are not responsible for their content.'] },
]);
write('404.html', layout({ title: 'Page not found', body: `<section><div class="wrap" style="text-align:center;padding:60px 0"><h1 style="font-family:var(--head);font-size:44px;margin:0">Page not found</h1><p style="color:var(--muted)">The page may have moved. Try the latest stories instead.</p><a class="btn" href="${u('/')}">Go to the home page</a></div></section>` }));

// feed, sitemap, robots
const all = news.concat(comm).sort((a, b) => String(b.date).localeCompare(a.date));
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Tech na Pesa</title><link>${SITE}/</link><description>Tech, money and digital life in Kenya</description>${all.slice(0, 30).map((s) => `<item><title>${esc(s.title)}</title><link>${SITE}${href(s).replace(BASE, '')}</link><guid>${SITE}${href(s).replace(BASE, '')}</guid><pubDate>${new Date(s.date).toUTCString()}</pubDate><description>${esc(s.dek || '')}</description></item>`).join('')}</channel></rss>`);
const urls = ['/', '/challenges/', '/sponsor/', '/tools/', '/prize/', '/scam-checker/', '/community/', '/write/', '/rules/', '/privacy/', '/terms/'].concat(Object.keys(CATS).map((k) => `/c/${k}/`)).concat(all.map((s) => href(s).replace(BASE, ''))).concat(Object.keys(writers).map((k) => `/writers/${k}/`));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((x) => `<url><loc>${SITE}${x}</loc></url>`).join('')}</urlset>`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /me/\nSitemap: ${SITE}/sitemap.xml\n`);
if (process.env.CNAME) write('CNAME', process.env.CNAME + '\n');
console.log(`built ${news.length} newsroom and ${comm.length} community stories`);
