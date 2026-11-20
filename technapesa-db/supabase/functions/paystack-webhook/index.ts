// Paystack webhook (set this URL in the Paystack dashboard). Only requests signed with our secret key are accepted.
import { confirm, env, service } from '../_shared/paystack.ts';

async function sign(body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('PAYSTACK_SECRET_KEY')), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !env('PAYSTACK_SECRET_KEY')) return new Response('not available', { status: 404 });
  const body = await req.text();
  const given = req.headers.get('x-paystack-signature') ?? '';
  const expected = await sign(body);
  if (given.length !== expected.length || given !== expected) return new Response('bad signature', { status: 401 });
  const event = JSON.parse(body) as { event: string; data: Record<string, unknown> };
  if (event.event === 'charge.success' && event.data?.reference) {
    const ref = String(event.data.reference);
    try {
      if (ref.startsWith('gift_')) {   // TnPVibe gifts
        const { error } = await service().rpc('vibe_gift_paid', { p_reference: ref, p_status: 'success', p_amount_minor: Number(event.data.amount ?? 0), p_currency: String(event.data.currency ?? ''), p_provider_id: event.data.id ? String(event.data.id) : null });
        if (error) throw error;
      } else await confirm(ref, event.data);
    } catch (e) { console.error('confirm failed', e); return new Response('retry', { status: 500 }); }
  }
  return new Response('ok');
});
