// Recipient-only Drop blocking. Anonymous sender fingerprints remain private.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://technapesa.co.ke", "https://www.technapesa.co.ke"]);
function headersFor(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://technapesa.co.ke";
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
function respond(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...headersFor(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headersFor(origin) });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" }, origin);
  if (origin && !allowedOrigins.has(origin)) return respond(403, { error: "This request is not allowed." }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond(503, { error: "Blocking is temporarily unavailable." }, origin);

  const authHeader = req.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return respond(401, { error: "Sign in to block a sender." }, origin);

  let payload: { drop_id?: unknown };
  try { payload = await req.json(); } catch { return respond(400, { error: "Invalid request." }, origin); }
  const dropId = typeof payload.drop_id === "string" ? payload.drop_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(dropId)) return respond(400, { error: "Invalid message." }, origin);

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData.user) return respond(401, { error: "Please sign in again." }, origin);
  const me = userData.user.id;

  const { data: drop } = await db.from("vibe_drops")
    .select("id,recipient_id,sender_user_id")
    .eq("id", dropId).eq("recipient_id", me).maybeSingle();
  if (!drop) return respond(404, { error: "This message is not in your inbox." }, origin);

  const { data: abuse } = await db.from("vibe_drop_abuse_metadata")
    .select("fingerprint_hash")
    .eq("drop_id", drop.id).eq("recipient_id", me).maybeSingle();
  if (abuse?.fingerprint_hash) {
    const { error } = await db.from("vibe_drop_blocked_fingerprints").upsert({
      recipient_id: me, fingerprint_hash: abuse.fingerprint_hash,
    }, { onConflict: "recipient_id,fingerprint_hash" });
    if (error) return respond(503, { error: "The sender could not be blocked. Please try again." }, origin);
  }

  if (!abuse?.fingerprint_hash && !drop.sender_user_id) {
    return respond(409, { error: "This older anonymous message cannot be blocked." }, origin);
  }

  if (drop.sender_user_id && drop.sender_user_id !== me) {
    const { error } = await db.from("vibe_blocks").upsert({
      blocker: me, blocked: drop.sender_user_id,
    }, { onConflict: "blocker,blocked" });
    if (error) return respond(503, { error: "The sender could not be blocked. Please try again." }, origin);
  }

  return respond(200, { success: true }, origin);
});
