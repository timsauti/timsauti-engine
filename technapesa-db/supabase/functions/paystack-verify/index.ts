// Called when the client returns from Paystack: asks Paystack for the result and records it. Safe to call more than once.
import { caller, confirm, cors, env, json, paystack, service } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!env('PAYSTACK_SECRET_KEY')) return json({ error: 'Online payment is not switched on yet.' }, 503);
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { reference } = await req.json().catch(() => ({}));
  const ref = String(reference ?? '');
  const { data: pay } = await service().from('payments').select('owner_id,status').eq('reference', ref).maybeSingle();
  if (!pay || pay.owner_id !== user.id) return json({ error: 'Payment not found.' }, 404);
  if (pay.status === 'success') return json({ result: 'confirmed' });
  const r = await paystack(`/transaction/verify/${encodeURIComponent(ref)}`);
  if (!r.status || !r.data) return json({ result: 'pending', message: r.message });
  const st = String(r.data.status);
  if (st === 'success' || st === 'failed' || st === 'abandoned') return json({ result: await confirm(ref, r.data) });
  return json({ result: 'pending', message: `Payment is ${st}` });
});
