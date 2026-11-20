// TnPVibe gifts: the giver's page asks here every few seconds until M-PESA has answered. Safe to call more than once.
import { caller, cors, env, json, paystack, service } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!env('PAYSTACK_SECRET_KEY')) return json({ error: 'Gifts by M-PESA open very soon.' }, 503);
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { reference } = await req.json().catch(() => ({}));
  const ref = String(reference ?? '');
  const { data: g } = await service().from('vibe_gifts').select('giver,status').eq('reference', ref).maybeSingle();
  if (!g || g.giver !== user.id) return json({ error: 'Gift not found.' }, 404);
  if (g.status !== 'unpaid') return json({ result: g.status });
  const r = await paystack(`/transaction/verify/${encodeURIComponent(ref)}`);
  if (!r.status || !r.data) return json({ result: 'unpaid' });
  const st = String(r.data.status);
  if (!['success', 'failed', 'abandoned', 'reversed'].includes(st)) return json({ result: 'unpaid' });
  const { data, error } = await service().rpc('vibe_gift_paid', { p_reference: ref, p_status: st, p_amount_minor: Number(r.data.amount ?? 0), p_currency: String(r.data.currency ?? ''), p_provider_id: r.data.id ? String(r.data.id) : null });
  if (error) return json({ result: 'unpaid' });
  return json({ result: String(data) });
});
