// One-off actions the owner asks for, run from GitHub (Actions, "Manage a post").
// ACTION=hide   TARGET=<facebook post id>   hides a post from the Page (reversible: ACTION=unhide brings it back)
// ACTION=post   TARGET=<id in data/<page>/posts.json>   publishes that prepared post now, even while the agent is paused
// PAGE=makasa|timsauti
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), GV = 'v26.0';
const PAGES = { timsauti: { pageId: '394580017413619', token: process.env.TIMSAUTI_PAGE_TOKEN, tags: ['Timsauti', 'TimsautiDigitalAgency'] },
  makasa: { pageId: '351919135654247', token: process.env.MAKASA_PAGE_TOKEN, tags: ['Makasa', 'AuthorMakasa', 'MakasatheAuthor', 'TimSauti'] },
  sauti: { pageId: '1859768287449730', token: process.env.SAUTI_PAGE_TOKEN, tags: ['sautimedia'] },
  cornerstone: { pageId: '104576991675007', token: '', tags: ['CornerstoneRehab', 'Machakos'] } };   // client Page (owner, 9 Nov); its key comes from the owner's Facebook login
const mask = (s) => String(s || '').replace(/access_token=[^&"\s]+/g, 'access_token=***').replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***');
const { ACTION, TARGET, PAGE } = process.env;
const page = PAGES[PAGE]; if (!page) { console.log('Unknown page'); process.exit(1); }
let auth;
const audit = (o) => fs.appendFileSync(path.join(ROOT, 'data', PAGE, 'audit.jsonl'), JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o)) + '\n');
(async () => {
  if (!page.token && process.env.FB_USER_TOKEN) {   // get the Page key from the owner's long lived user key
    const r = await fetch(`https://graph.facebook.com/${GV}/me/accounts?limit=100&fields=id,name,access_token`, { headers: { Authorization: 'Bearer ' + process.env.FB_USER_TOKEN }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({})); const m = (j.data || []).find((x) => x.id === page.pageId || (PAGE === 'sauti' && /sauti media/i.test(x.name || ''))); if (m) { page.token = m.access_token; page.pageId = m.id; }
    audit({ event: 'pages_seen', pages: (j.data || []).map((x) => (x.name || '') + ' ' + x.id) });
    if (!m) { audit({ event: 'page_key_missing', error: mask(JSON.stringify(j.error || 'page not in list')).slice(0, 200) }); console.log('no page key'); process.exit(1); }
  }
  if (!page.token) { console.log('missing token'); process.exit(1); }
  auth = { Authorization: 'Bearer ' + page.token };
  if (ACTION === 'hide' || ACTION === 'unhide') {
    const id = String(TARGET).trim(); if (!/^\d+_\d+$/.test(id) || !id.startsWith(page.pageId + '_')) { console.log('Post id must look like ' + page.pageId + '_123'); process.exit(1); }
    const tries = ACTION === 'hide' ? [{ is_published: 'false' }, { is_hidden: 'true' }, { timeline_visibility: 'hidden' }] : [{ is_published: 'true' }, { is_hidden: 'false' }, { timeline_visibility: 'normal' }];
    let r, j, used; const errors = [];
    for (const t of tries) {
      r = await fetch(`https://graph.facebook.com/${GV}/${id}`, { method: 'POST', headers: auth, body: new URLSearchParams(t), signal: AbortSignal.timeout(60000) });
      j = await r.json().catch(() => ({})); used = Object.keys(t)[0];
      console.log(ACTION + ' via ' + used + ': ' + r.status + ' ' + mask(JSON.stringify(j)).slice(0, 300));
      if (r.ok) break; errors.push(used + ': ' + mask(JSON.stringify((j && j.error) || j)).slice(0, 250));
    }
    const c = await fetch(`https://graph.facebook.com/${GV}/${id}?fields=is_published,is_hidden,permalink_url`, { headers: auth, signal: AbortSignal.timeout(60000) });
    const cj = await c.json().catch(() => ({}));
    console.log('Check: ' + mask(JSON.stringify(cj)).slice(0, 300));
    audit({ event: ACTION, target: id, ok: r.ok, via: r.ok ? used : null, errors, check: { is_published: cj.is_published, is_hidden: cj.is_hidden, error: cj.error ? mask(JSON.stringify(cj.error)).slice(0, 200) : undefined } });
    if (!r.ok) process.exit(1);
  } else if (ACTION === 'post') {
    const file = path.join(ROOT, 'data', PAGE, 'posts.json'); const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    const p = posts.find((x) => x.id === String(TARGET).trim()); if (!p) { console.log('No such prepared post'); process.exit(1); }
    if (p.status === 'PUBLISHED') { console.log('Already published: ' + p.permalink); return; }
    if (Array.isArray(p.extra) && p.extra.length) {
      // owner, 12 Nov: a story can carry several photos. The poster goes first, then the owner's other photos, as one post.
      const ids = [];
      for (const f of [p.image.file].concat(p.extra)) {
        const fd1 = new FormData(); const png = /\.png$/i.test(f);
        fd1.append('source', new Blob([require('./strip').strip(fs.readFileSync(path.join(ROOT, f)))], { type: png ? 'image/png' : 'image/jpeg' }), path.basename(f)); fd1.append('published', 'false');
        const r1 = await fetch(`https://graph.facebook.com/${GV}/${page.pageId}/photos`, { method: 'POST', headers: auth, body: fd1, signal: AbortSignal.timeout(120000) });
        const j1 = await r1.json().catch(() => ({})); if (!r1.ok || !j1.id) { console.log('Failed photo: ' + mask(JSON.stringify(j1)).slice(0, 300)); process.exit(1); } ids.push(j1.id);
      }
      const body = new URLSearchParams(); body.append('message', p.caption + '\n\n' + page.tags.map((h) => '#' + h).join(' '));
      ids.forEach((id, i) => body.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
      const r = await fetch(`https://graph.facebook.com/${GV}/${page.pageId}/feed`, { method: 'POST', headers: auth, body, signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) { p.status = 'FAILED'; p.error = mask(JSON.stringify(j)).slice(0, 300); console.log('Failed: ' + p.error); fs.writeFileSync(file, JSON.stringify(posts, null, 1)); process.exit(1); }
      p.status = 'PUBLISHED'; p.publishedAt = new Date().toISOString(); p.fb = { postId: j.id, photoId: ids[0] }; p.permalink = 'https://www.facebook.com/' + j.id;
      fs.writeFileSync(file, JSON.stringify(posts, null, 1)); audit({ event: 'published_by_owner_request', id: p.id, fb: p.fb });
      console.log('Published: ' + p.permalink); return;
    }
    const fd = new FormData();
    fd.append('source', new Blob([require('./strip').strip(fs.readFileSync(path.join(ROOT, p.image.file)))], { type: 'image/png' }), p.id + '.png');
    fd.append('message', p.caption + '\n\n' + page.tags.map((h) => '#' + h).join(' '));
    const at = p.bookAt ? Date.parse(p.bookAt) : 0;   // owner post booked for a set time: Facebook holds it and publishes it then
    if (at > Date.now() + 15 * 60000) { fd.append('published', 'false'); fd.append('scheduled_publish_time', String(Math.floor(at / 1000))); } else fd.append('published', 'true');
    const r = await fetch(`https://graph.facebook.com/${GV}/${page.pageId}/photos`, { method: 'POST', headers: auth, body: fd, signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !(j.post_id || j.id)) { p.status = 'FAILED'; p.error = mask(JSON.stringify(j)).slice(0, 300); console.log('Failed: ' + p.error); fs.writeFileSync(file, JSON.stringify(posts, null, 1)); process.exit(1); }
    p.status = 'PUBLISHED'; p.publishedAt = at > Date.now() + 15 * 60000 ? new Date(at).toISOString() : new Date().toISOString(); if (at > Date.now()) p.bookedOnFacebook = true; p.fb = { postId: j.post_id || null, photoId: j.id || null }; p.permalink = j.post_id ? 'https://www.facebook.com/' + j.post_id : null;
    fs.writeFileSync(file, JSON.stringify(posts, null, 1)); audit({ event: 'published_by_owner_request', id: p.id, fb: p.fb });
    console.log('Published: ' + p.permalink);
  } else if (ACTION === 'history') {
    // read only: the Page's recent posts with their numbers, saved for analysis
    const out = []; let url = `${page.pageId}/posts?limit=50&fields=id,created_time,message,permalink_url,status_type,full_picture,attachments{media_type,type},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)`;
    for (let i = 0; i < 4 && url; i++) {
      const r = await fetch(url.startsWith('http') ? url : `https://graph.facebook.com/${GV}/${url}`, { headers: auth, signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({})); if (!r.ok) { console.log(mask(JSON.stringify(j.error)).slice(0, 300)); break; }
      for (const p of j.data || []) out.push({ id: p.id, at: p.created_time, text: String(p.message || '').slice(0, 1200), type: p.status_type, media: p.attachments && p.attachments.data && p.attachments.data[0] ? p.attachments.data[0].media_type || p.attachments.data[0].type : null, picture: p.full_picture || null, reactions: p.reactions ? p.reactions.summary.total_count : 0, comments: p.comments ? p.comments.summary.total_count : 0, shares: p.shares ? p.shares.count : 0 });
      url = j.paging && j.paging.next ? j.paging.next.replace(/access_token=[^&]+&?/, '') : null;
    }
    fs.writeFileSync(path.join(ROOT, 'data', PAGE, 'history.json'), JSON.stringify(out, null, 1));
    console.log('saved ' + out.length);
  } else if (ACTION === 'otherpage') {
    const LOG = []; const log0 = console.log; console.log = (m) => { LOG.push(String(m)); log0(m); fs.mkdirSync(path.join(ROOT, 'data', 'analysis'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'analysis', 'otherpage_log.txt'), LOG.join('\n')); };
    // read only: find another Page this login manages (by name in TARGET) and save its recent posts with their numbers; keys are never written out
    const me = await (await fetch(`https://graph.facebook.com/${GV}/me?fields=id,name`, { headers: auth })).json().catch(() => ({}));
    console.log('this key belongs to: ' + JSON.stringify({ id: me.id, name: me.name }));
    const want = String(TARGET || '').toLowerCase(); let found = null;
    for (const u of ['me/accounts?limit=100&fields=id,name,access_token,fan_count,followers_count', `${page.pageId}?fields=id`]) {
      const r = await fetch(`https://graph.facebook.com/${GV}/${u}`, { headers: auth }); const j = await r.json().catch(() => ({}));
      if (j.data) { console.log('pages: ' + j.data.map((x) => x.name + ' ' + x.id).join(' | ')); found = j.data.find((x) => x.name.toLowerCase().includes(want)) || null; if (found) break; }
      else console.log('accounts: ' + mask(JSON.stringify(j.error || j)).slice(0, 200));
    }
    let tok = found && found.access_token; let pid = found && found.id;
    if (!found) {   // try reading it directly by its public name
      const r = await fetch(`https://graph.facebook.com/${GV}/pages/search?q=${encodeURIComponent(TARGET)}&fields=id,name`, { headers: auth }); const j = await r.json().catch(() => ({}));
      console.log('search: ' + mask(JSON.stringify(j.data || j.error)).slice(0, 300));
    }
    if (pid) {
      const h = { Authorization: 'Bearer ' + tok }; const out = []; let url = `https://graph.facebook.com/${GV}/${pid}/posts?limit=50&fields=id,created_time,message,status_type,attachments{media_type,type},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)`;
      for (let i = 0; i < 8 && url; i++) {
        const r = await fetch(url, { headers: h }); const j = await r.json().catch(() => ({})); if (!r.ok) { console.log(mask(JSON.stringify(j.error)).slice(0, 300)); break; }
        for (const p of j.data || []) out.push({ id: p.id, at: p.created_time, text: String(p.message || '').slice(0, 800), type: p.status_type, media: p.attachments && p.attachments.data && p.attachments.data[0] ? p.attachments.data[0].media_type || p.attachments.data[0].type : null, reactions: p.reactions ? p.reactions.summary.total_count : 0, comments: p.comments ? p.comments.summary.total_count : 0, shares: p.shares ? p.shares.count : 0 });
        url = j.paging && j.paging.next ? j.paging.next.replace(/access_token=[^&]+&?/, '') : null;
      }
      const info = { name: found.name, id: pid, followers: found.followers_count, fans: found.fan_count, posts: out.length };
      fs.mkdirSync(path.join(ROOT, 'data', 'analysis'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'data', 'analysis', 'otherpage.json'), JSON.stringify({ info, posts: out }, null, 1));
      console.log('saved ' + JSON.stringify(info));
    }
  } else if (ACTION === 'hide_old') {
    // hide the old laptop posts as soon as Facebook publishes them (reversible); the list is data/<page>/old_scheduled.json
    const file = path.join(ROOT, 'data', PAGE, 'old_scheduled.json'); const L = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now() / 1000; let changed = false;
    for (const x of L.pending.slice()) {
      if (x.when && x.when > now) continue;   // not out yet
      const r = await fetch(`https://graph.facebook.com/${GV}/${x.id}`, { method: 'POST', headers: auth, body: new URLSearchParams({ timeline_visibility: 'hidden' }), signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { L.pending = L.pending.filter((y) => y.id !== x.id); L.hidden.push(Object.assign({}, x, { hiddenAt: new Date().toISOString() })); changed = true; audit({ event: 'hid_old_laptop_post', target: x.id }); console.log('hidden ' + x.id); }
      else console.log('could not hide ' + x.id + ' ' + mask(JSON.stringify(j.error)).slice(0, 200));
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(L, null, 1));
  } else if (ACTION === 'scheduled') {
    // read only: posts waiting on Facebook to go out later
    const out = {};
    for (const [k, u] of [['scheduled_posts', `${page.pageId}/scheduled_posts?limit=100&fields=id,message,scheduled_publish_time,created_time`], ['unpublished_photos', `${page.pageId}/photos?type=uploaded&limit=100&fields=id,created_time,name,published,scheduled_publish_time`]]) {
      const r = await fetch(`https://graph.facebook.com/${GV}/${u}`, { headers: auth, signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({}));
      out[k] = r.ok ? (j.data || []).map((x) => ({ id: x.id, when: x.scheduled_publish_time || null, published: x.published, created: x.created_time, text: String(x.message || x.name || '').slice(0, 80) })) : mask(JSON.stringify(j.error)).slice(0, 250);
    }
    fs.writeFileSync(path.join(ROOT, 'data', PAGE, 'scheduled.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify(out).slice(0, 500));
  } else if (ACTION === 'reschedule') {
    // a prepared owner post already booked on Facebook: move it to its new bookAt time and refresh its text
    const file = path.join(ROOT, 'data', PAGE, 'posts.json'); const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    const p = posts.find((x) => x.id === String(TARGET).trim()); if (!p || !p.fbScheduledId) { console.log('No booked post'); process.exit(1); }
    const fd = new URLSearchParams({ message: p.caption + '\n\n' + page.tags.map((h) => '#' + h).join(' '), scheduled_publish_time: String(Math.floor(Date.parse(p.bookAt) / 1000)) });
    const r = await fetch(`https://graph.facebook.com/${GV}/${p.fbScheduledId}`, { method: 'POST', headers: auth, body: fd, signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    audit({ event: 'reschedule', id: p.id, ok: r.ok, at: p.bookAt, error: r.ok ? null : mask(JSON.stringify(j)).slice(0, 300) });
    if (r.ok) { p.publishedAt = new Date(Date.parse(p.bookAt)).toISOString(); fs.writeFileSync(file, JSON.stringify(posts, null, 1)); }
    console.log(r.ok ? 'moved' : 'failed ' + mask(JSON.stringify(j)).slice(0, 300));
  } else if (ACTION === 'reel') {
    // owner Reel: data/<page>/videos/<TARGET>.mp4 with its text in <TARGET>.txt
    const X = require('./extras'); const dir = path.join(ROOT, 'data', PAGE, 'videos');
    const text = fs.readFileSync(path.join(dir, TARGET + '.txt'), 'utf8').trim();
    let r = null, err = null; try { r = await X.publishReel(page, path.join(dir, TARGET + '.mp4'), text); } catch (e) { err = mask(e.message).slice(0, 300); }
    audit({ event: r ? 'owner_reel_posted' : 'owner_reel_failed', target: TARGET, fb: r, error: err });
    if (r) { const pf = path.join(ROOT, 'data', PAGE, 'posts.json'); const posts = JSON.parse(fs.readFileSync(pf, 'utf8')); posts.push({ id: 'p_reel_' + TARGET, page: PAGE, category: 'OWNER', owner: true, headline: text.split('\n')[0].slice(0, 120), caption: text, status: 'PUBLISHED', publishedAt: new Date().toISOString(), fb: Object.assign({ kind: 'reel' }, r), permalink: r.permalink || null }); fs.writeFileSync(pf, JSON.stringify(posts, null, 1)); }
    console.log(r ? 'posted' : 'failed ' + err);
  } else if (ACTION === 'video') {
    // owner video: data/<page>/videos/<TARGET>.mp4 with its text in <TARGET>.txt, posted now as a Page video
    const dir = path.join(ROOT, 'data', PAGE, 'videos'); const file = path.join(dir, TARGET + '.mp4');
    const text = fs.readFileSync(path.join(dir, TARGET + '.txt'), 'utf8').trim();
    const fd = new FormData(); fd.append('source', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), TARGET + '.mp4'); fd.append('description', text); fd.append('published', 'true');
    const r = await fetch(`https://graph-video.facebook.com/${GV}/${page.pageId}/videos`, { method: 'POST', headers: auth, body: fd, signal: AbortSignal.timeout(300000) });
    const j = await r.json().catch(() => ({}));
    audit({ event: r.ok && j.id ? 'owner_video_posted' : 'owner_video_failed', target: TARGET, videoId: j.id || null, error: r.ok ? null : mask(JSON.stringify(j)).slice(0, 300) });
    const pf = path.join(ROOT, 'data', PAGE, 'posts.json'); const posts = JSON.parse(fs.readFileSync(pf, 'utf8'));
    if (r.ok && j.id) { posts.push({ id: 'p_vid_' + TARGET, page: PAGE, category: 'OWNER', owner: true, headline: text.split('\n')[0].slice(0, 120), caption: text, status: 'PUBLISHED', publishedAt: new Date().toISOString(), fb: { videoId: j.id, kind: 'video' }, permalink: 'https://www.facebook.com/' + j.id, firstComment: { skipped: 'owner video' } }); fs.writeFileSync(pf, JSON.stringify(posts, null, 1)); }
    console.log(r.ok ? 'posted ' + j.id : 'failed ' + mask(JSON.stringify(j)).slice(0, 300));
  } else if (ACTION === 'models') {
    // read only: which Gemini models this key can use, and a one word test of each
    const key = process.env.GEMINI_API_KEY; const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }); const j = await r.json().catch(() => ({}));
    const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
    const test = {};
    for (const m of names.filter((n) => /flash|gemma/.test(n)).slice(0, 25)) { const t = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say ok' }] }] }) }); test[m] = t.status; }
    fs.writeFileSync(path.join(ROOT, 'data', 'models.json'), JSON.stringify({ names, test }, null, 1)); console.log(JSON.stringify(test));
  } else if (ACTION === 'wittest') {
    // writes Makasa wit cards without posting: TARGET = how many
    process.env.SELFTEST = '1'; const R = require('./run'); const page = R.PAGES.find((p) => p.key === 'makasa'); const posts = R.load('makasa'); const out = [];
    for (let i = 0; i < (Number(TARGET) || 2); i++) { const p = await R.write(page, posts.concat(out), Date.now() + 86400000, 'W'); out.push(p); }
    fs.writeFileSync(path.join(ROOT, 'data', 'makasa', 'wit_test.json'), JSON.stringify(out.map((p) => ({ status: p.status, wit: p.wit, caption: p.caption, image: p.image && p.image.file })), null, 1)); console.log('ok');
  } else if (ACTION === 'cstest') {
    // TARGET = MON, WED or FRI: writes one Cornerstone draft and its poster without sending or posting anything
    process.env.SELFTEST = '1'; const R = require('./run'); const CS = require('./cornerstone');
    const clean = (x) => String(x || '').replace(/[\u2013\u2014]/g, ',').replace(/\s+,/g, ',').trim();
    const out = [];
    for (const k of String(TARGET).split(',')) { const d = await CS.write(k.trim(), out.map((o) => ({ topic: o.topic })), R.gemini, clean); const f = path.join(ROOT, 'data', 'cornerstone', 'test_' + k.trim() + '.png'); fs.writeFileSync(f, CS.card(d)); out.push(Object.assign({}, d, { image: path.relative(ROOT, f) })); }
    fs.writeFileSync(path.join(ROOT, 'data', 'cornerstone', 'test.json'), JSON.stringify(out, null, 1)); console.log('ok');
  } else if (ACTION === 'csphotos') {
    // calm, hopeful landscape photos (free licences, Wikimedia Commons) for the Cornerstone Friday posters: no faces, no text
    process.env.SELFTEST = '1'; const gem = require('./run').gemini; const crypto = require('crypto');
    const dir = path.join(ROOT, 'data', 'cornerstone', 'hope'); fs.mkdirSync(dir, { recursive: true });
    const idxF = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) {}
    const UA = { 'user-agent': 'TimsautiAgent/1.0 (contact via Facebook Page)' };
    const qs = String(TARGET || 'sunrise Kenya,Mount Kenya sunrise,Machakos hills,Kenya sunset landscape,Lake Nakuru sunrise,Ngong Hills,Kenya highlands morning,Aberdare forest path').split(',');
    for (const q of qs) {
      let n = 0;
      try {
        const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1600&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + q);
        const j = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).json();
        for (const pg of Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index)) {
          if (n >= 2) break; const ii = (pg.imageinfo || [])[0]; if (!ii || !ii.thumburl || ii.mime !== 'image/jpeg' || ii.width < 1600 || ii.width < ii.height) continue;
          if (Object.values(idx).some((v) => v.source === pg.title)) continue;
          const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '').trim();
          const free = /^(cc0|public domain|pd)/i.test(lic), by = /^cc[ -]by(-sa)?( \d|$)/i.test(lic); if (!free && !by) continue;
          const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
          const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA, signal: AbortSignal.timeout(30000) })).arrayBuffer());
          const v = await gem({ system: 'You check photos. Output only JSON.', user: 'Approve only if ALL are true: a beautiful, calm, hopeful real landscape or nature photograph (sunrise, open sky, hills, a path, trees, water); sharp and well exposed; no identifiable faces; no text, logos, signs or watermarks; nothing sad, dark or dangerous. Return JSON {"ok":true|false,"why":"few words"}', audio: { mime: 'image/jpeg', data: buf.toString('base64') } }).catch(() => null);
          console.log(q + ' | ' + pg.title.slice(0, 60) + ' | ' + JSON.stringify(v));
          if (!v || v.ok !== true) continue;
          const k = 'h_' + crypto.createHash('md5').update(pg.title).digest('hex').slice(0, 8); fs.writeFileSync(path.join(dir, k + '.jpg'), buf);
          idx[k] = { file: k + '.jpg', source: pg.title, credit: free ? '' : `Photo: ${artist}, ${lic}`, w: ii.thumbwidth, h: ii.thumbheight }; fs.writeFileSync(idxF, JSON.stringify(idx, null, 1)); n++;
        }
      } catch (e) { console.log(q + ': ' + e.message); }
    }
    console.log('hope photos: ' + Object.keys(idx).length);
  } else if (ACTION === 'grabimg') {
    // TARGET = one article link: saves its main photos (no checks) to data/grab/ so the owner's chosen photo can be prepared by hand
    const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', accept: 'text/html,image/avif,image/webp,image/jpeg,*/*' };
    const dir = path.join(ROOT, 'data', 'grab'); fs.mkdirSync(dir, { recursive: true }); const got = [];
    const h = await (await fetch(TARGET, { headers: UA, signal: AbortSignal.timeout(30000) })).text();
    const urls = [...h.matchAll(/(?:content|src|data-src|srcset)="([^" ]+\.(?:jpe?g|webp|png)[^" ]*)/gi)].map((x) => { try { return new URL(x[1].replace(/&amp;/g, '&'), TARGET).href; } catch (e) { return null; } }).filter(Boolean);
    for (const u of [...new Set(urls)].slice(0, 30)) {
      if (got.length >= 10 || /logo|icon|avatar|favicon|sprite/i.test(u)) continue;
      try { const r = await fetch(u, { headers: { ...UA, referer: TARGET }, signal: AbortSignal.timeout(30000) }); if (!r.ok) continue; const b = Buffer.from(await r.arrayBuffer()); if (b.length < 25000) continue;
        const f = 'g' + got.length + (/\.png/i.test(u) ? '.png' : /\.webp/i.test(u) ? '.webp' : '.jpg'); fs.writeFileSync(path.join(dir, f), b); got.push({ f, u: u.slice(0, 200), size: b.length }); } catch (e) {}
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ at: new Date().toISOString(), from: TARGET, got }, null, 1)); console.log('saved ' + got.length);
  } else if (ACTION === 'grabsite') {
    // TARGET = a website: saves its logo and photos to data/<page>/site/ (used for a client's own posters)
    const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' };
    const base = new URL(TARGET); const dir = path.join(ROOT, 'data', PAGE, 'site'); fs.mkdirSync(dir, { recursive: true });
    const pages = [TARGET]; const seen = new Set(); const got = [];
    try { const h0 = await (await fetch(TARGET, { headers: UA })).text(); for (const m of h0.matchAll(/href="([^"#]+)"/g)) { try { const u = new URL(m[1], base); if (u.host === base.host && !/\.(css|js|png|jpe?g|webp|svg|ico|pdf)$/i.test(u.pathname)) pages.push(u.href); } catch (e) {} } } catch (e) {}
    for (const pg of [...new Set(pages)].slice(0, 15)) {
      let h = ''; try { h = await (await fetch(pg, { headers: UA, signal: AbortSignal.timeout(30000) })).text(); } catch (e) { continue; }
      for (const m of h.matchAll(/(?:src|href|data-src|content)="([^"]+\.(?:png|jpe?g|webp))(?:\?[^"]*)?"/gi)) {
        let u; try { u = new URL(m[1], base).href; } catch (e) { continue; } if (seen.has(u) || got.length >= 60) continue; seen.add(u);
        try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) continue; const b = Buffer.from(await r.arrayBuffer()); if (b.length < 8000) continue;
          const name = (got.length + 1).toString().padStart(2, '0') + '_' + path.basename(new URL(u).pathname).replace(/[^\w.]/g, '_'); fs.writeFileSync(path.join(dir, name), b); got.push({ name, from: u, bytes: b.length }); } catch (e) {}
      }
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(got, null, 1)); console.log(got.length + ' files');
  } else if (ACTION === 'csphotos') {
    // TARGET = "YYYY-MM-DD,YYYY-MM-DD": saves the photos this Page itself uploaded between the two dates to data/<page>/fbphotos/ (read only on Facebook; owner, 11 Nov: reuse the good old photos)
    const [since, until] = String(TARGET).split(',').map((x) => Math.floor(Date.parse(x.trim() + 'T00:00:00Z') / 1000));
    const dir = path.join(ROOT, 'data', PAGE, 'fbphotos'); fs.mkdirSync(dir, { recursive: true }); const got = []; const seen = new Set();
    let url = `https://graph.facebook.com/${GV}/${page.pageId}/photos?type=uploaded&limit=50&since=${since}&until=${until}&fields=id,created_time,name,images`;
    for (let n = 0; url && n < 12 && got.length < 220; n++) {
      const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log('failed ' + mask(JSON.stringify(j.error || j)).slice(0, 300)); audit({ event: 'csphotos_failed', error: mask(JSON.stringify(j.error || j)).slice(0, 200) }); break; }
      for (const p of j.data || []) { if (seen.has(p.id)) continue; seen.add(p.id);
        const im = (p.images || []).slice().sort((a, b) => a.width - b.width).find((x) => x.width >= 1000) || (p.images || []).slice().sort((a, b) => b.width - a.width)[0]; if (!im) continue;
        try { const b = Buffer.from(await (await fetch(im.source, { signal: AbortSignal.timeout(60000) })).arrayBuffer()); if (b.length < 15000) continue;
          const name = String(p.created_time).slice(0, 10) + '_' + p.id + '.jpg'; fs.writeFileSync(path.join(dir, name), b); got.push({ name, id: p.id, date: p.created_time, w: im.width, h: im.height, text: String(p.name || '').slice(0, 160) }); } catch (e) {}
      }
      url = j.paging && j.paging.next ? j.paging.next.replace(/access_token=[^&]+&?/, '') : null;
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(got, null, 1)); console.log(got.length + ' photos');
  } else if (ACTION === 'grabphoto') {
    // TARGET = article link: saves the article's lead photo (og:image) to data/<page>/photos/grab.jpg for an owner poster
    const h = await (await fetch(TARGET, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' } })).text();
    const u = (h.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || h.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1];
    if (u) { const b = Buffer.from(await (await fetch(u.replace(/&amp;/g, '&'))).arrayBuffer()); fs.mkdirSync(path.join(ROOT, 'data', PAGE, 'photos'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', PAGE, 'photos', 'grab.jpg'), b); console.log('saved ' + b.length + ' from ' + u); }
    else console.log('no photo found');
  } else if (ACTION === 'tgpeek') {
    // read only: list Telegram messages still waiting for the agent (does not mark them read)
    const tk = process.env.TELEGRAM_BOT_TOKEN; const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'state.json'), 'utf8'));
    const r = await fetch(`https://api.telegram.org/bot${tk}/getUpdates?offset=${st.tgOffset || 0}&timeout=0`); const j = await r.json().catch(() => ({}));
    const out = (j.result || []).map((u) => ({ id: u.update_id, kind: u.message ? (u.message.photo ? 'photo' : 'text') : u.callback_query ? 'button' : 'other', text: String((u.message && (u.message.text || u.message.caption)) || (u.callback_query && u.callback_query.data) || '').slice(0, 60), date: u.message ? new Date(u.message.date * 1000).toISOString() : null }));
    fs.writeFileSync(path.join(ROOT, 'data', 'tg_peek.json'), JSON.stringify({ offset: st.tgOffset, ok: j.ok, pending: out }, null, 1)); console.log(out.length + ' waiting');
  } else if (ACTION === 'hideobj') {
    // hide a Facebook object of this Page by its own id (for a booked photo that has no post id yet); never deletes
    const out = [];
    for (const t of [{ timeline_visibility: 'hidden' }, { is_hidden: 'true' }, { no_story: 'true' }]) {
      const r = await fetch(`https://graph.facebook.com/${GV}/${String(TARGET).trim()}`, { method: 'POST', headers: auth, body: new URLSearchParams(t), signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({})); out.push(Object.keys(t)[0] + ' ' + r.status + ' ' + mask(JSON.stringify(j)).slice(0, 160)); if (r.ok) break;
    }
    audit({ event: 'hideobj', target: TARGET, results: out }); console.log(out.join('\n'));
  } else if (ACTION === 'phototest') {
    // TARGET = post ids separated by commas: runs the picture test on each and records the scores (nothing is posted)
    process.env.SELFTEST = '1'; const R = require('./run');
    const posts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sauti', 'posts.json'), 'utf8')); const out = [];
    for (const id of String(TARGET).split(',').map((x) => x.trim())) { const p = posts.find((x) => x.id === id); if (!p) continue; const q = JSON.parse(JSON.stringify(p)); q.owner = false; out.push({ id, headline: p.headline, photo: (p.sauti || {}).photo, result: await R.photoMatch(q) }); }
    fs.writeFileSync(path.join(ROOT, 'data', 'photo_test.json'), JSON.stringify({ at: new Date().toISOString(), out }, null, 1)); console.log(out.length + ' tested');
  } else if (ACTION === 'storyphoto') {
    // TARGET = post id: finds that story's own photo in other outlets' reports (checked, logos cut away) and saves it beside the post
    process.env.SELFTEST = '1'; const S = require('./sauti'); const gem = require('./run').gemini;
    const posts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sauti', 'posts.json'), 'utf8')); const p = posts.find((x) => x.id === TARGET);
    const ph = p ? await S.storyPhotos(p.headline, gem, path.join(ROOT, 'data', 'sauti'), [], p.source) : null;
    fs.writeFileSync(path.join(ROOT, 'data', 'story_photo.json'), JSON.stringify({ at: new Date().toISOString(), id: TARGET, file: ph ? path.relative(ROOT, ph.file) : null, credit: ph ? ph.credit : null, notes: S.storyPhotos.last }, null, 1));
    console.log(ph ? 'found ' + path.relative(ROOT, ph.file) : 'none');
  } else if (ACTION === 'leaderphoto') {
    // TARGET = one or more full names separated by commas: finds each leader's photo from recent news and keeps it in the photo bank
    process.env.SELFTEST = '1'; const S = require('./sauti'); const gem = require('./run').gemini;
    const out = {}; for (const n of String(TARGET).split(',').map((x) => x.trim()).filter(Boolean)) { const r = await S.leaderFromNews(n, gem).catch((e) => null); out[n] = r ? path.relative(ROOT, r.file) + ' ' + r.credit : 'not found'; }
    fs.writeFileSync(path.join(ROOT, 'data', 'leader_photos.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
  } else if (ACTION === 'leaderbank') {
    // TARGET = full names separated by commas: fills the bank with up to 6 checked photos of each leader (Commons and news photos)
    process.env.SELFTEST = '1'; const S = require('./sauti'); const gem = require('./run').gemini;
    const out = {}; for (const n of String(TARGET).split(',').map((x) => x.trim()).filter(Boolean)) out[n] = await S.leaderBank(n, gem, 6).catch((e) => 'error ' + String(e.message).slice(0, 80));
    fs.writeFileSync(path.join(ROOT, 'data', 'leader_bank.json'), JSON.stringify({ at: new Date().toISOString(), out, last: S.leaderBank.last }, null, 1)); console.log(JSON.stringify(out));
  } else if (ACTION === 'newsdebug') {
    // TARGET = a Google News link: finds the real article and how much story text the agent can read from it
    const S = require('./sauti'); const real = /news\.google\./.test(TARGET) ? await S.gnResolve(TARGET) : TARGET; const text = real ? await S.articleText(real) : '';
    fs.writeFileSync(path.join(ROOT, 'data', 'news_debug.json'), JSON.stringify({ at: new Date().toISOString(), link: TARGET, real, textLength: text.length, how: S.articleText.last, start: text.slice(0, 300) }, null, 1)); console.log(real || 'not resolved');
  } else if (ACTION === 'tgtest') {
    // sends one short check message to the owner and records Telegram's answer (no secrets recorded)
    const tk = process.env.TELEGRAM_BOT_TOKEN, ow = process.env.TELEGRAM_OWNER_ID;
    const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: ow, text: TARGET || 'Agent check: Telegram is working.' }) });
    const j = await r.json().catch(() => ({}));
    // which bot this key belongs to, and who has written to it lately (read only, nothing marked read), so a wrong key or ID shows at once
    const me = await (await fetch(`https://api.telegram.org/bot${tk}/getMe`)).json().catch(() => ({}));
    const up = await (await fetch(`https://api.telegram.org/bot${tk}/getUpdates?timeout=0`)).json().catch(() => ({}));
    const senders = [...new Set((up.result || []).map((u) => { const m = u.message || (u.callback_query && u.callback_query.message) || {}; const f = u.message ? u.message.from : (u.callback_query || {}).from; return f ? f.id + ' ' + (f.first_name || '') : null; }).filter(Boolean))];
    const ownerLooksLike = /^-?[0-9]{5,15}$/.test(String(ow || '').trim()) ? 'a number (correct)' : (/:/.test(String(ow || '')) ? 'looks like a bot key, not an ID' : 'not a plain number');   // never records the value itself
    fs.writeFileSync(path.join(ROOT, 'data', 'tg_test.json'), JSON.stringify({ at: new Date().toISOString(), ownerSet: !!ow, ownerShape: ownerLooksLike, bot: me.ok ? '@' + me.result.username : 'key not accepted', recentSenders: senders, ok: j.ok, error: j.ok ? null : String(j.description || r.status).slice(0, 200) }, null, 1)); console.log(j.ok ? 'sent' : 'failed');
  } else if (ACTION === 'probe') {
    // read only checks of what this Page key can do; no changes are made
    const get = async (u) => { const r = await fetch(`https://graph.facebook.com/${GV}/${u}`, { headers: auth, signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, j }; };
    const out = {};
    if (TARGET && TARGET.includes('_')) {
      for (const f of ['shares', 'reactions.summary(true).limit(0)', 'comments.summary(true).limit(0)', 'insights.metric(post_impressions_unique)', 'insights.metric(post_media_view)']) { const x = await get(`${TARGET}?fields=${f}`); out['f_' + f.slice(0, 20)] = x.ok ? 'ok ' + JSON.stringify(x.j).slice(0, 160) : mask(JSON.stringify(x.j.error && x.j.error.message)).slice(0, 160); }
    }
    const posts = await get(`${page.pageId}/posts?limit=5&fields=id,created_time,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)`);
    out.posts = posts.ok ? (posts.j.data || []).map((p) => ({ id: p.id, r: p.reactions && p.reactions.summary.total_count, c: p.comments && p.comments.summary.total_count, s: p.shares && p.shares.count })) : mask(JSON.stringify(posts.j.error || posts.j)).slice(0, 250);
    const first = posts.ok && posts.j.data && posts.j.data[0] && posts.j.data[0].id;
    if (first) {
      const cm = await get(`${first}/comments?limit=3&fields=id,message,from,created_time`); out.comments = cm.ok ? 'ok ' + (cm.j.data || []).length : mask(JSON.stringify(cm.j.error)).slice(0, 250);
      for (const m of ['post_impressions_unique', 'post_media_view', 'post_clicks', 'post_reactions_by_type_total']) { const ins = await get(`${first}/insights?metric=${m}`); out['ins_' + m] = ins.ok ? 'ok ' + JSON.stringify(((ins.j.data || [])[0] || {}).values || []).slice(0, 80) : mask(JSON.stringify(ins.j.error && ins.j.error.message)).slice(0, 160); }
    }
    const ap = await get('app?fields=id,name'); out.app = ap.ok ? ap.j : mask(JSON.stringify(ap.j.error)).slice(0, 200);
    const pi = await get(`${page.pageId}?fields=name,followers_count,fan_count`); out.page = pi.ok ? pi.j : mask(JSON.stringify(pi.j.error)).slice(0, 200);
    console.log(JSON.stringify(out));
    audit({ event: 'probe', out });
  } else { console.log('Unknown action'); process.exit(1); }
})();
