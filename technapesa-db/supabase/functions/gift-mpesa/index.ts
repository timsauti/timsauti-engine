// TnPVibe gifts: sends an M-PESA PIN prompt to the giver's phone (owner, 20 Nov 2026). The giver never leaves our page and
// never sees a Paystack screen; the money goes through Paystack so the owner's personal name is never shown.
// The gift is confirmed by gift-verify (polled by the page) or by the Paystack webhook, both checking the exact amount.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { caller, cors, env, json, paystack, service } from '../_shared/paystack.ts';

const kenyan = (raw: string) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  const m = d.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!env('PAYSTACK_SECRET_KEY')) return json({ error: 'Gifts by M-PESA open very soon.' }, 503);
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { receiver, post, item, message, phone } = await req.json().catch(() => ({}));
  const msisdn = kenyan(phone);
  if (!msisdn) return json({ error: 'Enter your M-PESA number, for example 0712 345 678.' }, 400);
  // Record the gift as the signed in giver, so every rule in the database applies (not yourself, not blocked, gifts open).
  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: g, error } = await asUser.rpc('vibe_gift_start', { p_receiver: receiver, p_post: post ?? null, p_item: item, p_message: message ?? null });
  if (error || !g?.reference) return json({ error: error?.message ?? 'The gift could not be started.' }, 400);
  const r = await paystack('/charge', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email, amount: Number(g.amount_kes) * 100, currency: 'KES', reference: g.reference,
      mobile_money: { phone: msisdn, provider: 'mpesa' }, metadata: { kind: 'tnpvibe_gift' },
    }),
  });
  if (!r.status) {
    await service().rpc('vibe_gift_paid', { p_reference: g.reference, p_status: 'failed', p_amount_minor: 0, p_currency: 'KES', p_provider_id: null });
    return json({ error: `M-PESA could not send the prompt: ${r.message}` }, 502);
  }
  return json({ reference: g.reference, message: 'Check your phone and enter your M-PESA PIN.' });
});
