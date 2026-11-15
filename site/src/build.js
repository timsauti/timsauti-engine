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
const news = read(path.join(ROOT, 'content', 'stories')).sort((a, b) => String(b.date).localeCompare(a.date));
const comm = read(path.join(ROOT, 'content', 'community')).map((s) => Object.assign({ community: true }, s)).sort((a, b) => String(b.date).localeCompare(a.date));
const img = (s) => u(`/img/cards/${s.slug}.png`);
const href = (s) => u(s.community ? `/community/${s.slug}/` : `/story/${s.slug}/`);

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
  const nav = [['tech', 'Tech'], ['money', 'Money'], ['scams', 'Scam Alerts'], ['hustles', 'Hustles and Jobs'], ['howto', 'How To']].map(([k, n]) => `<a href="${u('/c/' + k + '/')}"${on === k ? ' class="on"' : ''}>${n}</a>`).join('')
    + `<a href="${u('/scam-checker/')}"${on === 'checker' ? ' class="on"' : ''}>Scam Checker</a><a href="${u('/community/')}"${on === 'community' ? ' class="on"' : ''}>Community</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t)}</title><meta name="description" content="${esc(d)}"><link rel="canonical" href="${esc(canon || SITE + '/')}">
<meta property="og:site_name" content="Tech na Pesa"><meta property="og:title" content="${esc(title || 'Tech na Pesa')}"><meta property="og:description" content="${esc(d)}">
<meta property="og:image" content="${esc(ogi)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:type" content="${type || 'website'}"><meta property="og:url" content="${esc(canon || SITE + '/')}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#07142a">
<link rel="icon" href="${u('/img/icon.png')}"><link rel="alternate" type="application/rss+xml" title="Tech na Pesa" href="${u('/feed.xml')}">
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
<div><h4>Join in</h4><a href="${u('/write/')}">Share your story</a><a href="${u('/scam-checker/')}">Scam Checker and Radar</a><a href="${u('/community/')}">Community stories</a><a href="${FB}" rel="noopener">Facebook</a><a href="${u('/feed.xml')}">RSS feed</a></div></div>
<div class="legal">&copy; ${new Date().getFullYear()} Tech na Pesa. Information, not financial advice. <a style="display:inline" href="${u('/rules/')}">Community rules</a> &middot; <a style="display:inline" href="${u('/privacy/')}">Privacy</a> &middot; <a style="display:inline" href="${u('/terms/')}">Terms</a></div></div></footer>
<script>window.TNP_BASE=${JSON.stringify(BASE)};</script><script src="${u('/app.js')}" defer></script></body></html>`;
}

const card = (s) => `<a class="card cat-${s.community ? 'community' : s.cat}" href="${href(s)}"><img loading="lazy" src="${img(s)}" alt=""><div class="in"><span class="chip">${s.community ? 'Community' : CATS[s.cat].name}</span><h3>${esc(s.title)}</h3><p>${esc(s.dek || '')}</p><span class="meta">${fmt(s.date)}${s.community ? ' &middot; by ' + esc(s.author) : ''}</span></div></a>`;

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
for (const f of ['app.js', 'community.js', 'checker.js']) fs.copyFileSync(path.join(__dirname, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'config.js'), `window.TNP_CONFIG=${JSON.stringify({ url: process.env.SUPABASE_URL || '', key: process.env.SUPABASE_ANON_KEY || '', base: BASE })};`);

// home
const lead = news.find((s) => s.featured) || news[0];
const rest = news.filter((s) => s !== lead);
const home = `
<div class="hero"><div class="wrap hero-grid">
<a class="lead cat-${lead.cat}" href="${href(lead)}"><img src="${img(lead)}" alt=""><div class="txt"><span class="chip">${CATS[lead.cat].name}</span><h1>${esc(lead.title)}</h1><p>${esc(lead.dek)}</p></div></a>
<div class="side">${rest.slice(0, 4).map((s) => `<a class="mini cat-${s.cat}" href="${href(s)}"><img src="${img(s)}" alt=""><div><span class="chip">${CATS[s.cat].name}</span><h3>${esc(s.title)}</h3></div></a>`).join('')}</div>
</div></div>
<section><div class="wrap"><div class="sec-h"><h2>Latest</h2><a href="${u('/c/tech/')}">All sections</a></div><div class="grid">${news.slice(0, 6).map(card).join('')}</div></div></section>
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
  const by = s.community ? `<div class="byline"><span class="avatar">${esc((s.author || '?').slice(0, 1).toUpperCase())}</span><span>By <b>${esc(s.author)}</b>${s.county ? ', ' + esc(s.county) : ''} &middot; ${fmt(s.date)} &middot; Community story</span></div>` : `<div class="byline"><span class="avatar">T</span><span>Tech na Pesa newsroom &middot; ${fmt(s.date)}</span></div>`;
  const html = `<article class="art cat-${s.community ? 'community' : s.cat}"><span class="chip">${s.community ? 'Community' : CATS[s.cat].name}</span><h1>${esc(s.title)}</h1>${s.dek ? `<p class="dek">${esc(s.dek)}</p>` : ''}${by}
<div class="cover"><img src="${img(s)}" alt=""></div>${shareBar(s)}<div class="body">${bodyHtml(s.body)}</div>${s.q ? `<div class="ask">${esc(s.q)}</div>` : ''}${shareBar(s)}
${s.sources && s.sources.length ? `<div class="src">Sources: ${s.sources.map((x) => `<a href="${esc(x.url)}" rel="noopener nofollow">${esc(x.name)}</a>`).join(', ')}</div>` : ''}
${s.community ? `<div class="note info">This story was written by a member of the Tech na Pesa community and reviewed by our editors before publishing. Views are the writer's own. <a href="${u('/write/')}" style="text-decoration:underline">Share yours</a>.</div>` : ''}</article>
<section style="padding-top:20px"><div class="wrap"><div class="sec-h"><h2>Read next</h2></div><div class="grid">${related.map(card).join('')}</div></div></section>`;
  write((s.community ? 'community/' : 'story/') + s.slug + '/index.html', layout({ title: s.title, desc: s.dek, canon: SITE + href(s).replace(BASE, ''), image: u(`/img/og/${s.slug}.png`), type: 'article', body: html, extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` }));
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
write('community/index.html', layout({ title: 'Community stories', desc: 'Stories by Kenyans about money, hustles, tech and beating scams, reviewed by our editors.', canon: SITE + '/community/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Community</span><h1>Stories by Kenyans, for Kenyans</h1><p>Real experiences with money, hustles, tech and scams. Every story is reviewed before it goes live.</p><p style="margin-top:16px"><a class="btn" href="${u('/write/')}">Share your story</a></p></div></div>
<section><div class="wrap">${comm.length ? `<div class="grid">${comm.map(card).join('')}</div>` : `<div class="empty"><h3 style="font-family:var(--head);color:var(--ink);margin:0 0 6px">Be the first voice here</h3>The community opens with your story. <a href="${u('/write/')}" style="text-decoration:underline">Write one now</a>.</div>`}</div></section>` }));
write('write/index.html', layout({ title: 'Share your story', canon: SITE + '/write/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Community</span><h1>Share your story</h1><p>Write about a hustle, a money lesson, a scam you beat or a tool that helps. Our editors review every story, usually within a few hours.</p></div></div>
<section><div class="wrap two"><div class="panel" id="writer"><div class="note info">Loading...</div></div><div class="panel"><h2 style="font-family:var(--head);margin:0 0 10px">What gets published</h2><ul style="padding-left:20px;margin:0"><li>True, first hand experiences and useful tips.</li><li>Clear writing in English, at least 80 words.</li><li>No naming or accusing private people, no phone numbers.</li><li>No promotions, referral links or get rich quick schemes.</li><li>No hate, insults or politics of division.</li></ul><p class="hint">Full details in our <a href="${u('/rules/')}" style="text-decoration:underline">community rules</a>.</p></div></div></section>${sb}` }));
write('join/index.html', layout({ title: 'Join Tech na Pesa', canon: SITE + '/join/', on: 'community',
  body: `<section><div class="wrap" style="max-width:520px"><div class="panel" id="joiner"><div class="note info">Loading...</div></div></div></section>${sb}` }));
write('me/index.html', layout({ title: 'My stories', canon: SITE + '/me/', on: 'community',
  body: `<div class="pagehead cat-community"><div class="wrap"><span class="chip">Your account</span><h1>My stories</h1><p>See the status of everything you have shared.</p></div></div><section><div class="wrap" id="mine"><div class="note info">Loading...</div></div></section>${sb}` }));

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
const urls = ['/', '/scam-checker/', '/community/', '/write/', '/rules/', '/privacy/', '/terms/'].concat(Object.keys(CATS).map((k) => `/c/${k}/`)).concat(all.map((s) => href(s).replace(BASE, '')));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((x) => `<url><loc>${SITE}${x}</loc></url>`).join('')}</urlset>`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /me/\nSitemap: ${SITE}/sitemap.xml\n`);
if (process.env.CNAME) write('CNAME', process.env.CNAME + '\n');
console.log(`built ${news.length} newsroom and ${comm.length} community stories`);
