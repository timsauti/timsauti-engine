// Private two-way Drop thread endpoint.
// Sender access uses a high-entropy return token; recipient access requires a verified session.
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
function respond(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headersFor(origin) });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" }, origin);
  if (origin && !allowedOrigins.has(origin)) return respond(403, { error: "This request is not allowed." }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond(503, { error: "Private replies are temporarily unavailable." }, origin);

  let body: { action?: unknown; drop_id?: unknown; token?: unknown; message?: unknown };
  try { body = await req.json(); } catch { return respond(400, { error: "Invalid request." }, origin); }

  const action = body.action;
  if (action !== "read" && action !== "reply") return respond(400, { error: "Invalid request." }, origin);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const dropId = typeof body.drop_id === "string" ? body.drop_id : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (action === "reply" && (message.length < 1 || message.length > 2000)) {
    return respond(400, { error: "Your reply must be between 1 and 2,000 characters." }, origin);
  }
  if (token && !/^[a-f0-9]{64}$/.test(token)) return respond(403, { error: "This private reply link is invalid or expired." }, origin);

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let drop: { id: string; recipient_id: string; sender_user_id: string | null; sender_mode: string; message: string; created_at: string } | null = null;
  let actor: "sender" | "recipient";

  if (token) {
    const tokenHash = await digest(token);
    const { data } = await db.from("vibe_drops")
      .select("id,recipient_id,sender_user_id,sender_mode,message,created_at")
      .eq("reply_token_hash", tokenHash)
      .neq("status", "deleted")
      .gt("reply_token_expires_at", new Date().toISOString())
      .maybeSingle();
    drop = data;
    actor = "sender";
  } else {
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken || !dropId) return respond(401, { error: "Open this private thread from your Tukachap account." }, origin);
    const { data: userData, error: userError } = await db.auth.getUser(accessToken);
    if (userError || !userData.user) return respond(401, { error: "Please sign in again." }, origin);
    const { data } = await db.from("vibe_drops")
      .select("id,recipient_id,sender_user_id,sender_mode,message,created_at")
      .eq("id", dropId).eq("recipient_id", userData.user.id).neq("status", "deleted").maybeSingle();
    drop = data;
    actor = "recipient";
  }

  if (!drop || (!token && drop.id !== dropId)) return respond(404, { error: "This private reply link is invalid or expired." }, origin);

  if (token) {
    const { data: abuse } = await db.from("vibe_drop_abuse_metadata")
      .select("fingerprint_hash").eq("drop_id", drop.id).maybeSingle();
    if (abuse?.fingerprint_hash) {
      const { data: blocked } = await db.from("vibe_drop_blocked_fingerprints")
        .select("fingerprint_hash")
        .eq("recipient_id", drop.recipient_id)
        .eq("fingerprint_hash", abuse.fingerprint_hash)
        .maybeSingle();
      if (blocked) return respond(403, { error: "This private conversation is no longer available." }, origin);
    }
    if (drop.sender_user_id) {
      const { data: blocked } = await db.from("vibe_blocks")
        .select("blocker").eq("blocker", drop.recipient_id).eq("blocked", drop.sender_user_id).maybeSingle();
      if (blocked) return respond(403, { error: "This private conversation is no longer available." }, origin);
    }
  }

  if (action === "reply") {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const fingerprint = await digest("drop-reply:" + (token || drop.recipient_id) + ":" + forwarded);
    const windowStart = new Date(Math.floor(Date.now() / 900000) * 900000).toISOString();
    const { data: allowed, error: rateError } = await db.rpc("vibe_drop_rate_check", {
      p_fingerprint: fingerprint, p_window: windowStart, p_limit: 10,
    });
    if (rateError) return respond(503, { error: "Please try again shortly." }, origin);
    if (!allowed) return respond(429, { error: "Please wait before sending another reply." }, origin);

    const { error: insertError } = await db.from("vibe_drop_replies").insert({
      drop_id: drop.id, author_role: actor, message,
    });
    if (insertError) return respond(503, { error: "Your reply could not be sent. Please try again." }, origin);

    const notifyUser = actor === "sender" ? drop.recipient_id : drop.sender_user_id;
    if (notifyUser) {
      try {
        await db.rpc("notify", {
          p_user: notifyUser,
          p_topic: "messages",
          p_title: actor === "sender" ? "Someone replied to your secret message" : "You have a new reply to a secret message",
          p_body: "Open Tukachap to read your private reply.",
          p_link: actor === "sender" ? "/vibe/drops/" : "/vibe/drops/",
        });
      } catch {
        // Notifications are best-effort and do not affect the private conversation.
      }
    }
  }

  const { data: replies, error: repliesError } = await db.from("vibe_drop_replies")
    .select("id,author_role,message,created_at")
    .eq("drop_id", drop.id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (repliesError) return respond(503, { error: "The private thread could not be loaded." }, origin);

  return respond(200, {
    success: true,
    drop: { id: drop.id, message: drop.message, sender_mode: drop.sender_mode, created_at: drop.created_at },
    replies: replies ?? [],
  }, origin);
});
