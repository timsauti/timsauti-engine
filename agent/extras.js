// Extra services: owner taps on Telegram, comment replies and leads, post results and learning,
// weekly report, share pack for groups, Kenyan calendar hints, evening preview with Block, and Reels.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const tg = require('./tg');
const CAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'calendar.json'), 'utf8'));
const GV = 'v26.0';
const eatNow = (t) => new Date((t || Date.now()) + 3 * 3600000);   // Nairobi clock
const eatDay = (t) => eatNow(t).toISOString().slice(0, 10);
const eatHour = (t) => eatNow(t).getUTCHours();
const mask = (s) => String(s || '').replace(/access_token=[^&"\s]+/g, 'access_token=***').replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***');
const short = () => crypto.randomBytes(3).toString('hex');
const isPermError = (j) => j && j.error && (j.error.code === 10 || j.error.code === 200 || /permission/i.test(j.error.message || ''));

async function graph(page, method, url, body) {
  const r = await fetch(`https://graph.facebook.com/${GV}/${url}`, { method, headers: { Authorization: 'Bearer ' + page.token }, body, signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !j.error, j };
}

// ---------- state shared across runs (data/state.json) ----------
function loadState(ROOT) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'state.json'), 'utf8')); } catch (e) { return {}; } }
function saveState(ROOT, s) { fs.writeFileSync(path.join(ROOT, 'data', 'state.json'), JSON.stringify(s, null, 1)); }
const cFile = (dir) => path.join(dir, 'comments.json');
const loadComments = (dir) => { try { return JSON.parse(fs.readFileSync(cFile(dir), 'utf8')); } catch (e) { return {}; } };
const saveComments = (dir, c) => fs.writeFileSync(cFile(dir), JSON.stringify(c, null, 1));

// ---------- Kenyan calendar and weekday hints for the writer ----------
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return Date.UTC(y, mo - 1, da); }
function occasion(pageKey, ymd) {
  const md = ymd.slice(5), y = +ymd.slice(0, 4), t = Date.parse(ymd + 'T00:00:00Z');
  const out = [];
  if (CAL.fixed[md]) out.push(CAL.fixed[md]);
  const e = easter(y), day = 86400000;
  if (t === e - 2 * day) out.push('Good Friday (public holiday): the cross, sacrifice and grace');
  if (t === e) out.push('Easter Sunday: the resurrection and new life');
  if (t === e + day) out.push('Easter Monday (public holiday): hope and new beginnings');
  for (const s of CAL.seasons) if (md >= s.from && md <= s.to) out.push(s.note);
  const wd = new Date(t).getUTCDay(); const w = (CAL.weekday[pageKey] || {})[wd]; if (w) out.push(w);
  return out;
}
function calendarHint(pageKey, ymd) {
  const o = occasion(pageKey, ymd); if (!o.length) return '';
  return '\n\nContext for the day this post goes out (use only if it fits naturally, never force it, never invent events): ' + o.join('; ') + '.';
}

// ---------- post results: refresh numbers, learn, report ----------
async function refreshMetrics(page, posts, state, notes) {
  const perm = (state.perm = state.perm || {})[page.key] = state.perm[page.key] || {};
  if (perm.metrics === false && Date.now() - (perm.metricsCheckedAt || 0) < 24 * 3600000) return;   // try again once a day
  // posts booked ahead on Facebook get their post id once they are out
  for (const p of posts.filter((x) => x.status === 'PUBLISHED' && x.fb && !x.fb.postId && x.fb.photoId && Date.parse(x.publishedAt) < Date.now() - 10 * 60000).slice(-20)) {
    const g = await graph(page, 'GET', `${p.fb.photoId}?fields=page_story_id`);
    if (g.ok && g.j.page_story_id) { p.fb.postId = g.j.page_story_id; p.permalink = 'https://www.facebook.com/' + g.j.page_story_id; }
  }
  const recent = posts.filter((p) => p.status === 'PUBLISHED' && p.fb && p.fb.postId && Date.now() - Date.parse(p.publishedAt) < 14 * 86400000 && (!p.metrics || Date.now() - Date.parse(p.metrics.at) > 6 * 3600000)).slice(page.key === 'sauti' ? -40 : -12);
  for (const p of recent) {
    const a = await graph(page, 'GET', `${p.fb.postId}?fields=shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)`);
    perm.metricsCheckedAt = Date.now();
    if (!a.ok) { if (isPermError(a.j)) { perm.metrics = false; return; } continue; }
    perm.metrics = true;
    const m = { reactions: (a.j.reactions && a.j.reactions.summary.total_count) || 0, comments: (a.j.comments && a.j.comments.summary.total_count) || 0, shares: (a.j.shares && a.j.shares.count) || 0, at: new Date().toISOString() };
    for (const metric of ['post_impressions_unique', 'post_media_view']) {
      const b = await graph(page, 'GET', `${p.fb.postId}/insights?metric=${metric}`);
      const v = b.ok && b.j.data && b.j.data[0] && b.j.data[0].values && b.j.data[0].values[0] ? b.j.data[0].values[0].value : null;
      if (typeof v === 'number') { m.reach = v; break; }
    }
    m.score = m.reactions + 3 * m.comments + 5 * m.shares + (m.reach ? m.reach / 100 : 0);
    p.metrics = m;
  }
}
// The best recent posts in this category, given to the writer as examples of what the audience liked
function learnedHint(posts, cat) {
  const scored = posts.filter((p) => p.metrics && typeof p.metrics.score === 'number' && Date.now() - Date.parse(p.publishedAt || 0) < 45 * 86400000);
  if (scored.length < 6) return '';
  const best = scored.filter((p) => p.category === cat).sort((a, b) => b.metrics.score - a.metrics.score).slice(0, 3);
  if (!best.length) return '';
  return '\n\nRecent posts in this category that our audience responded to most (learn from their angle, tone and length; never copy them):\n' + best.map((p) => '- ' + String(p.headline).slice(0, 140)).join('\n');
}
async function weeklyReport(pages, loadPosts, state) {
  const now = eatNow(); if (now.getUTCDay() !== 0 || now.getUTCHours() < 18) return;   // Sunday evening
  const wk = eatDay(); if (state.reportDay === wk) return;
  const lines = ['WEEKLY REPORT (' + wk + ')'];
  for (const page of pages) {
    const posts = loadPosts(page.key);
    const week = posts.filter((p) => p.status === 'PUBLISHED' && Date.now() - Date.parse(p.publishedAt) < 7 * 86400000);
    const fans = await graph(page, 'GET', `${page.pageId}?fields=followers_count`);
    const f = fans.ok ? fans.j.followers_count : null;
    const prev = ((state.followers || {})[page.key]);
    (state.followers = state.followers || {})[page.key] = f;
    lines.push('', page.name.toUpperCase(), 'Posts this week: ' + week.length + (f != null ? '   Followers: ' + f + (prev != null ? ' (' + (f - prev >= 0 ? 'up ' : 'down ') + Math.abs(f - prev) + ')' : '') : ''));
    const m = week.filter((p) => p.metrics);
    if (m.length) {
      const sum = (k) => m.reduce((a, p) => a + (p.metrics[k] || 0), 0);
      lines.push('Reactions ' + sum('reactions') + ', comments ' + sum('comments') + ', shares ' + sum('shares') + (sum('reach') ? ', people reached ' + sum('reach') : ''));
      const top = m.slice().sort((a, b) => b.metrics.score - a.metrics.score).slice(0, 3);
      lines.push('Best posts:'); top.forEach((p, i) => lines.push((i + 1) + '. ' + String(p.headline).slice(0, 70) + (p.permalink ? '\n   ' + p.permalink : '')));
      const cats = {}; for (const p of m) { (cats[p.category] = cats[p.category] || []).push(p.metrics.score); }
      const avg = Object.entries(cats).map(([c, a]) => [c, a.reduce((x, y) => x + y, 0) / a.length]).sort((a, b) => b[1] - a[1]);
      if (avg.length > 1) lines.push('Strongest type of post: ' + ({ B: 'education', C: 'services', D: 'questions', F: 'scripture', M: 'motivation', K: 'business ideas' }[avg[0][0]] || avg[0][0]) + '. The agent now writes with these lessons in mind.');
    } else lines.push('Results per post will show here once the Page key has the extra permissions.');
  }
  await tg.send(lines.join('\n'));
  state.reportDay = wk;
}

// ---------- comments: draft replies, flag possible customers ----------
const COMMENT_RULES = {
  timsauti: 'You reply to comments on the Facebook Page of TIMSAUTI DIGITAL AGENCY, a marketing, PR and branding agency in Machakos, Kenya. Replies: warm, short (one to three sentences), British English, plain text, no emojis, no dashes, never use the words "testament" or "whether". Never give prices, promises or invented facts. For anyone asking about services, prices or help, thank them and invite them to call or WhatsApp 0733 566 667 or 0728 245 824. Never mention a website.',
  sauti: 'You reply to comments on SAUTI MEDIA, a local news and community Facebook Page for Machakos and Ukambani. Replies: short (one or two sentences), warm, neutral and respectful, British English only (never Kiswahili or Sheng), plain text, no emojis, no dashes, never "testament" or "whether". Never take political sides, never confirm or add facts about any news story, never argue. Answer what each person actually said. Only when someone offers a news tip or private information, invite them to send the details by private message to the Page.',
  makasa: 'You reply to comments on the Facebook Page of TIMOTHY MAKASA, a Kenyan author, preacher and trainer. Replies: warm, humble, short (one or two sentences), British English, plain text, no emojis, no dashes, never use the words "testament" or "whether". Answer what each person actually said, sincerely, and bless where fitting. Never argue, never give financial or medical advice, never invent facts.'
};
async function scanComments(page, posts, dir, state, gemini, clean) {
  const perm = (state.perm = state.perm || {})[page.key] = state.perm[page.key] || {};
  if (perm.comments === false && Date.now() - (perm.commentsCheckedAt || 0) < 24 * 3600000) return;
  const store = loadComments(dir); const seen = new Set(Object.values(store).map((c) => c.commentId));
  let fresh = 0;
  for (const p of posts.filter((x) => x.status === 'PUBLISHED' && x.fb && x.fb.postId && Date.now() - Date.parse(x.publishedAt) < 5 * 86400000)) {
    const r = await graph(page, 'GET', `${p.fb.postId}/comments?filter=toplevel&order=reverse_chronological&limit=25&fields=id,message,from,created_time`);
    perm.commentsCheckedAt = Date.now();
    if (!r.ok) { if (isPermError(r.j)) { perm.comments = false; break; } continue; }
    perm.comments = true;
    for (const c of r.j.data || []) {
      if (seen.has(c.id) || !c.message || (c.from && String(c.from.id) === page.pageId)) continue;
      seen.add(c.id); if (fresh >= 8) continue; fresh++;
      let d = { type: 'general', reply: '' };
      try {
        const first = String((c.from && c.from.name) || '').split(/\s+/)[0];
        const recentReplies = Object.values(store).filter((x) => x.draft).slice(-12).map((x) => x.draft);
        const ask = (extra) => gemini({ system: COMMENT_RULES[page.key] + ' Output ONLY one JSON object.', user: `THE POST (what the Page said):\n<<<${String(p.caption || p.headline).slice(0, 1500)}>>>\nCOMMENT by ${(c.from && c.from.name) || 'a follower'}:\n<<<${String(c.message).slice(0, 600)}>>>
Write a reply made for THIS comment only, the way a thoughtful human editor would answer this person:
- Respond to what they actually said: pick up their point, their words, their question or their feeling, and answer it directly. If they asked something the post answers, give that answer from the post. If the post does not say, say honestly that we will share more when it is confirmed.
- ${first ? `Address them by first name (${first}) where it feels natural.` : 'No name needed.'}
- Never use empty lines like "Thank you for engaging", "Thanks for your comment", "We appreciate your feedback" or "Stay tuned". No generic praise.
- One or two sentences, natural and warm, different in wording from these recent replies: ${recentReplies.join(' | ').slice(0, 900) || 'none'}
- Mix your replies (owner, 5 Nov): most should be a statement, such as agreeing, adding a fact from the post, or picking up their point; ask a question back only now and then.${recentReplies.slice(-3).filter((r) => /\?\s*$/.test(r)).length >= 1 ? ' This reply must NOT be a question and must not end with a question mark.' : ''}${extra || ''}
Return JSON: {"type":"lead|question|praise|general|negative|spam","reply":"the reply text, or empty for spam"}` });
        d = await ask();
        const GENERIC = /thank(s| you) for (engaging|your comment|your feedback|sharing|following|your support)|we appreciate your|stay tuned|keep following/i;
        if (d && d.reply && GENERIC.test(d.reply)) d = await ask('\n- Your last draft was too generic. Mention something specific from their comment.');
      } catch (e) {}
      const key = short();
      const item = { key, commentId: c.id, postId: p.id, from: (c.from && c.from.name) || '', text: String(c.message).slice(0, 600), type: String(d.type || 'general'), draft: clean(d.reply || ''), status: 'PENDING', at: c.created_time };
      if (item.type === 'spam' || !item.draft) { item.status = 'IGNORED'; store[key] = item; continue; }
      const tag = item.type === 'lead' ? 'POSSIBLE CUSTOMER' : item.type === 'negative' ? 'NEEDS CARE' : 'NEW COMMENT';
      item.tgMsg = await tg.send(`${tag} on ${page.name}\n${item.from || 'Someone'} on "${String(p.headline).slice(0, 80)}":\n"${item.text}"\n\nSuggested reply:\n${item.draft}\n\nTap Reply to post it, or Skip. To use your own words, reply to this message with them.${p.permalink ? '\n' + p.permalink : ''}`, [[['Reply', 'r|' + page.key + '|' + key], ['Skip', 's|' + page.key + '|' + key]]]);
      store[key] = item;
    }
  }
  saveComments(dir, store);
}

// ---------- owner taps and replies on Telegram ----------
async function processTelegram(ctx) {
  const { pages, state, loadPosts, savePosts, dataDir, audit } = ctx;
  const ups = await tg.updates(state.tgOffset || 0);
  for (const u of ups) {
    state.tgOffset = u.update_id + 1;
    try {
      if (u.callback_query) {
        const q = u.callback_query; if (!tg.isOwner(q.from)) continue;
        const [act, pk, id] = String(q.data || '').split('|'); const page = pages.find((p) => p.key === pk);
        if (pk === 'cornerstone' && (act === 'ca' || act === 'cs')) {   // client drafts (Cornerstone): approve or skip
          const st = require('./cornerstone').decide(id, act === 'ca');
          await tg.answer(q.id, st === 'APPROVED' ? 'Approved' : st === 'SKIPPED' ? 'Skipped' : 'Already handled');
          await tg.done(q.message.message_id, st === 'APPROVED' ? 'Approved: goes out on Facebook at 10am (or within the hour if later)' : st === 'SKIPPED' ? 'Skipped' : 'Already handled');
          continue;
        }
        if (pk === 'opp' && (act === 'ow' || act === 'ox')) {   // Opportunity Desk: draft my response, or not for me
          const st = require('../oppdesk/engine').decide(id, act === 'ow');
          const label = st === 'WANTED' ? 'Draft requested: it follows within the hour' : st === 'DRAFTED' ? 'Draft already sent' : st === 'DISMISSED' ? 'Not for me' : 'This notice is no longer on record';
          await tg.answer(q.id, label); if (st !== 'DRAFTED') await tg.done(q.message.message_id, label);
          continue;
        }
        if (!page) { await tg.answer(q.id, ''); continue; }
        if (act === 'n' || act === 'k') {   // Sauti Media draft: approve or skip
          const st = ctx.SAUTI.decide(dataDir(pk), id, act === 'n');
          await tg.answer(q.id, st === 'APPROVED' ? 'Approved' : st === 'SKIPPED' ? 'Skipped' : 'Already handled');
          await tg.done(q.message.message_id, st === 'APPROVED' ? 'Approved: goes out in the next news slot' : st === 'SKIPPED' ? 'Skipped' : 'Already handled');
          if (st === 'APPROVED' || st === 'SKIPPED') audit(pk, { event: 'news_' + st.toLowerCase(), key: id });
          continue;
        }
        if (act === 'o' || act === 'f') {   // owner post: post now (o), or post anyway after the editor check held it (f)
          const posts = loadPosts(pk); const p = posts.find((x) => x.id === id);
          if (!p || !['READY', 'HELD'].includes(p.status)) { await tg.answer(q.id, p && p.status === 'PUBLISHED' ? 'Already posted' : 'Nothing to change'); continue; }
          p.status = 'READY'; p.scheduledAt = new Date().toISOString(); if (act === 'f') p.ownerForced = true;
          savePosts(pk, posts); audit(pk, { event: act === 'f' ? 'owner_post_anyway' : 'owner_post_now', id });
          await tg.answer(q.id, 'Posting now'); await tg.done(q.message.message_id, 'Going out now');
          continue;
        }
        if (act === 'r' || act === 's') {
          const store = loadComments(dataDir(pk)); const c = store[id];
          if (!c || c.status !== 'PENDING') { await tg.answer(q.id, 'Already handled'); continue; }
          if (act === 's') { c.status = 'SKIPPED'; await tg.answer(q.id, 'Skipped'); await tg.done(q.message.message_id, 'Skipped'); }
          else {
            const r = await graph(page, 'POST', `${c.commentId}/comments`, new URLSearchParams({ message: c.draft }));
            if (r.ok) { c.status = 'REPLIED'; c.replyId = r.j.id; audit(pk, { event: 'comment_replied', key: id }); await tg.answer(q.id, 'Reply posted'); await tg.done(q.message.message_id, 'Replied'); }
            else { c.status = 'FAILED'; c.error = mask(JSON.stringify(r.j.error || r.j)).slice(0, 200); await tg.answer(q.id, 'Could not reply'); await tg.send('Could not post that reply: ' + c.error); }
          }
          saveComments(dataDir(pk), store);
        } else if (act === 'b' || act === 'u') {
          const posts = loadPosts(pk); const p = posts.find((x) => x.id === id);
          if (!p) { await tg.answer(q.id, 'Not found'); continue; }
          if (act === 'b' && (p.status === 'READY' || p.status === 'HELD')) { p.status = 'BLOCKED'; audit(pk, { event: 'blocked_by_owner', id }); await tg.answer(q.id, 'Blocked'); await tg.done(q.message.message_id, 'Blocked (tap to undo is below)'); await tg.send('Blocked: ' + String(p.headline).slice(0, 80) + '. The agent will write a replacement.', [[['Undo', 'u|' + pk + '|' + id]]]); }
          else if (act === 'u' && p.status === 'BLOCKED') { p.status = 'READY'; audit(pk, { event: 'unblocked_by_owner', id }); await tg.answer(q.id, 'Back on'); await tg.done(q.message.message_id, 'Back on the schedule'); }
          else await tg.answer(q.id, p.status === 'PUBLISHED' ? 'Already posted' : 'Nothing to change');
          savePosts(pk, posts);
        } else await tg.answer(q.id, '');
      } else if (u.message && tg.isOwner(u.message.from) && /^opp(ortunity)?\s*[:,]/i.test(String(u.message.text || u.message.caption || '').trim())) {
        // an opportunity the owner found himself (for example on LinkedIn): "Opp: <the text or the link>"
        const okIn = require('../oppdesk/engine').inbox(String(u.message.text || u.message.caption || ''));
        await tg.send(okIn ? 'Opportunity received. My assessment follows within the hour.' : 'Send the opportunity as: Opp: then the link, or the full text of the notice.');
      } else if (u.message && tg.isOwner(u.message.from) && /^(sauti|makasa|timsauti)\s+post\b/i.test(String(u.message.caption || u.message.text || '').trim())) {
        // the owner's own poster: "Sauti post: text" with the poster as the photo; polished, booked at the best time, previewed back to him
        const m = u.message; const raw = String(m.caption || m.text || '').trim(); const pk = raw.match(/^(\w+)/)[1].toLowerCase();
        const text = raw.replace(/^(sauti|makasa|timsauti)\s+post\b[:,.\s]*/i, '').trim();
        if (!m.photo || !m.photo.length) { await tg.send('Please send the poster as a photo, with the caption starting ' + pk.charAt(0).toUpperCase() + pk.slice(1) + ' post: and your text.'); }
        else {
          const buf = await tg.fileBuffer(m.photo[m.photo.length - 1].file_id);
          if (buf) {
            const id = 'p_own' + Date.now().toString(36); const dir = path.join(dataDir(pk), 'images'); fs.mkdirSync(dir, { recursive: true });
            const f = path.join(dir, id + '.jpg'); fs.writeFileSync(f, buf);
            // a short "Sauti: ..." note sent just before about the same thing joins this post instead of becoming its own story
            let extra = '';
            try { const nf = path.join(dataDir(pk), 'news.json'); const news = JSON.parse(fs.readFileSync(nf, 'utf8'));
              for (const t of news.filter((x) => x.kind === 'tip' && x.status === 'NEW_TIP' && !x.photo && Date.now() - Date.parse(x.at) < 20 * 60000)) { extra += '\n' + t.text; t.status = 'MERGED'; }
              if (extra) fs.writeFileSync(nf, JSON.stringify(news, null, 1)); } catch (e) {}
            const posts = loadPosts(pk);
            posts.push({ id, page: pk, category: 'OWNER', owner: true, topic: 'owner post', headline: text.split('\n')[0].slice(0, 120) || 'Owner post', rawText: (text + extra).trim().slice(0, 5000), caption: '', hashtags: [], status: 'OWNER_NEW', createdAt: new Date().toISOString(), image: { file: path.relative(ctx.ROOT, f), layout: 'owner' } });
            savePosts(pk, posts); audit(pk, { event: 'owner_post_received', id });
            await tg.send('Got it. The agent is researching the topic, writing the full post and designing the poster where needed. The preview comes to you in a moment with the booked time.');
          }
        }
      } else if (u.message && tg.isOwner(u.message.from) && u.message.text && u.message.reply_to_message && (() => { const t = findTarget(ctx, null, u.message.reply_to_message.message_id); return t && t.p.status === 'NEED_INFO'; })()) {
        // his answer with the missing facts: the post is written again with them
        const tgt = findTarget(ctx, null, u.message.reply_to_message.message_id);
        tgt.p.rawText = (String(tgt.p.rawText || '') + '\n' + String(u.message.text).trim()).slice(0, 5000); tgt.p.status = 'OWNER_NEW';
        ctx.savePosts(tgt.page.key, tgt.posts); audit(tgt.page.key, { event: 'owner_post_info_added', id: tgt.p.id });
        await tg.send('Thank you. The post is being written with these details. The preview comes next.');
      } else if (u.message && tg.isOwner(u.message.from) && u.message.photo && /^photo\s*:/i.test(String(u.message.caption || '').trim())) {
        // "Photo: Wavinya Ndeti" with a picture: adds that leader's photo to the photo bank (owner has the right to use it)
        const name = String(u.message.caption).replace(/^photo\s*:\s*/i, '').trim().slice(0, 60);
        const buf = await tg.fileBuffer(u.message.photo[u.message.photo.length - 1].file_id);
        if (buf && name.split(/\s+/).length >= 2) {
          const dir = path.join(ctx.ROOT, 'data', 'leaders'); fs.mkdirSync(dir, { recursive: true });
          const key = name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '_');
          fs.writeFileSync(path.join(dir, key + '.jpg'), buf);
          const f = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
          idx[key] = { name, file: key + '.jpg', credit: '', owner: true, at: new Date().toISOString() }; fs.writeFileSync(f, JSON.stringify(idx, null, 1));
          await tg.send('Saved to the photo bank: ' + name + '. Stories about ' + name.split(' ')[0] + ' will use this photo.');
        } else await tg.send('Please send the photo with the caption Photo: followed by the full name, for example Photo: Wavinya Ndeti');
      } else if (u.message && tg.isOwner(u.message.from) && /^(hide|edit)\b/i.test(String(u.message.text || '').trim())) {
        // "hide 3", "edit 3: new text", or a reply to a post message with "hide" / "edit: new text"
        const t = String(u.message.text).trim(); const act = t.match(/^(hide|edit)/i)[1].toLowerCase();
        const num = (t.match(/^(?:hide|edit)\s+(\d+)/i) || [])[1]; const replyTo = u.message.reply_to_message && u.message.reply_to_message.message_id;
        const tgt = findTarget(ctx, num, replyTo);
        if (!tgt) { await tg.send('I could not tell which post you mean. Use the number from the evening report, for example: hide 3, or reply to the post message.'); continue; }
        if (act === 'hide') {
          const err = await hidePost(tgt.page, tgt.p); ctx.savePosts(tgt.page.key, tgt.posts); audit(tgt.page.key, { event: err ? 'owner_hide_failed' : 'owner_hide', id: tgt.p.id, error: err });
          await tg.send(err ? 'Could not hide it: ' + err : 'Hidden from ' + tgt.page.name + ': ' + String(tgt.p.headline).slice(0, 80) + ' (hidden, not deleted).');
        } else {
          const nt = t.replace(/^edit\s*\d*\s*[:,.]?\s*/i, '').trim();
          if (nt.length < 20) { await tg.send('Please send the new text after the colon, for example: edit 3: your new text'); continue; }
          if (['READY', 'HELD'].includes(tgt.p.status)) {   // not out yet: just change the text; it is checked again before it goes out
            tgt.p.caption = nt; tgt.p.status = 'READY'; if (Date.parse(tgt.p.scheduledAt) < Date.now()) tgt.p.scheduledAt = new Date().toISOString();
            ctx.savePosts(tgt.page.key, tgt.posts); audit(tgt.page.key, { event: 'owner_edit_before_posting', id: tgt.p.id });
            await tg.send('Text changed. It goes out on ' + tgt.page.name + ' as booked.'); continue;
          }
          const err = await editPost(tgt.page, tgt.p, nt); ctx.savePosts(tgt.page.key, tgt.posts); audit(tgt.page.key, { event: err ? 'owner_edit_failed' : 'owner_edit', id: tgt.p.id, error: err });
          await tg.send(err ? 'Could not change it: ' + err : 'Updated the text on ' + tgt.page.name + '.');
        }
      } else if (u.message && tg.isOwner(u.message.from) && /^timsauti\b/i.test(String(u.message.caption || u.message.text || '').trim())) {
        // real Timsauti work: a photo with a caption starting "Timsauti:"
        const m = u.message; const text = String(m.caption || m.text || '').replace(/^timsauti\b[:,\s-]*/i, '').trim();
        if (!m.photo || !m.photo.length) { await tg.send('Please send the work as a photo, with the caption starting Timsauti: and one line about it.'); }
        else {
          const buf = await tg.fileBuffer(m.photo[m.photo.length - 1].file_id);
          if (buf) {
            const dir = path.join(dataDir('timsauti'), 'work'); fs.mkdirSync(dir, { recursive: true }); const id = 'w_' + Date.now().toString(36); const f = path.join(dir, id + '.jpg'); fs.writeFileSync(f, buf);
            const lf = path.join(dataDir('timsauti'), 'work.json'); let list = []; try { list = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch (e) {}
            list.push({ id, at: new Date().toISOString(), text: text.slice(0, 2000), photo: path.relative(ctx.ROOT, f), status: 'NEW' }); fs.writeFileSync(lf, JSON.stringify(list, null, 1));
            await tg.send('Got it. This work will be the next Timsauti post at 1pm, as a Reel.');
          }
        }
      } else if (u.message && tg.isOwner(u.message.from) && /^kamba\s*[:,]/i.test(String(u.message.text || u.message.caption || '').trim())) {
        // a Kikamba post the owner copied from a Kamba outlet's Facebook Page: translated, written up and sent back for his Approve
        const m = u.message; const raw = String(m.text || m.caption || '').replace(/^kamba\s*[:,]\s*/i, '').trim();
        let shot = null;
        if (m.photo && m.photo.length) { const buf = await tg.fileBuffer(m.photo[m.photo.length - 1].file_id); if (buf) shot = buf.toString('base64'); }
        const nf = path.join(dataDir('sauti'), 'news.json'); let news = []; try { news = JSON.parse(fs.readFileSync(nf, 'utf8')); } catch (e) {}
        news.push({ key: 'kt_' + Date.now().toString(36), kind: 'kambatip', status: 'NEW_KAMBA', at: new Date().toISOString(), text: raw.slice(0, 5000), shot });
        fs.writeFileSync(nf, JSON.stringify(news, null, 1));
        await tg.send('Got the Kamba post. It is being translated and written up; the English version comes back to you to approve.');
      } else if (u.message && tg.isOwner(u.message.from) && ctx.SAUTI && ctx.SAUTI.isSautiTip(u.message)) {
        await ctx.SAUTI.saveTip(u.message, ctx);
      } else if (u.message && tg.isOwner(u.message.from) && isStoryMessage(u.message, state)) {
        await saveStory(u.message, ctx);
      } else if (u.message && tg.isOwner(u.message.from) && u.message.reply_to_message && u.message.text) {
        // owner wrote his own reply to a comment card
        const mid = u.message.reply_to_message.message_id;
        for (const page of pages) {
          const store = loadComments(dataDir(page.key)); const c = Object.values(store).find((x) => x.tgMsg === mid && x.status === 'PENDING');
          if (!c) continue;
          const text = String(u.message.text).trim().slice(0, 1500);
          const r = await graph(page, 'POST', `${c.commentId}/comments`, new URLSearchParams({ message: text }));
          if (r.ok) { c.status = 'REPLIED'; c.draft = text; c.replyId = r.j.id; audit(page.key, { event: 'comment_replied_own_words', key: c.key }); await tg.done(mid, 'Replied with your words'); }
          else { c.status = 'FAILED'; c.error = mask(JSON.stringify(r.j.error || r.j)).slice(0, 200); await tg.send('Could not post your reply: ' + c.error); }
          saveComments(dataDir(page.key), store);
        }
      }
    } catch (e) { try { audit('sauti', { event: 'telegram_update_error', update: u.update_id, error: String(e && e.message).slice(0, 200) }); } catch (x) {} }   // one bad update must not stop the run, but it is recorded
  }
}

// ---------- evening preview of tomorrow's posts with a Block button ----------
async function eveningPreview(page, posts, ROOT) {
  if (eatHour() < 18) return false;
  const tomorrow = eatDay(Date.now() + 86400000);
  const list = posts.filter((p) => p.status === 'READY' && !p.previewed && eatDay(Date.parse(p.scheduledAt)) === tomorrow).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  if (!list.length) return false;
  if (!posts.some((p) => p.previewed && eatDay(Date.parse(p.scheduledAt)) === tomorrow)) await tg.send(`Tomorrow on ${page.name}: ${list.length} post${list.length > 1 ? 's' : ''}. Tap Block on any you do not want; the rest go out as planned.`);
  for (const p of list) {
    const time = eatNow(Date.parse(p.scheduledAt)).toISOString().slice(11, 16);
    const id = await tg.photo(path.join(ROOT, p.image.file), `${time}${p.format === 'reel' ? ' (Reel)' : ''}\n\n${p.caption}`, [[['Block', 'b|' + page.key + '|' + p.id]]]);
    if (id || !tg.on()) p.previewed = true;
  }
  return true;
}

// ---------- morning share pack for groups (Timsauti) ----------
async function sharePack(page, posts, state, gemini, clean) {
  if (page.key !== 'timsauti' || eatHour() < 8) return;
  const today = eatDay(); state.share = state.share || {};
  if (state.share[page.key] === today) return;
  const pub = posts.filter((p) => p.status === 'PUBLISHED' && p.permalink && eatDay(Date.parse(p.publishedAt)) === today);
  const p = pub.find((x) => x.category === 'B') || pub[0]; if (!p) return;
  let d = {};
  try {
    d = await gemini({ system: 'You write short, natural one or two sentence introductions a person types when sharing a Facebook post into a group. British English, plain text, no emojis, no dashes, no hashtags, never "testament" or "whether", no hype, no selling, sound like a helpful member, end with a light question when natural. Output ONLY one JSON object.', user: `Post headline: "${String(p.headline).slice(0, 200)}"\nPost text: "${String(p.caption).slice(0, 700)}"\nReturn JSON: {"business":"for business owner groups","machakos":"for Machakos and Ukambani community groups","entrepreneurs":"for young entrepreneurs and hustlers groups","jobs":"for jobs, skills and careers groups"}` });
  } catch (e) { return; }
  const lines = ['SHARE PACK FOR TODAY', 'Post: ' + String(p.headline).slice(0, 90), p.permalink, '', 'Share to 5 to 8 groups today, a few minutes apart, using the intro that fits each group:'];
  for (const [k, label] of [['business', 'Business owner groups'], ['machakos', 'Machakos and Ukambani groups'], ['entrepreneurs', 'Young entrepreneurs groups'], ['jobs', 'Jobs and skills groups']]) if (d[k]) lines.push('', label + ':', clean(d[k]));
  if (await tg.send(lines.join('\n'))) state.share[page.key] = today;
}

// ---------- Reels: turn the poster into a 10 second vertical video and post it ----------
function makeReel(png, out) {
  let ff = 'ffmpeg'; try { ff = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
  const vf = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:4,eq=brightness=-0.18[bg];" +
    "[1:v]scale=2160:-2,zoompan=z='min(1+0.00013*on,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=300:s=1080x1350:fps=30[fg];" +
    "[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[v]";
  cp.execFileSync(ff, ['-y', '-loglevel', 'error', '-loop', '1', '-t', '10', '-i', png, '-i', png, '-f', 'lavfi', '-t', '10', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', vf, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', '-c:a', 'aac', '-b:a', '64k', '-t', '10', '-movflags', '+faststart', out], { timeout: 180000 });
  return out;
}
async function publishReel(page, file, message) {
  const size = fs.statSync(file).size;
  const s = await graph(page, 'POST', `${page.pageId}/video_reels`, new URLSearchParams({ upload_phase: 'start' }));
  if (!s.ok || !s.j.video_id) throw new Error('reel start ' + mask(JSON.stringify(s.j.error || s.j)).slice(0, 200));
  const vid = s.j.video_id;
  const up = await fetch(`https://rupload.facebook.com/video-upload/${GV}/${vid}`, { method: 'POST', headers: { Authorization: 'OAuth ' + page.token, offset: '0', file_size: String(size) }, body: fs.readFileSync(file), signal: AbortSignal.timeout(180000) });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || uj.success === false) throw new Error('reel upload ' + mask(JSON.stringify(uj)).slice(0, 200));
  const f = await graph(page, 'POST', `${page.pageId}/video_reels`, new URLSearchParams({ upload_phase: 'finish', video_id: vid, video_state: 'PUBLISHED', description: message }));
  if (!f.ok || f.j.success === false) throw new Error('reel finish ' + mask(JSON.stringify(f.j.error || f.j)).slice(0, 200));
  let postId = null, permalink = null, status = null;
  for (let i = 0; i < 12; i++) {   // up to about 2 minutes for Facebook to process it
    await new Promise((r) => setTimeout(r, 10000));
    const c = await graph(page, 'GET', `${vid}?fields=status,post_id,permalink_url`);
    if (c.ok) { status = c.j.status; postId = c.j.post_id || postId; permalink = c.j.permalink_url ? (c.j.permalink_url.startsWith('http') ? c.j.permalink_url : 'https://www.facebook.com' + c.j.permalink_url) : permalink; }
    const st = status && status.video_status; const ph = status && status.publishing_phase && status.publishing_phase.status;
    if (st === 'error') throw new Error('reel processing error ' + mask(JSON.stringify(status)).slice(0, 200));
    if (ph === 'complete' || (st === 'ready' && postId)) break;
  }
  return { videoId: vid, postId, permalink: permalink || 'https://www.facebook.com/reel/' + vid, state: status && status.video_status };
}

// ---------- owner stories: a daily question on Telegram; his reply (text or voice note) becomes a post in his style ----------
const QUESTIONS = [
  'What happened to you this week that taught you something?',
  'Tell me about a teacher, pastor or elder who shaped you. What did they do or say?',
  'What is one memory from your days at Kyevaluki or in the village that still makes you smile?',
  'Share a moment from ministry or a crusade that you will never forget.',
  'What did a customer, client or stranger do recently that surprised you?',
  'What is one lesson about money you learnt the hard way?',
  'Tell me about a place in Ukambani with a story people should know.',
  'What is something your parents did that you now understand better?',
  'Which mistake in business or work taught you the most?',
  'What did you see on the road, in a matatu or at the market this week that made you think?',
  'Tell me about a friend who stood with you when things were hard.',
  'What is one thing you wish young people knew before age 25?',
  'Share a funny moment from your life that people would enjoy.',
  'What is one Bible verse that carried you through a hard season, and what was the season?',
  'Tell me about a small business owner you admire. What do they do differently?'
];
function isStoryMessage(m, state) {
  if (m.voice || m.audio) return true;
  const t = String(m.text || '').trim(); if (!t || t.startsWith('/')) return false;
  if (m.reply_to_message && state.storyQ && m.reply_to_message.message_id === state.storyQ.msg) return true;
  return !m.reply_to_message && t.length >= 60;   // a longer message sent on its own is treated as a story
}
async function saveStory(m, ctx) {
  const { dataDir, gemini } = ctx; const file = path.join(dataDir('makasa'), 'stories.json');
  let list = []; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let text = String(m.text || m.caption || '').trim();
  const v = m.voice || m.audio;
  if (v) {
    const buf = await tg.fileBuffer(v.file_id);
    if (!buf) { await tg.send('I could not open that voice note. Please send it again, or type it.'); return; }
    try {
      const d = await gemini({ system: 'You transcribe voice notes from a Kenyan speaker who mixes English, Kiswahili and Kikamba. Output ONLY one JSON object.', user: 'Transcribe this voice note faithfully, keeping Kiswahili and Kikamba words as spoken. Return JSON: {"text":"the transcription"}', audio: { mime: v.mime_type || 'audio/ogg', data: buf.toString('base64') } });
      text = String(d.text || '').trim();
    } catch (e) { await tg.send('I could not understand that voice note. Please try again or type it.'); return; }
  }
  if (text.length < 20) return;
  list.push({ id: 's_' + Date.now().toString(36), at: new Date().toISOString(), question: ctx.state.storyQ ? ctx.state.storyQ.q : '', text: text.slice(0, 6000), status: 'NEW' });
  fs.writeFileSync(file, JSON.stringify(list, null, 1));
  await tg.send('Got it, thank you. I will write this up in your style and send it to you before it goes out.');
}
async function storyQuestion(state) {
  if (eatHour() < 8) return; const today = eatDay(); if (state.storyQ && state.storyQ.day === today) return;
  const n = (state.storyQ && typeof state.storyQ.n === 'number' ? state.storyQ.n + 1 : 0) % QUESTIONS.length;
  const q = QUESTIONS[n];
  const msg = await tg.send('STORY QUESTION FOR TODAY\n\n' + q + '\n\nReply to this message in a few lines, or send a voice note in English, Kiswahili or Kikamba. I will turn it into a post in your style for the Timothy Makasa Page.');
  if (msg) state.storyQ = { day: today, n, q, msg };
}
// Turn a new story into a post that takes the place of the next motivation or business post
async function storiesToPosts(page, posts, dir, ctx) {
  if (page.key !== 'makasa') return;
  const file = path.join(dir, 'stories.json'); let list = []; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  const fresh = list.filter((s) => s.status === 'NEW'); if (!fresh.length) return;
  for (const st of fresh) {
    const slot = posts.filter((p) => p.status === 'READY' && p.category !== 'F' && Date.parse(p.scheduledAt) > Date.now() + 90 * 60000).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
    if (!slot) break;
    let d;
    try {
      d = await ctx.gemini({ system: ctx.SYSTEM_M, user: 'Timothy sent you his own real account below' + (st.question ? ' (answering: "' + st.question + '")' : '') + '. Turn it into one Facebook post in his style. This is his true story, so write in the first person as Timothy, and you may add "(True Story)" under the title. Use ONLY the facts, names and places he gave; do not add events, names, numbers or details he did not mention. If he used Kiswahili or Kikamba words, write their meaning in English (names and places stay as he gave them). Draw one gentle lesson from it and end with a warm, natural question.\n\nHis account:\n<<<' + st.text + '>>>\n\nReturn JSON: {"title":"bold title in capital letters, 3 to 9 words","body":"500 to 1500 characters in short paragraphs","hashtags":[],"risk_level":"low|medium|high"}' });
    } catch (e) { continue; }
    const title = ctx.clean(d.title || '').toUpperCase().replace(/[.!?]+$/, '');
    const body = ctx.clean(d.body || '').replace(/^\s*As written by Timothy Makasa\s*\n+/i, '').trim(); if (body.length < 200) continue;
    const post = { id: 'p_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), page: 'makasa', category: 'S', topic: 'owner story ' + st.id, headline: title || body.slice(0, 120),
      cardText: '', reference: '', caption: (title ? title + '\nAs written by Timothy Makasa\n\n' : '') + body, hashtags: [], scheduledAt: slot.scheduledAt, createdAt: new Date().toISOString(), status: 'READY', fromStory: st.id };
    if (slot.format) post.format = slot.format;
    post.image = ctx.design(page, post, posts);
    slot.status = 'CANCELLED'; slot.reasons = ['replaced_by_owner_story'];
    posts.push(post); st.status = 'USED'; st.postId = post.id;
    const time = eatNow(Date.parse(post.scheduledAt)).toISOString().slice(0, 16).replace('T', ' ');
    await tg.photo(path.join(ctx.ROOT, post.image.file), 'YOUR STORY, ready for ' + time + '\n\n' + post.caption, [[['Block', 'b|makasa|' + post.id]]]);
    post.previewed = true;
  }
  fs.writeFileSync(file, JSON.stringify(list, null, 1));
}

// ---------- your big Page lifts the others: Timothy Makasa shares one Sauti Media story a day, and a Timsauti post every Friday ----------
async function crossShare(pages, loadPosts, state, gemini, clean) {
  if (eatHour() < 17) return;
  const today = eatDay(); state.cross = state.cross || {};
  const mk = pages.find((p) => p.key === 'makasa'); if (!mk || !mk.token) return;
  const jobs = [];
  if (state.cross.sauti !== today) jobs.push(['sauti', (posts) => posts.filter((p) => p.fromNews && p.status === 'PUBLISHED' && p.fb && p.fb.postId && eatDay(Date.parse(p.publishedAt)) === today && Date.parse(p.publishedAt) < Date.now())
    .sort((a, b) => ((b.metrics && b.metrics.score) || 0) - ((a.metrics && a.metrics.score) || 0))[0], 'a local news story from Sauti Media, the Machakos and Ukambani news Page he runs']);
  if (eatNow().getUTCDay() === 5 && state.cross.timsauti !== today) jobs.push(['timsauti', (posts) => posts.filter((p) => p.status === 'PUBLISHED' && p.fb && p.fb.postId && Date.now() - Date.parse(p.publishedAt) < 7 * 86400000).slice(-1)[0], 'a post from Timsauti Digital Agency, the marketing, PR and branding company he founded in Machakos']);
  for (const [key, choose, what] of jobs) {
    const src = pages.find((p) => p.key === key); if (!src) continue;
    const post = choose(loadPosts(key)); if (!post) continue;
    let intro = '';
    try { const d = await gemini({ system: 'You write one or two short, warm, natural lines in the voice of Timothy Makasa, a Kenyan author and communicator from Machakos, introducing a post he is sharing with his followers. British English only (never Kiswahili or Sheng), plain text, no emojis, no dashes, no hashtags, never "testament" or "whether". Output ONLY one JSON object.', user: `He is sharing ${what}. The post says: "${String(post.caption).slice(0, 500)}". Return JSON: {"intro":"one or two lines"}` }); intro = clean(d.intro || ''); } catch (e) {}
    if (!intro) continue;
    const r = await graph(mk, 'POST', `${mk.pageId}/feed`, new URLSearchParams({ message: intro, link: 'https://www.facebook.com/' + post.fb.postId }));
    if (r.ok) state.cross[key] = today;
    fs.appendFileSync(path.join(__dirname, '..', 'data', 'makasa', 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: r.ok ? 'shared_' + key : 'share_failed_' + key, post: post.id, fb: r.ok ? r.j.id : mask(JSON.stringify(r.j.error || r.j)).slice(0, 200) }) + '\n');
  }
}
// ---------- pin each Page's best post of the week (Sunday evening) ----------
async function pinBest(pages, loadPosts, state) {
  const now = eatNow(); if (now.getUTCDay() !== 0 || now.getUTCHours() < 18) return;
  const wk = eatDay(); state.pinned = state.pinned || {};
  for (const page of pages) {
    if (!page.token || state.pinned[page.key] === wk) continue;
    const best = loadPosts(page.key).filter((p) => p.status === 'PUBLISHED' && p.fb && p.fb.postId && p.metrics && Date.now() - Date.parse(p.publishedAt) < 7 * 86400000).sort((a, b) => b.metrics.score - a.metrics.score)[0];
    if (!best) continue;
    const r = await graph(page, 'POST', best.fb.postId, new URLSearchParams({ is_pinned: 'true' }));
    if (r.ok) state.pinned[page.key] = wk;
    fs.appendFileSync(path.join(__dirname, '..', 'data', page.key, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: r.ok ? 'pinned_best' : 'pin_failed', post: best.id, error: r.ok ? undefined : mask(JSON.stringify(r.j.error || r.j)).slice(0, 200) }) + '\n');
  }
}

// ---------- hand posting test: find the owner's hand posted copy of a test post on the Page ----------
const normTxt = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function matchManual(page, posts) {
  const waiting = posts.filter((p) => p.status === 'MANUAL_SENT' && Date.now() - Date.parse(p.manualSentAt) < 3 * 86400000);
  if (!waiting.length) return;
  const r = await graph(page, 'GET', `${page.pageId}/posts?limit=20&fields=id,message,created_time`);
  if (!r.ok) return;
  for (const p of waiting) {
    const key = normTxt(p.caption).slice(0, 80);
    const hit = (r.j.data || []).find((x) => normTxt(x.message).startsWith(key.slice(0, 60)));
    if (hit) { p.status = 'PUBLISHED'; p.manual = true; p.publishedAt = new Date(hit.created_time).toISOString(); p.fb = { postId: hit.id }; p.permalink = 'https://www.facebook.com/' + hit.id;
      fs.appendFileSync(path.join(__dirname, '..', 'data', page.key, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'manual_test_found', id: p.id, fb: hit.id }) + '\n'); }
  }
}
const tgPhoto = (file, caption, rows) => tg.photo(file, caption, rows);
const tgSend = (text) => tg.send(text);

// ---------- owner controls from Telegram: hide or edit a published post ----------
async function storyId(page, p) {
  if (p.fb && p.fb.postId) return p.fb.postId;
  if (p.fb && p.fb.photoId) { const g = await graph(page, 'GET', `${p.fb.photoId}?fields=page_story_id`); if (g.ok && g.j.page_story_id) { p.fb.postId = g.j.page_story_id; return p.fb.postId; } }
  return null;
}
async function hidePost(page, p) {
  const id = await storyId(page, p); if (!id) return 'This post is not live on Facebook yet.';
  const r = await graph(page, 'POST', id, new URLSearchParams({ timeline_visibility: 'hidden' }));
  if (r.ok) { p.hiddenByOwner = new Date().toISOString(); return null; }
  return mask(JSON.stringify(r.j.error || r.j)).slice(0, 200);
}
async function editPost(page, p, text) {
  const msg = text + '\n\n' + page.tags.map((h) => '#' + h).join(' ');
  const id = await storyId(page, p);
  let r = id ? await graph(page, 'POST', id, new URLSearchParams({ message: msg })) : { ok: false };
  if (!r.ok && p.fb && p.fb.photoId) r = await graph(page, 'POST', p.fb.photoId, new URLSearchParams({ name: msg }));
  if (r.ok) { p.caption = text; p.editedByOwner = new Date().toISOString(); return null; }
  return mask(JSON.stringify((r.j && (r.j.error || r.j)) || 'not live yet')).slice(0, 200);
}
// a post can be found from the evening report number ("hide 3") or from a bot message the owner replies to
function findTarget(ctx, num, replyTo) {
  const map = (num && ctx.state.reportMap && ctx.state.reportMap[num]) || (replyTo && ctx.state.tgPostMap && ctx.state.tgPostMap[replyTo]);
  if (!map) return null;
  const [pk, id] = map; const page = ctx.pages.find((x) => x.key === pk); const posts = ctx.loadPosts(pk); const p = posts.find((x) => x.id === id);
  return p && page ? { page, posts, p } : null;
}
function remember(state, msgId, pk, id) { if (!msgId) return; state.tgPostMap = state.tgPostMap || {}; state.tgPostMap[msgId] = [pk, id]; const k = Object.keys(state.tgPostMap); if (k.length > 300) for (const x of k.slice(0, k.length - 300)) delete state.tgPostMap[x]; }

// ---------- evening report on Telegram (once a day, from the 8pm run) ----------
async function dailyReport(pages, loadPosts, state, dataDir) {
  if (eatHour() < 20) return;
  const today = eatDay(Date.now()); if (state.dailyReportDay === today) return;
  const lines = []; const map = {}; let n = 0; const blocked = [];
  for (const page of pages) {
    const posts = loadPosts(page.key);
    const out = posts.filter((p) => p.status === 'PUBLISHED' && p.publishedAt && Date.parse(p.publishedAt) <= Date.now() && eatDay(Date.parse(p.publishedAt)) === today && !p.hiddenByOwner);
    if (out.length) {
      lines.push(`${page.name.toUpperCase()}: ${out.length} post${out.length > 1 ? 's' : ''}`);
      const best = out.filter((p) => p.metrics && typeof p.metrics.reach === 'number').sort((a, b) => b.metrics.reach - a.metrics.reach)[0];
      for (const p of out) { n++; map[n] = [page.key, p.id];
        const t = eatNow(Date.parse(p.publishedAt)).toISOString().slice(11, 16);
        const reach = p.metrics && typeof p.metrics.reach === 'number' ? `, ${p.metrics.reach} views so far` : '';
        lines.push(`${n}. ${t} ${String(p.headline || '').slice(0, 70)}${reach}${p === best ? '  (best today)' : ''}`); }
      lines.push('');
    }
    for (const p of posts.filter((x) => ['REJECTED_QC', 'HELD'].includes(x.status) && eatDay(Date.parse(x.scheduledAt || x.createdAt)) === today)) blocked.push(`${page.name}: ${String(p.headline || '').slice(0, 60)} (${(p.qc || []).join('; ').slice(0, 120)})`);
  }
  let thin = 0; try { thin = JSON.parse(fs.readFileSync(path.join(dataDir('sauti'), 'news.json'), 'utf8')).filter((x) => /SKIPPED_THIN|SKIPPED_INCOMPLETE|SKIPPED_STALE|SKIPPED_MISMATCH|SKIPPED_UNCONFIRMED|FAILED_CHECK/.test(x.status) && eatDay(Date.parse(x.at)) === today).length; } catch (e) {}
  let msg = `TODAY'S REPORT (${today})\n\n` + (lines.length ? lines.join('\n') : 'Nothing was posted today.\n');
  msg += `\nStopped by the editor check: ${blocked.length}` + (blocked.length ? '\n' + blocked.slice(0, 8).join('\n') : '');
  msg += `\nNews stories skipped (missing facts, old or failed the fact check): ${thin}`;
  if (n) msg += `\n\nTo hide a post, send: hide 3\nTo change its text, send: edit 3: your new text`;
  if (await tg.send(msg.slice(0, 4000)) || !tg.on()) { state.dailyReportDay = today; state.reportMap = map; }
}

// ---------- first comment: about a minute after a post goes live, the Page adds one comment to start the conversation ----------
// Posts published in this run get it after a 60 second wait; posts booked on Facebook get it on the first run after they go live.
const FIRST_VOICE = { sauti: 'the Sauti Media news Page', makasa: 'Timothy Makasa, writing as himself, warm and personal', timsauti: 'Timsauti Digital Agency, friendly and professional' };
async function firstComments(page, posts, gemini, clean, audit) {
  const out = posts.filter((p) => p.status === 'PUBLISHED' && p.fb && (p.fb.postId || p.fb.photoId) && !p.firstComment && p.publishedAt && Date.parse(p.publishedAt) <= Date.now());
  // owner, 10 Nov: a thread must never stand without its points. Threads go first, are never crowded out by news posts, and are retried for two days
  const threads = out.filter((p) => p.thread && p.thread.lessons && !p.thread.done && Date.now() - Date.parse(p.publishedAt) < 48 * 3600000);
  const live = threads.concat(out.filter((p) => !threads.includes(p) && Date.now() - Date.parse(p.publishedAt) < 6 * 3600000).slice(-6));
  for (const p of live) {
    if (p.thread && p.thread.lessons && !p.thread.done) {   // a lesson thread: the numbered lessons go in as the Page's comments, in order
      const wait0 = Date.parse(p.publishedAt) + 60000 - Date.now(); if (wait0 > 75000) continue; if (wait0 > 0) await new Promise((r) => setTimeout(r, wait0));
      let ok = 0; for (const l of p.thread.lessons.slice(p.thread.posted || 0)) {
        const r = await graph(page, 'POST', `${p.fb.videoId || p.fb.postId || p.fb.photoId}/comments`, new URLSearchParams({ message: l }));
        if (!r.ok) { p.thread.error = JSON.stringify(r.j.error || {}).slice(0, 160); break; }
        ok++; p.thread.posted = (p.thread.posted || 0) + 1; await new Promise((r) => setTimeout(r, 2500));
      }
      if (p.thread.posted >= p.thread.lessons.length) { p.thread.done = true; p.firstComment = { thread: true, at: new Date().toISOString() }; }
      if (audit) audit(page.key, { event: 'thread_comments', id: p.id, posted: p.thread.posted || 0, of: p.thread.lessons.length, error: p.thread.error || null });
      if (!p.thread.done && !p.thread.alerted && Date.now() - Date.parse(p.publishedAt) > 20 * 60000) {   // still missing points 20 minutes on: tell the owner at once
        p.thread.alerted = true; try { await tg.send(`AGENT ALERT: the ${page.name} thread "${String(p.headline).slice(0, 80)}" is live with only ${p.thread.posted || 0} of its ${p.thread.lessons.length} points in the comments. Facebook said: ${p.thread.error || 'no reason given'}. The agent keeps trying on every run.`); } catch (e) {}
      }
      continue;
    }
    const wait = Date.parse(p.publishedAt) + 60000 - Date.now(); if (wait > 0) { if (wait > 75000) continue; await new Promise((r) => setTimeout(r, wait)); }
    let text = '';
    try {
      const d = await gemini({ system: 'You write the first comment a Facebook Page adds under its own post to start the conversation. English only. No emojis, no hashtags, no links, no long dashes. Output ONLY one JSON object.',
        user: `Page voice: ${FIRST_VOICE[page.key] || page.name}.\nPost:\n<<<${String(p.caption || '').slice(0, 1500)}>>>\nWrite one short first comment (one or two sentences, at most 220 characters) that adds something. ${(posts.filter((q) => q.firstComment && q.firstComment.text).slice(-1)[0] || {}).firstComment && /\?\s*$/.test(posts.filter((q) => q.firstComment && q.firstComment.text).slice(-1)[0].firstComment.text) ? 'This time make it a statement, NOT a question: a useful extra point, a short warm reflection or a practical tip that fits the post.' : 'Either a related, easy question from a fresh angle, or a useful extra point or short warm reflection; mix the two across posts.'} Never repeat the post's closing question, never add facts the post does not give, never ask people to comment, like, share or tag, and never take sides in politics. Return JSON: {"comment":"..."}` });
      text = clean(d.comment || '');
    } catch (e) {}
    if (!text || BAIT.test(text)) { p.firstComment = { skipped: true }; continue; }
    const r = await graph(page, 'POST', `${p.fb.videoId || p.fb.postId || p.fb.photoId}/comments`, new URLSearchParams({ message: text }));
    p.firstComment = r.ok ? { id: r.j.id, at: new Date().toISOString(), text } : { failed: true, error: JSON.stringify(r.j.error || {}).slice(0, 160).replace(/access_token=[^&"]+/g, '') };
    if (audit) audit(page.key, { event: r.ok ? 'first_comment' : 'first_comment_failed', id: p.id, error: r.ok ? null : p.firstComment.error });
  }
}
const BAIT = /\b((tell|let) us( know)?|drop|share|write|say|post)\b[^.?!\n]{0,40}\b(in the comments|below)\b|\b(comment below|drop (a|your) (comment|message)|share (this|with a friend|with your friends)|tag (a|your) friend|like and share|type (yes|amen))\b/i;

module.exports = { dailyReport, remember, firstComments, BAIT, matchManual, tgPhoto, tgSend, crossShare, pinBest, storyQuestion, storiesToPosts, loadState, saveState, calendarHint, refreshMetrics, learnedHint, weeklyReport, scanComments, processTelegram, eveningPreview, sharePack, makeReel, publishReel, eatDay, eatHour };
