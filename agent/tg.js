// Telegram helpers: messages, photos with buttons, and reading the owner's button taps.
'use strict';
const fs = require('fs');
const tok = () => process.env.TELEGRAM_BOT_TOKEN, owner = () => process.env.TELEGRAM_OWNER_ID;
const on = () => !!(tok() && owner()) && process.env.DRY_RUN !== '1';
const kb = (rows) => rows ? { inline_keyboard: rows.map((r) => r.map(([text, data]) => ({ text, callback_data: data }))) } : undefined;

async function call(method, body, form) {
  if (!tok()) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok()}/${method}`, form
      ? { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    return j.ok ? j.result : { error: String(j.description || r.status).slice(0, 200) };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}
async function send(text, rows) {
  if (!on()) return null;
  const r = await call('sendMessage', { chat_id: owner(), text: String(text).slice(0, 4000), reply_markup: kb(rows), disable_web_page_preview: true });
  return r && r.message_id ? r.message_id : null;
}
async function photo(file, caption, rows) {
  if (!on()) return null;
  const fd = new FormData();
  fd.append('chat_id', owner());
  fd.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/png' }), 'poster.png');
  fd.append('caption', String(caption).slice(0, 1000));
  if (rows) fd.append('reply_markup', JSON.stringify(kb(rows)));
  const r = await call('sendPhoto', null, fd);
  return r && r.message_id ? r.message_id : null;
}
async function updates(offset) {
  if (!tok()) return [];
  const r = await call('getUpdates', { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  return Array.isArray(r) ? r : [];
}
const answer = (id, text) => call('answerCallbackQuery', { callback_query_id: id, text: String(text || '').slice(0, 180) });
const done = (msgId, label) => call('editMessageReplyMarkup', { chat_id: owner(), message_id: msgId, reply_markup: kb([[[label, 'x']]]) });
async function fileBuffer(fileId) {
  const f = await call('getFile', { file_id: fileId });
  if (!f || !f.file_path) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${tok()}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}
const isOwner = (from) => from && String(from.id) === String(owner());

module.exports = { on, send, photo, updates, answer, done, isOwner, fileBuffer };
