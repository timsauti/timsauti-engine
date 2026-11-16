// Paystack webhook (set this URL in the Paystack dashboard). Only requests signed with our secret key are accepted.
import { confirm, env } from '../_shared/paystack.ts';

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
    try { await confirm(String(event.data.reference), event.data); } catch (e) { console.error('confirm failed', e); return new Response('retry', { status: 500 }); }
  }
  return new Response('ok');
});
