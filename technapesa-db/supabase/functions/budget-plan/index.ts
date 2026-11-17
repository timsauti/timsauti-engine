// "Name your budget": the client enters what they wish to spend and what they want; the agent builds the best plan
// for that amount from the owner's rate card. The agent only picks items and quantities; quote_save() in the database
// prices them from the rate card and refuses anything over budget or outside the card.
import { caller, cors, env, json, service } from '../_shared/paystack.ts';

type Card = { min_budget: number; max_budget: number; items: Record<string, { name: string; price: number; unit: string; max: number }> };
type Line = { key: string; qty: number };

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
async function gemini(system: string, user: string) {
  for (const m of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      return JSON.parse((j.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join(''));
    } catch { /* next model */ }
  }
  return null;
}

const priceOf = (card: Card, lines: Line[]) => lines.reduce((t, l) => t + l.qty * card.items[l.key].price, 0);

function tidy(card: Card, raw: unknown, budget: number): Line[] {
  const lines: Line[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const key = String((x as Line)?.key ?? ''), qty = Math.floor(Number((x as Line)?.qty));
    if (!card.items[key] || !(qty >= 1) || lines.some((l) => l.key === key)) continue;
    lines.push({ key, qty: Math.min(qty, card.items[key].max) });
  }
  // over budget: trim extras first, then posts
  while (lines.length && priceOf(card, lines) > budget) {
    const extra = lines.filter((l) => l.key !== 'post').sort((a, b) => card.items[b.key].price - card.items[a.key].price)[0];
    if (extra) { extra.qty -= 1; if (!extra.qty) lines.splice(lines.indexOf(extra), 1); continue; }
    const p = lines.find((l) => l.key === 'post')!; p.qty -= 1; if (!p.qty) lines.splice(lines.indexOf(p), 1);
  }
  // money left over: more posts, so the client gets the full value of their budget
  let post = lines.find((l) => l.key === 'post');
  if (!post) { post = { key: 'post', qty: 0 }; lines.unshift(post); }
  const room = Math.floor((budget - priceOf(card, lines)) / card.items.post.price);
  post.qty = Math.min(card.items.post.max, post.qty + Math.max(0, room));
  return lines.filter((l) => l.qty > 0);
}

function fallback(card: Card, budget: number): Line[] {
  const lines: Line[] = [];
  if (budget >= 6000 && card.items.gbp_setup) lines.push({ key: 'gbp_setup', qty: 1 });
  if (budget >= 9000 && card.items.comment_care) lines.push({ key: 'comment_care', qty: 1 });
  if (budget >= 14000 && card.items.extra_platform) lines.push({ key: 'extra_platform', qty: 1 });
  return tidy(card, lines, budget);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await caller(req);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const { client_id, budget, goals } = await req.json().catch(() => ({}));
  const sb = service();
  const { data: card0 } = await sb.from('site_settings').select('value').eq('key', 'growth.rate_card').maybeSingle();
  const card = card0?.value as Card | undefined;
  if (!card?.items?.post) return json({ error: 'Plans are not available right now.' }, 503);
  const b = Math.floor(Number(budget));
  if (!(b >= card.min_budget && b <= card.max_budget)) return json({ error: `Enter an amount between KSh ${card.min_budget.toLocaleString()} and KSh ${card.max_budget.toLocaleString()}.` }, 400);
  const { data: c } = await sb.from('growth_clients').select('id,owner_id,status,business_name,description,objectives,platforms,town').eq('id', String(client_id ?? '')).maybeSingle();
  if (!c || c.owner_id !== user.id) return json({ error: 'Not allowed.' }, 403);
  const { count } = await sb.from('growth_quotes').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).gte('created_at', new Date(Date.now() - 3600000).toISOString());
  if ((count ?? 0) >= 10) return json({ error: 'You have asked for many plans in the last hour. Please try again a little later.' }, 429);
  const wish = String(goals ?? '').slice(0, 600);
  const menu = Object.entries(card.items).map(([k, v]) => `${k}: ${v.name}, KSh ${v.price} per ${v.unit}, at most ${v.max}`).join('\n');
  const ai = await gemini(`You are the TECH na PESA Digital Growth planner. A Kenyan business tells you its monthly budget and what it wants.
Build the most useful plan for exactly that budget using ONLY the menu items below. Total cost must not go over the budget. Always include posts.
Choose what best serves their goals: for example a shop wanting walk in customers benefits from Google Business Profile set up; a school in admissions season benefits from a sponsored challenge week.
Then explain the plan to the owner in plain, warm British English (60 to 120 words): what they get and why it suits their goals. No dashes, no emojis, no prices in the explanation.
Return JSON: {"items":[{"key":"post","qty":12}],"summary":"..."}
MENU:
${menu}`, `Budget: KSh ${b} for one month.\nBusiness: ${c.business_name}${c.town ? ', ' + c.town : ''}. ${String(c.description ?? '').slice(0, 400)}\nTheir usual goals: ${String(c.objectives ?? '').slice(0, 300)}\nWhat they want now: ${wish || 'not stated'}\nPlatforms: ${(c.platforms ?? []).join(', ') || 'facebook'}`);
  let lines = ai ? tidy(card, ai.items, b) : [];
  if (!lines.length || priceOf(card, lines) > b) lines = fallback(card, b);
  const summary = String(ai?.summary ?? '').replace(/[–—]/g, ', ').slice(0, 1400) ||
    `For KSh ${b.toLocaleString()} you get ${lines.map((l) => `${l.qty} ${card.items[l.key].name.toLowerCase()}`).join(', ')}. You approve every post before it goes out.`;
  const { data: id, error } = await sb.rpc('quote_save', { p_owner: user.id, p_client: c.id, p_budget: b, p_goals: wish, p_items: lines, p_summary: summary });
  if (error) return json({ error: 'The plan could not be prepared. Please try a slightly different amount.' }, 400);
  const { data: q } = await sb.from('growth_quotes').select('*').eq('id', id).single();
  return json({ quote: q });
});
