// Sends an M-PESA payment prompt (STK push) to the client's phone through Paystack's Charge API, for a payment the
// signed in client created with payment_create(). The client enters their M-PESA PIN on the phone; the result is
// confirmed by the webhook or by paystack-verify, which the Billing page polls.
import { caller, cors, env, json, paystack, service } from '../_shared/paystack.ts';

const kenyan = (raw: string) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  const m = d.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!env('PAYSTACK_SECRET_KEY')) return json({ error: 'The M-PESA prompt is not switched on yet. Use the Paystack payment page instead.' }, 503);
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { reference, phone } = await req.json().catch(() => ({}));
  const msisdn = kenyan(phone);
  if (!msisdn) return json({ error: 'Enter a Safaricom number such as 0712 345 678.' }, 400);
  const { data: pay } = await service().from('payments').select('reference,owner_id,status,amount_kes,package_key,client_id').eq('reference', String(reference ?? '')).maybeSingle();
  if (!pay || pay.owner_id !== user.id || pay.status !== 'pending') return json({ error: 'This payment cannot be started. Please try again.' }, 400);
  const r = await paystack('/charge', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email, amount: pay.amount_kes * 100, currency: 'KES', reference: pay.reference,
      mobile_money: { phone: msisdn, provider: 'mpesa' },
      metadata: { client_id: pay.client_id, package_key: pay.package_key },
    }),
  });
  if (!r.status) return json({ error: `M-PESA: ${r.message}` }, 502);
  return json({ status: r.data?.status ?? 'pending', message: String(r.data?.display_text ?? 'Check your phone and enter your M-PESA PIN to pay.') });
});
