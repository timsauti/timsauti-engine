// Timsauti Bet Desk runner for GitHub Actions.
// Runs engine.js (the same code built for n8n) with keys from GitHub secrets
// and keeps its pick record in data/betdesk/store.json.
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'data', 'betdesk', 'store.json');
const env = process.env;
const dry = env.DRY_RUN === '1';

const settings = {
  footballDataKey: env.FOOTBALL_DATA_KEY || '',
  apiFootballKey: env.API_FOOTBALL_KEY || '',
  oddsPapiKey: env.ODDSPAPI_KEY || '',
  geminiKey: env.GEMINI_BETDESK_KEY || env.GEMINI_API_KEY || '', // own free key if added, so the Facebook agent cannot use up its allowance
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: env.TELEGRAM_OWNER_ID || '',
  bankrollKES: Number(env.BANKROLL_KES || 10000),
  minEdgePercent: 5,
  maxStakePercent: 2,
  jackpotGames: env.JACKPOT_GAMES || '',
  jackpotName: env.JACKPOT_NAME || '',
  bigStakeKES: Number(env.BIG_STAKE_KES || 50),
  forceBig: env.FORCE_BIG === '1',
  accaBook: env.ACCA_BOOK || '', // owner's app for the daily multibet
  accaMinP: Number(env.ACCA_MIN_P || 0.7),
  accaMaxLegs: Number(env.ACCA_MAX_LEGS || 6),
  accaStakeKES: Number(env.ACCA_STAKE_KES || 100),
  flatStakeKES: Number(env.FLAT_STAKE_KES || 0),
  maxPicks: 10,
  hoursAhead: Number(env.HOURS_AHEAD || 30),
  includeKenyanLeague: env.INCLUDE_KPL === '1', // API-Football free plan does not open the current season
  sendToTelegram: !dry,
  debug: dry,
};

async function httpRequest(o) {
  const url = new URL(o.url);
  for (const [k, v] of Object.entries(o.qs || {})) url.searchParams.set(k, String(v));
  const headers = Object.assign({}, o.headers || {});
  let body;
  if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeout || 30000);
  try {
    const r = await fetch(url, { method: o.method || 'GET', headers, body, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`Request failed with status code ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
    try { return JSON.parse(text); } catch { return text; }
  } finally { clearTimeout(timer); }
}

(async () => {
  if (!settings.footballDataKey) throw new Error('FOOTBALL_DATA_KEY secret is missing');
  let store = { picks: [], cache: {} };
  try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch {}
  // the backup schedule only runs when the main one did not send today's report
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  if (env.BACKUP_RUN === '1' && store.lastReport === today) { console.log('Report already sent today, backup run skipped'); return; }
  const code = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFn('$', '$getWorkflowStaticData', code);
  const out = await fn.call({ helpers: { httpRequest } }, () => ({ first: () => ({ json: settings }) }), () => store);
  if (!dry) store.lastReport = today;
  if (!dry) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(store, null, 1)); }
  const res = out[0].json;
  console.log(`Picks: ${res.picks} | Settled: ${res.settled}`);
  if (res.notes.length) console.log('Notes:\n' + res.notes.join('\n'));
  if (dry) console.log('\n' + res.messages.join('\n\n------\n\n'));
})().catch((e) => { console.error('Bet Desk failed:', e.message); process.exit(1); });
