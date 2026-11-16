// Starts a Paystack checkout for a payment the signed in client created with payment_create(). Returns the checkout link.
import { caller, cors, env, json, paystack, service } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!env('PAYSTACK_SECRET_KEY')) return json({ error: 'Online payment is not switched on yet.' }, 503);
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { reference } = await req.json().catch(() => ({}));
  const { data: pay } = await service().from('payments').select('reference,owner_id,status,amount_kes,package_key,client_id').eq('reference', String(reference ?? '')).maybeSingle();
  if (!pay || pay.owner_id !== user.id || pay.status !== 'pending') return json({ error: 'This payment cannot be started. Please try again.' }, 400);
  const site = env('SITE_URL') || 'https://technapesa.co.ke';
  const r = await paystack('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email, amount: pay.amount_kes * 100, currency: 'KES', reference: pay.reference,
      callback_url: `${site}/account/growth/?tab=billing&paid=${pay.reference}`, channels: ['mobile_money', 'card'],
      metadata: { client_id: pay.client_id, package_key: pay.package_key, custom_fields: [{ display_name: 'Package', variable_name: 'package', value: pay.package_key }] },
    }),
  });
  if (!r.status || !r.data?.authorization_url) return json({ error: `Paystack: ${r.message}` }, 502);
  return json({ url: r.data.authorization_url });
});
