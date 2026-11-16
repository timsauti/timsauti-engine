// Shared helpers for the Paystack Edge Functions. Secrets come only from Supabase function secrets:
// PAYSTACK_SECRET_KEY (set by the owner) plus SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (provided by Supabase).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
export const env = (k: string) => Deno.env.get(k) ?? '';
export const service = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

export async function caller(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return null;
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function paystack(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.paystack.co${path}`, {
    ...init, headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  return (await r.json().catch(() => ({ status: false, message: 'Paystack did not answer' }))) as { status: boolean; message: string; data?: Record<string, unknown> };
}

// Records Paystack's verdict through the database, which checks the amount and currency itself.
export async function confirm(ref: string, d: Record<string, unknown>) {
  const { data, error } = await service().rpc('payment_confirm', {
    p_reference: ref, p_status: String(d.status ?? ''), p_amount_minor: Number(d.amount ?? 0), p_currency: String(d.currency ?? ''),
    p_channel: d.channel ? String(d.channel) : null, p_provider_id: d.id ? String(d.id) : null,
    p_raw: { id: d.id, status: d.status, amount: d.amount, currency: d.currency, channel: d.channel, paid_at: d.paid_at, gateway_response: d.gateway_response },
  });
  if (error) throw error;
  return String(data);
}
