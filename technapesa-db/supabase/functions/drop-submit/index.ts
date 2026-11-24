// Public Tukachap Drop submission endpoint.
// Deploy as a Supabase Edge Function named "drop-submit" only after staging is verified.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://technapesa.co.ke", "https://www.technapesa.co.ke"]);

function headersFor(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://technapesa.co.ke";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headersFor(origin) });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" }, origin);
  if (origin && !["https://technapesa.co.ke", "https://www.technapesa.co.ke"].includes(origin)) {
    return reply(403, { error: "This request is not allowed." }, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const fingerprintSecret = Deno.env.get("DROP_FINGERPRINT_SECRET");
  if (!url || !serviceKey || !fingerprintSecret) {
    return reply(503, { error: "Secret messages are temporarily unavailable. Please try again soon." }, origin);
  }

  let payload: { username?: unknown; message?: unknown; sender_mode?: unknown };
  try {
    payload = await req.json();
  } catch {
    return reply(400, { error: "Please check your message and try again." }, origin);
  }

  const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const senderMode = payload.sender_mode;
  if (!/^[a-z0-9_]{3,24}$/.test(username) || message.length < 1 || message.length > 2000 ||
      !["anonymous", "identified"].includes(String(senderMode))) {
    return reply(400, { error: "Please check your message and try again." }, origin);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Identified mode requires a real signed-in Tukachap member. Guest submissions are anonymous only.
  let senderId: string | null = null;
  if (senderMode === "identified") {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return reply(401, { error: "Log in to send a message with your name." }, origin);
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return reply(401, { error: "Please sign in again." }, origin);
    senderId = userData.user.id;
    const { data: sender } = await db.from("vibe_profiles").select("user_id,status").eq("user_id", senderId).maybeSingle();
    if (!sender || sender.status !== "active") return reply(403, { error: "Join Tukachap to send a message with your name." }, origin);
  } else if (req.headers.has("authorization")) {
    // Anonymous mode must not accidentally attach a logged-in identity.
    senderId = null;
  }

  const { data: recipient } = await db.from("vibe_profiles")
    .select("user_id,status,username")
    .eq("username", username)
    .eq("status", "active")
    .maybeSingle();
  if (!recipient) return reply(404, { error: "This secret message link is unavailable." }, origin);

  const { data: settings } = await db.from("vibe_drop_settings")
    .select("enabled,allow_anonymous,allow_identified")
    .eq("user_id", recipient.user_id)
    .maybeSingle();
  const prefs = settings ?? { enabled: true, allow_anonymous: true, allow_identified: true };
  if (!prefs.enabled || (senderMode === "anonymous" && !prefs.allow_anonymous) ||
      (senderMode === "identified" && !prefs.allow_identified)) {
    return reply(403, { error: "This member is not accepting this type of message." }, origin);
  }
  if (senderId && senderId === recipient.user_id) {
    return reply(400, { error: "You cannot send a secret message to yourself." }, origin);
  }

  // Use a keyed digest so raw IP addresses are never stored. Require a private secret.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const fingerprint = await digest(fingerprintSecret + ":" + forwarded + ":" + username);
  const { data: blockedFingerprint, error: blockLookupError } = await db.from("vibe_drop_blocked_fingerprints")
    .select("fingerprint_hash")
    .eq("recipient_id", recipient.user_id)
    .eq("fingerprint_hash", fingerprint)
    .maybeSingle();
  if (blockLookupError) return reply(503, { error: "Please try again shortly." }, origin);
  if (blockedFingerprint) return reply(403, { error: "This member is not accepting messages from this sender." }, origin);

  const windowStart = new Date(Math.floor(Date.now() / 900000) * 900000).toISOString();
  const { data: allowed, error: limitError } = await db.rpc("vibe_drop_rate_check", {
    p_fingerprint: fingerprint,
    p_window: windowStart,
    p_limit: 5,
  });
  if (limitError) return reply(503, { error: "Please try again shortly." }, origin);
  if (!allowed) return reply(429, { error: "Please wait before sending another message." }, origin);

  // Give the sender a private, unguessable return key so an anonymous sender can
  // securely read and answer follow-up replies without creating an account.
  const random = crypto.getRandomValues(new Uint8Array(32));
  const returnToken = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
  const returnTokenHash = await digest(returnToken);
  const { data: saved, error: insertError } = await db.from("vibe_drops").insert({
    recipient_id: recipient.user_id,
    sender_user_id: senderMode === "identified" ? senderId : null,
    sender_mode: senderMode,
    message,
    reply_token_hash: returnTokenHash,
    reply_token_expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (insertError || !saved) return reply(503, { error: "Your message could not be sent. Please try again." }, origin);

  // Keep abuse fingerprints in a separate service-only table. Recipients never
  // receive the hash or raw network information.
  const { error: abuseInsertError } = await db.from("vibe_drop_abuse_metadata").insert({
    drop_id: saved.id,
    recipient_id: recipient.user_id,
    fingerprint_hash: fingerprint,
  });
  if (abuseInsertError) {
    await db.from("vibe_drops").delete().eq("id", saved.id);
    return reply(503, { error: "Your message could not be safely processed. Please try again." }, origin);
  }

  // In-app and WhatsApp delivery is generic. The WhatsApp queue separately
  // checks Drop-specific opt-in and the account's verified phone number.
  try {
    await db.rpc("notify", {
      p_user: recipient.user_id,
      p_topic: "messages",
      p_title: "You received a new secret message",
      p_body: "Open Tukachap to read your private message.",
      p_link: "/vibe/drops/",
    });
  } catch {
    // A notification failure must never undo a successfully stored Drop.
  }

  return reply(200, {
    success: true,
    message: "Your Drop has been sent.",
    reply_token: returnToken,
  }, origin);
});
