// Sends waiting staff alerts (call requests, new applications, trials started by clients) to the owner's phone on
// Telegram straight away. Called by the site right after a client action; the hourly agent sends anything left over.
// Anyone signed in may call it, but it only ever sends rows the database wrote, and only to the owner.
import { caller, cors, env, json, service } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await caller(req))) return json({ error: 'sign in' }, 401);
  const token = env('TELEGRAM_BOT_TOKEN'), chat = env('TELEGRAM_OWNER_ID');
  if (!token || !chat) return json({ sent: 0, note: 'alerts go out with the hourly agent' });
  const sb = service();
  const { data } = await sb.from('staff_alerts').select('id,kind,message').is('sent_at', null).order('id').limit(10);
  let sent = 0;
  for (const a of data ?? []) {
    const text = `TECH na PESA: ${a.message}\nAdmin: https://technapesa.co.ke/admin/growth/`;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
    if (r.ok) { await sb.from('staff_alerts').update({ sent_at: new Date().toISOString() }).eq('id', a.id).is('sent_at', null); sent++; }
  }
  return json({ sent });
});
