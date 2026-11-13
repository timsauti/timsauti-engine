// TIMSAUTI BET DESK analysis engine (runs on GitHub Actions through run.js; also works as an n8n Code node)
// Steps: settle earlier picks, pull fixtures and results, rate teams, price every market, check Pinnacle,
// find where to bet on Betika or Mozzart, check team news, build the multibet, analyse jackpots, send the Telegram report.

const S = $('Settings').first().json;
const store = $getWorkflowStaticData('global');
store.picks = store.picks || [];
store.cache = store.cache || {};
store.multis = store.multis || [];
const http = (opts) => this.helpers.httpRequest(Object.assign({ json: true, timeout: 30000 }, opts));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];
const NOW = Date.now();
const TZ = 'Africa/Nairobi';

const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
const BANKROLL = num(S.bankrollKES, 10000);
const MIN_EDGE = num(S.minEdgePercent, 5) / 100;
const MAX_PICKS = num(S.maxPicks, 10);
const HOURS_AHEAD = num(S.hoursAhead, 30);
const MAX_STAKE = num(S.maxStakePercent, 2) / 100;
const FLAT = num(S.flatStakeKES, 0); // fixed stake per pick chosen by the owner (0 = size by bankroll)

// ---------- 1. Data sources ----------
const FD_COMPS = [
  { code: 'PL', name: 'Premier League', odds: ['england', 'premier league'] },
  { code: 'PD', name: 'LaLiga', odds: ['spain', 'laliga'] },
  { code: 'BL1', name: 'Bundesliga', odds: ['germany', 'bundesliga'] },
  { code: 'SA', name: 'Serie A', odds: ['italy', 'serie a'] },
  { code: 'FL1', name: 'Ligue 1', odds: ['france', 'ligue 1'] },
  { code: 'CL', name: 'Champions League', odds: ['champions league'] },
  { code: 'ELC', name: 'Championship', odds: ['england', 'championship'] },
  { code: 'DED', name: 'Eredivisie', odds: ['netherlands', 'eredivisie'] },
  { code: 'PPL', name: 'Primeira Liga', odds: ['portugal', 'liga portugal'] },
  { code: 'BSA', name: 'Brazil Serie A', odds: ['brazil', 'serie a'] },
];

async function footballData(comp) {
  const r = await http({
    url: `https://api.football-data.org/v4/competitions/${comp.code}/matches`,
    headers: { 'X-Auth-Token': S.footballDataKey },
  });
  return (r.matches || []).map((m) => ({
    key: `fd:${m.id}`,
    league: comp.name,
    date: new Date(m.utcDate).getTime(),
    hid: m.homeTeam && m.homeTeam.id, aid: m.awayTeam && m.awayTeam.id,
    home: (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || '?',
    away: (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || '?',
    homeFull: m.homeTeam && m.homeTeam.name, awayFull: m.awayTeam && m.awayTeam.name,
    hg: m.score && m.score.fullTime ? m.score.fullTime.home : null,
    ag: m.score && m.score.fullTime ? m.score.fullTime.away : null,
    finished: m.status === 'FINISHED',
    upcoming: m.status === 'SCHEDULED' || m.status === 'TIMED',
  }));
}

// owner, 13 Nov: a wider spread of leagues. Free results and fixtures from football-data.co.uk: the season file of each league
// (all results so far) and its weekly list of coming fixtures. Teams are matched to the odds service by name, as for the others.
const CSV_MAIN = [
  { div: 'E1', name: 'League One', odds: ['england', 'league one'], allow: 1 },
  { div: 'E2', name: 'League Two', odds: ['england', 'league two'], allow: 1 },
  { div: 'SC0', name: 'Scottish Premiership', odds: ['scotland', 'premiership'] },
  { div: 'D2', name: '2. Bundesliga', odds: ['germany', '2. bundesliga'], allow: 1 },
  { div: 'I2', name: 'Serie B', odds: ['italy', 'serie b'], allow: 1 },
  { div: 'SP2', name: 'Segunda Division', odds: ['spain', 'segunda|laliga2|laliga 2|hypermotion'], allow: 1 },
  { div: 'F2', name: 'Ligue 2', odds: ['france', 'ligue 2'], allow: 1 },
  { div: 'B1', name: 'Belgian Pro League', odds: ['belgium', 'pro league|first division a'] },
  { div: 'T1', name: 'Turkish Super Lig', odds: ['turkey|turkiye|türkiye', 'super lig|süper lig'] },
  { div: 'G1', name: 'Greek Super League', odds: ['greece', 'super league'] },
];
const CSV_NEW = [
  { code: 'USA', country: 'USA', name: 'MLS', odds: ['usa', 'mls'] },
  { code: 'MEX', country: 'Mexico', name: 'Liga MX', odds: ['mexico', 'liga mx'] },
  { code: 'ARG', country: 'Argentina', name: 'Argentina Primera', odds: ['argentina', 'liga profesional|primera division'] },
  { code: 'JPN', country: 'Japan', name: 'J1 League', odds: ['japan', 'j1|j.league|j league'] },
  { code: 'AUT', country: 'Austria', name: 'Austrian Bundesliga', odds: ['austria', 'bundesliga'] },
  { code: 'SWZ', country: 'Switzerland', name: 'Swiss Super League', odds: ['switzerland', 'super league'] },
  { code: 'DNK', country: 'Denmark', name: 'Danish Superliga', odds: ['denmark', 'superliga'] },
  { code: 'POL', country: 'Poland', name: 'Ekstraklasa', odds: ['poland', 'ekstraklasa'] },
];
function csvRows(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => { const v = l.split(','); const o = {}; head.forEach((h, i) => (o[h] = (v[i] || '').trim())); return o; });
}
function csvDate(d, t) {   // dd/mm/yy or dd/mm/yyyy, UK clock
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return 0;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const [hh, mm] = String(t || '15:00').split(':').map(Number);
  const mo = Number(m[2]); const bst = mo >= 4 && mo <= 10 ? 36e5 : 0;   // British summer time, close enough for kickoffs
  return Date.UTC(y, mo - 1, Number(m[1]), hh || 15, mm || 0) - bst;
}
function csvMatch(r, name, upcoming) {
  const home = r.HomeTeam || r.Home, away = r.AwayTeam || r.Away; if (!home || !away) return null;
  const date = csvDate(r.Date, r.Time); if (!date) return null;
  const hg = r.FTHG !== undefined ? r.FTHG : r.HG, ag = r.FTAG !== undefined ? r.FTAG : r.AG;
  const done = !upcoming && hg !== '' && hg !== undefined && ag !== '' && ag !== undefined;
  return { key: `csv:${name}:${date}:${home}`, league: name, date, hid: 'csv:' + home, aid: 'csv:' + away, home, away, homeFull: home, awayFull: away,
    hg: done ? Number(hg) : null, ag: done ? Number(ag) : null, finished: done, upcoming: !!upcoming && date > NOW };
}
async function csvLeagues() {
  const out = []; const y = new Date(NOW).getUTCMonth() >= 6 ? new Date(NOW).getUTCFullYear() : new Date(NOW).getUTCFullYear() - 1;
  const season = String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
  const base = 'https://www.football-data.co.uk/';
  const get = async (u) => { try { return await http({ url: base + u, json: false }); } catch (e) { notes.push(`League file ${u}: unavailable (${String(e.message).slice(0, 60)})`); return ''; } };
  const fx = csvRows(await get('fixtures.csv')), nfx = csvRows(await get('new_league_fixtures.csv'));
  for (const c of CSV_MAIN) {
    for (const r of csvRows(await get(`mmz4281/${season}/${c.div}.csv`))) { const m = csvMatch(r, c.name, false); if (m && m.finished) out.push(m); }
    for (const r of fx.filter((x) => x.Div === c.div)) { const m = csvMatch(r, c.name, true); if (m) out.push(m); }
  }
  const since = NOW - 400 * 864e5;
  for (const c of CSV_NEW) {
    for (const r of csvRows(await get(`new/${c.code}.csv`))) { const m = csvMatch(r, c.name, false); if (m && m.finished && m.date > since) out.push(m); }
    for (const r of nfx.filter((x) => x.Country === c.country || x.Country === c.code)) { const m = csvMatch(r, c.name, true); if (m) out.push(m); }
  }
  return out;
}

async function kenyaPremierLeague() {
  const H = { 'x-apisports-key': S.apiFootballKey };
  let lg = store.cache.kpl;
  if (!lg || NOW - lg.at > 7 * 864e5) {
    const r = await http({ url: 'https://v3.football.api-sports.io/leagues', qs: { country: 'Kenya', type: 'league' }, headers: H });
    const hit = (r.response || []).find((x) => /premier/i.test(x.league.name)) || (r.response || [])[0];
    if (!hit) throw new Error('Kenya Premier League not found on API-Football');
    const cur = (hit.seasons || []).find((s) => s.current) || (hit.seasons || []).slice(-1)[0];
    lg = { id: hit.league.id, season: cur.year, at: NOW };
    store.cache.kpl = lg;
  }
  const r = await http({ url: 'https://v3.football.api-sports.io/fixtures', qs: { league: lg.id, season: lg.season }, headers: H });
  const errs = r.errors && Object.keys(r.errors).length ? JSON.stringify(r.errors) : '';
  if (errs) throw new Error(errs);
  return (r.response || []).map((f) => ({
    key: `af:${f.fixture.id}`,
    league: 'Kenyan Premier League',
    date: new Date(f.fixture.date).getTime(),
    hid: 'af:' + f.teams.home.id, aid: 'af:' + f.teams.away.id,
    home: f.teams.home.name,
    away: f.teams.away.name,
    hg: f.goals.home,
    ag: f.goals.away,
    finished: ['FT', 'AET', 'PEN'].includes(f.fixture.status.short),
    upcoming: ['NS', 'TBD'].includes(f.fixture.status.short),
  }));
}

// ---------- 2. Team ratings (time weighted, opponent adjusted, shrunk toward average) ----------
function rate(matches) {
  const done = matches.filter((m) => m.finished && m.hg !== null && m.ag !== null);
  if (done.length < 10) return null;
  const w = (m) => Math.exp((-Math.LN2 * (NOW - m.date)) / (180 * 864e5));
  let sw = 0, sh = 0, sa = 0;
  for (const m of done) { const k = w(m); sw += k; sh += k * m.hg; sa += k * m.ag; }
  const homeAvg = sh / sw, awayAvg = sa / sw, mid = (homeAvg + awayAvg) / 2;
  const teams = {};
  const T = (n) => (teams[n] = teams[n] || { att: 1, def: 1, games: 0, hs: [], as: [] });
  done.forEach((m) => { T(m.home).games++; T(m.away).games++; });
  const K = 6;
  for (let it = 0; it < 4; it++) {
    const acc = {};
    for (const n in teams) acc[n] = { gf: 0, ef: 0, ga: 0, ea: 0 };
    for (const m of done) {
      const k = w(m), H = teams[m.home], A = teams[m.away];
      acc[m.home].gf += k * m.hg; acc[m.home].ef += k * homeAvg * A.def;
      acc[m.home].ga += k * m.ag; acc[m.home].ea += k * awayAvg * A.att;
      acc[m.away].gf += k * m.ag; acc[m.away].ef += k * awayAvg * H.def;
      acc[m.away].ga += k * m.hg; acc[m.away].ea += k * homeAvg * H.att;
    }
    for (const n in teams) {
      const a = acc[n];
      teams[n].att = (a.gf + K * mid) / (a.ef + K * mid);
      teams[n].def = (a.ga + K * mid) / (a.ea + K * mid);
    }
  }
  // simple scoring records for the "why" line
  for (const m of done) { T(m.home).hs.push([m.hg, m.ag]); T(m.away).as.push([m.ag, m.hg]); }
  const rate = (f) => done.filter(f).length / done.length;
  const base = { H: rate((m) => m.hg > m.ag), D: rate((m) => m.hg === m.ag), A: rate((m) => m.hg < m.ag), O15: rate((m) => m.hg + m.ag > 1), O25: rate((m) => m.hg + m.ag > 2), O35: rate((m) => m.hg + m.ag > 3), BTTS: rate((m) => m.hg > 0 && m.ag > 0) };
  return { homeAvg, awayAvg, teams, base, n: done.length };
}

// ---------- 3. Pricing every market from a Poisson score grid (Dixon Coles low score fix) ----------
function price(lam, mu) {
  const rho = -0.08, N = 10;
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  let P = { H: 0, D: 0, A: 0, O15: 0, O25: 0, O35: 0, BTTS: 0 }, tot = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    let p = pois(i, lam) * pois(j, mu);
    if (i === 0 && j === 0) p *= 1 - lam * mu * rho;
    else if (i === 0 && j === 1) p *= 1 + lam * rho;
    else if (i === 1 && j === 0) p *= 1 + mu * rho;
    else if (i === 1 && j === 1) p *= 1 - rho;
    tot += p;
    if (i > j) P.H += p; else if (i === j) P.D += p; else P.A += p;
    if (i + j > 1) P.O15 += p; if (i + j > 2) P.O25 += p; if (i + j > 3) P.O35 += p;
    if (i > 0 && j > 0) P.BTTS += p;
  }
  for (const k in P) P[k] /= tot;
  return P;
}

// ---------- 4. Pinnacle benchmark from OddsPapi (optional, defensive) ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|afc|ac|sc|ssc|as|club|de|calcio|1\.|sv|vfl|vfb|tsg|rc|ogc|losc|stade|cd|ud|sd)\b/g, ' ')
  .replace(/\butd\b/g, 'united').replace(/\bspurs\b/g, 'tottenham').replace(/\bwolves\b/g, 'wolverhampton').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length > 1);
// two team names match when every word of the shorter name matches a word of the longer one
// (equal, abbreviation like "man" for "manchester", or same first four letters like "wolves"/"wolverhampton")
const tok = (x, y) => x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y)) || (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4));
const same = (a, b) => { let A = norm(a), B = norm(b); if (!A.length || !B.length) return false;
  if (A.length > B.length) [A, B] = [B, A];
  return A.every((x) => B.some((y) => tok(x, y))); };

function findMarket(obj, id, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (obj.markets && obj.markets[id]) return obj.markets[id];
  for (const k in obj) { const r = findMarket(obj[k], id, depth + 1); if (r) return r; }
  return null;
}
function outcomePrices(market) {
  const oc = market && market.outcomes; if (!oc) return null;
  const ids = Object.keys(oc).sort((a, b) => Number(a) - Number(b));
  const pr = ids.map((id) => { const o = oc[id]; const pl = o.players || o; const first = pl['0'] || Object.values(pl)[0] || o; return Number(first.price || o.price); });
  return pr.every((x) => x > 1) ? pr : null;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- 4b. Bookmaker prices from OddsPapi: Pinnacle (benchmark), Betika and Mozzart (where to bet) ----------
// market ids and outcome ids as published by OddsPapi's /markets list
const MK_OUT = { 101: { 101: 'H', 102: 'D', 103: 'A' }, 104: { 104: 'BY', 105: 'BN' }, 108: { 108: 'O15', 109: 'U15' }, 1010: { 1010: 'O25', 1011: 'U25' }, 1012: { 1012: 'O35', 1013: 'U35' } };
const PAIRS = [['H', 'D', 'A'], ['BY', 'BN'], ['O15', 'U15'], ['O25', 'U25'], ['O35', 'U35']];
// only the owner's app is priced when one is set, to stay inside the free odds allowance
const KENYA_BOOKS = [{ slug: 'betika', name: 'Betika' }, { slug: 'mozzartbet', name: 'Mozzart' }].filter((b) => !S.accaBook || b.name.toLowerCase() === String(S.accaBook).toLowerCase());
let oddsCalls = 0;
const op = async (p, qs) => { oddsCalls++; const r = await http({ url: 'https://api.oddspapi.io/v4' + p, qs: Object.assign({}, qs, { apiKey: S.oddsPapiKey }) }); await sleep(1100); return r; };

async function tournamentIds() {
  const t = store.cache.tours;
  if (t && t.v === 5 && NOW - t.at < 14 * 864e5) return t.byLeague;
  const list = await op('/tournaments', { sportId: 10 });
  const byLeague = {};
  for (const c of FD_COMPS.concat(CSV_MAIN, CSV_NEW)) {
    const hit = (list || []).filter((x) => { const j = JSON.stringify(x).toLowerCase(), tn = String(x.tournamentName || '').toLowerCase(); return c.odds.every((w) => w.split('|').some((alt) => j.includes(alt))) && !/women|u19|u21|u23|youth|u20|cup|playoff|reserve/.test(tn) && (c.allow || !/2\.|second|serie b|liga 2/.test(tn)); })
      .sort((a, b) => (b.futureFixtures || 0) - (a.futureFixtures || 0))[0];
    if (hit) byLeague[c.name] = hit.tournamentId;
  }
  store.cache.tours = { byLeague, at: NOW, v: 5 };
  return byLeague;
}
let fixtureNames = null;
async function fixtureNameMap() {
  if (fixtureNames) return fixtureNames;
  const from = new Date(NOW).toISOString().slice(0, 10), to = new Date(NOW + 6 * 864e5).toISOString().slice(0, 10);
  const fx = await op('/fixtures', { sportId: 10, from, to });
  if (S.debug) notes.push(`Fixture list: ${(fx || []).length} games`);
  fixtureNames = {};
  for (const f of fx || []) fixtureNames[f.fixtureId] = { h: f.participant1Name, a: f.participant2Name, t: new Date(f.startTime || f.trueStartTime || 0).getTime() };
  return fixtureNames;
}
function readPrices(f, slug) {
  const bo = (f.bookmakerOdds && (f.bookmakerOdds[slug] || Object.values(f.bookmakerOdds)[0])) || f;
  const mk = (bo && bo.markets) || {}, pr = {};
  for (const mid in MK_OUT) {
    const m = mk[mid]; if (!m || !m.outcomes) continue;
    for (const oid in MK_OUT[mid]) {
      const o = m.outcomes[oid]; if (!o) continue;
      const pl = o.players || {}, first = pl['0'] || Object.values(pl)[0] || o, v = Number(first.price || o.price);
      if (v > 1) pr[MK_OUT[mid][oid]] = v;
    }
  }
  return pr;
}
async function board(slug, leagues) {
  if (!S.oddsPapiKey || !leagues.length) return [];
  const byLeague = await tournamentIds();
  const ids = [...new Set(leagues.map((l) => byLeague[l]).filter(Boolean))];
  if (!ids.length) return [];
  const names = await fixtureNameMap(), out = [];
  for (let i = 0; i < ids.length; i += 3) { // the free key accepts only a few tournaments per call
    const part = await op('/odds-by-tournaments', { bookmaker: slug, tournamentIds: ids.slice(i, i + 3).join(','), oddsFormat: 'decimal' });
    for (const f of Array.isArray(part) ? part : []) {
      const n = names[f.fixtureId] || { h: f.participant1Name, a: f.participant2Name, t: new Date(f.startTime || 0).getTime() };
      const pr = readPrices(f, slug);
      if (n.h && Object.keys(pr).length) out.push({ h: n.h, a: n.a, t: n.t, pr });
    }
  }
  return out;
}
// a game matches on either the short name (PSG) or the full name (Paris Saint Germain), and kickoff within four hours
const either = (n, a, b) => (a && same(n, a)) || (b && same(n, b));
const findGame = (b, m) => (b || []).find((x) => either(x.h, m.home, m.homeFull) && either(x.a, m.away, m.awayFull) && (!x.t || !m.date || Math.abs(x.t - m.date) < 4 * 36e5));
function noVig(pr) {
  const p = {};
  for (const g of PAIRS) if (g.every((k) => pr[k])) { const inv = g.map((k) => 1 / pr[k]), s = inv.reduce((a, b) => a + b, 0); g.forEach((k, i) => (p[k] = inv[i] / s)); }
  return p;
}

// ---------- 4c. Gemini with Google Search (team news and jackpot lists) ----------
async function gemini(q) {
  if (!S.geminiKey) return '';
  for (const model of ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-flash-latest']) {
    try {
      const r = await http({ method: 'POST', url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers: { 'x-goog-api-key': S.geminiKey }, timeout: 120000,
        body: { contents: [{ role: 'user', parts: [{ text: q }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } } });
      const text = ((((r.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('');
      if (text) return text;
    } catch (e) { gemini.err = `${model}: ${String(e.message).slice(0, 90)}`; }
  }
  return '';
}
const jsonArray = (t) => { try { const a = JSON.parse((String(t).match(/\[[\s\S]*\]/) || ['null'])[0]); return Array.isArray(a) ? a : null; } catch (e) { return null; } };
const tidy = (s, n) => String(s || '').replace(/\s[–—-]\s/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- 5. Settle earlier picks and multibets ----------
function legWon(m, mk) {
  const g = m.hg + m.ag;
  return { H: m.hg > m.ag, D: m.hg === m.ag, A: m.hg < m.ag, O25: g > 2, U25: g < 3, O15: g > 1, U35: g < 4,
    BY: m.hg > 0 && m.ag > 0, BN: !(m.hg > 0 && m.ag > 0) }[mk];
}
function settle(all) {
  const byKey = {}; all.forEach((m) => (byKey[m.key] = m));
  const fresh = [];
  for (const p of store.picks) {
    if (p.result) continue;
    const m = byKey[p.key];
    if (!m || !m.finished || m.hg === null) continue;
    const won = legWon(m, p.mk);
    p.result = won ? 'W' : 'L';
    p.score = `${m.hg}:${m.ag}`;
    p.pl = won ? p.stake * ((p.price || p.minOdds) - 1) : -p.stake;
    fresh.push(p);
  }
  return fresh;
}
// a multibet is lost as soon as one leg loses, and won only when every leg has won
function settleMultis(all) {
  const byKey = {}; all.forEach((m) => (byKey[m.key] = m));
  const fresh = [];
  for (const b of store.multis) {
    if (b.result) continue;
    const states = b.legs.map((l) => { const m = byKey[l.key]; return !m || !m.finished || m.hg === null ? null : legWon(m, l.mk); });
    if (states.includes(false)) b.result = 'L';
    else if (states.every((x) => x === true)) b.result = 'W';
    else continue;
    b.pl = b.result === 'W' ? b.stake * ((b.odds || b.minC) - 1) : -b.stake;
    fresh.push(b);
  }
  return fresh;
}

// ---------- 6. Run ----------
let all = [];
for (const c of FD_COMPS) {
  try { all = all.concat(await footballData(c)); } catch (e) { notes.push(`${c.name}: data unavailable (${String(e.message).slice(0, 80)})`); }
  await sleep(6500); // football-data.org free tier allows 10 calls a minute
}
try { const extra = await csvLeagues(); all = all.concat(extra); if (S.debug) notes.push(`More leagues: ${extra.length} games (${extra.filter((m) => m.upcoming).length} coming)`); } catch (e) { notes.push(`More leagues: unavailable (${String(e.message).slice(0, 80)})`); }
if (S.includeKenyanLeague !== false && S.apiFootballKey) {
  try { all = all.concat(await kenyaPremierLeague()); } catch (e) { notes.push(`Kenyan Premier League: unavailable on this key (${String(e.message).slice(0, 90)})`); }
}
const settled = settle(all);
const settledMultis = settleMultis(all);

const inWindow = (m) => m.upcoming && m.date > NOW + 15 * 6e4 && m.date < NOW + HOURS_AHEAD * 36e5;
const windowLeagues = [...new Set(all.filter(inWindow).map((m) => m.league))];
let pinB = [];
try { pinB = await board('pinnacle', windowLeagues); } catch (e) { notes.push(`Pinnacle benchmark skipped (${String(e.message).slice(0, 80)})`); }

const LABEL = { H: (m) => `${m.home} to win`, D: () => 'Draw', A: (m) => `${m.away} to win`, O25: () => 'Over 2.5 goals', U25: () => 'Under 2.5 goals',
  O15: () => 'Over 1.5 goals', U35: () => 'Under 3.5 goals', BY: () => 'Both teams to score: Yes', BN: () => 'Both teams to score: No' };

// every team's match dates across all competitions, for rest days and rotation risk
const byTeam = {};
for (const m of all) for (const id of [m.hid, m.aid]) if (id) (byTeam[id] = byTeam[id] || []).push({ date: m.date, league: m.league });
const restDays = (id, t) => { const prev = (byTeam[id] || []).filter((d) => d.date < t - 36e5).map((d) => d.date); return prev.length ? (t - Math.max(...prev)) / 864e5 : null; };
const bigGameSoon = (id, t, lg) => lg !== 'Champions League' && (byTeam[id] || []).some((d) => d.league === 'Champions League' && d.date > t + 36e5 && d.date < t + 3.5 * 864e5);

// model probabilities for one fixture (also used for jackpot games)
const ratings = {};
for (const lg of [...new Set(all.map((m) => m.league))]) ratings[lg] = rate(all.filter((m) => m.league === lg));
function modelFor(m) {
  const R = ratings[m.league]; if (!R) return null;
  const H = R.teams[m.home], A = R.teams[m.away];
  if (!H || !A || H.games < 4 || A.games < 4) return null;
  const clamp = (x) => Math.min(3.2, Math.max(0.3, x));
  const lam = clamp(R.homeAvg * H.att * A.def), mu = clamp(R.awayAvg * A.att * H.def);
  const P0 = price(lam, mu), P = {};
  const wModel = Math.min(0.8, 0.5 + Math.min(H.games, A.games) * 0.025); // trust the model more as the season fills in
  for (const k in P0) P[k] = wModel * P0[k] + (1 - wModel) * R.base[k];
  return { lam, mu, H, A, probs: { H: P.H, D: P.D, A: P.A, O25: P.O25, U25: 1 - P.O25, O15: P.O15, U35: 1 - P.O35, BY: P.BTTS, BN: 1 - P.BTTS } };
}

const candidates = [];
for (const m of all.filter(inWindow)) {
  const M = modelFor(m); if (!M) continue;
  const { H, A, lam, mu } = M;
  const pinG = findGame(pinB, m), pin = pinG ? noVig(pinG.pr) : {};
  const avg = (arr, i) => (arr.length ? arr.reduce((s, x) => s + x[i], 0) / arr.length : 0);
  const rH = restDays(m.hid, m.date), rA = restDays(m.aid, m.date);
  const tiredH = rH !== null && rH < 3 && (rA === null || rA >= 4), tiredA = rA !== null && rA < 3 && (rH === null || rH >= 4);
  const rotH = bigGameSoon(m.hid, m.date, m.league), rotA = bigGameSoon(m.aid, m.date, m.league);
  const risk = [tiredH && `${m.home} tired`, tiredA && `${m.away} tired`, rotH && `${m.home} may rotate before Champions League`, rotA && `${m.away} may rotate before Champions League`].filter(Boolean);
  const why = `${m.home} score ${avg(H.hs, 0).toFixed(1)} and concede ${avg(H.hs, 1).toFixed(1)} per home game; ${m.away} score ${avg(A.as, 0).toFixed(1)} and concede ${avg(A.as, 1).toFixed(1)} away. Expected goals ${lam.toFixed(1)} v ${mu.toFixed(1)}.`
    + (rH !== null && rA !== null ? ` Rest: ${m.home} ${Math.round(rH)} days, ${m.away} ${Math.round(rA)} days.` : '') + (risk.length ? ` Watch: ${risk.join(', ')}.` : '');
  for (const mk in M.probs) {
    if ((mk === 'H' && (tiredH || rotH)) || (mk === 'A' && (tiredA || rotA))) continue; // never back a tired or rotating side to win
    const pm = M.probs[mk], pp = pin[mk];
    if (pp !== undefined && Math.abs(pp - pm) > 0.08) continue; // model and Pinnacle disagree: skip
    const p = pp !== undefined ? 0.6 * pp + 0.4 * pm : pm;
    const fair = 1 / p, minOdds = Math.ceil(fair * (1 + MIN_EDGE) * 100) / 100;
    if (p < 0.5 || fair > 2.6 || minOdds < 1.3) continue;
    if ((mk === 'O15' || mk === 'U35') && minOdds < 1.4) continue;
    const kelly = 0.25 * ((p * minOdds - 1) / (minOdds - 1));
    const stake = FLAT > 0 ? FLAT : Math.max(50, Math.round(Math.min(kelly, MAX_STAKE) * BANKROLL / 10) * 10);
    candidates.push({ key: m.key, league: m.league, date: m.date, home: m.home, away: m.away, homeFull: m.homeFull, awayFull: m.awayFull, mk, label: LABEL[mk](m), p, fair, minOdds, stake, why,
      pin: pp !== undefined ? pp : null, score: p * (pp !== undefined ? 1.1 : 1) });
  }
}

// one pick per match: the strongest; short priced safety markets (over 1.5, under 3.5) fill at most three places
const best = {};
for (const c of candidates) if (!best[c.key] || c.score > best[c.key].score) best[c.key] = c;
let safe = 0;
const pool = Object.values(best).sort((a, b) => b.score - a.score).filter((c) => !(c.mk === 'O15' || c.mk === 'U35') || ++safe <= 3).slice(0, MAX_PICKS + 6);

// where to bet: today's Betika and Mozzart prices for every pick in the pool
const kBoards = {};
const poolLeagues = windowLeagues;
for (const b of KENYA_BOOKS) {
  try { kBoards[b.slug] = await board(b.slug, poolLeagues); } catch (e) { kBoards[b.slug] = []; notes.push(`${b.name} prices unavailable today (${String(e.message).slice(0, 60)})`); }
}
for (const p of pool) {
  p.prices = KENYA_BOOKS.map((b) => { const g = findGame(kBoards[b.slug], p); return { name: b.name, odds: (g && g.pr[p.mk]) || null }; });
  const priced = p.prices.filter((x) => x.odds).sort((a, b) => b.odds - a.odds);
  p.bestBook = priced[0] || null;
  p.status = !priced.length ? 'unpriced' : p.bestBook.odds >= p.minOdds ? 'value' : 'novalue';
}
const noValue = pool.filter((p) => p.status === 'novalue');
const shortlist = pool.filter((p) => p.status !== 'novalue').sort((a, b) => (b.status === 'value') - (a.status === 'value') || b.score - a.score).slice(0, MAX_PICKS + 4);

// team news check: Gemini searches the latest injuries, suspensions and rotation for each shortlisted pick
let verdicts = null;
if (shortlist.length) {
  const lines = shortlist.map((p, i) => `${i + 1}. ${p.home} v ${p.away} (${p.league}, kickoff ${new Date(p.date).toISOString().slice(0, 16)} UTC). Pick: ${p.label}.`).join('\n');
  const q = `You are a careful football analyst checking team news before a bet. Today is ${new Date(NOW).toISOString().slice(0, 10)}. For each match below, search the latest news from the past four days: injuries, suspensions, expected rotation, manager changes and motivation. Decide if the news clearly weakens the pick. Drop only on specific, confirmed news, for example a key striker ruled out when the pick backs that team to win or for goals, or the first choice keeper or several defenders out when the pick is under goals. If the news is unclear or you find nothing, keep the pick. Never invent players or news.\n\n${lines}\n\nReply with only a JSON array, one object per match in the same order: [{"n":1,"verdict":"keep","news":"key team news in under 20 words"}]. verdict is keep or drop.`;
  try { verdicts = jsonArray(await gemini(q)); } catch (e) {}
  if (!verdicts) notes.push(`Team news check unavailable today: picks are based on the numbers only.${S.debug ? ' (' + (gemini.err || 'no reply') + ')' : ''}`);
}
const kept = [], dropped = [];
shortlist.forEach((p, i) => {
  const v = verdicts && verdicts.find((x) => Number(x.n) === i + 1);
  if (v && v.news) p.news = tidy(v.news, 180);
  (v && /drop/i.test(String(v.verdict)) ? dropped : kept).push(p);
});
const picks = kept.slice(0, MAX_PICKS).sort((a, b) => a.date - b.date);

// daily multibet of short priced, high probability legs (owner's choice: many small odds combined)
const ACCA_STAKE = num(S.accaStakeKES, 100);
const accaLegs = [];
for (const m of all.filter(inWindow)) {
  if (dropped.some((d) => d.key === m.key)) continue;
  const M = modelFor(m); if (!M) continue;
  const rH = restDays(m.hid, m.date), rA = restDays(m.aid, m.date);
  const weakH = (rH !== null && rH < 3 && (rA === null || rA >= 4)) || bigGameSoon(m.hid, m.date, m.league);
  const weakA = (rA !== null && rA < 3 && (rH === null || rH >= 4)) || bigGameSoon(m.aid, m.date, m.league);
  const pinG = findGame(pinB, m), pin = pinG ? noVig(pinG.pr) : {};
  for (const mk of Object.keys(M.probs)) {
    if (mk === 'D' || (mk === 'H' && weakH) || (mk === 'A' && weakA)) continue;
    const pm = M.probs[mk], pp = pin[mk];
    if (pp !== undefined && Math.abs(pp - pm) > 0.08) continue;
    const p = pp !== undefined ? 0.6 * pp + 0.4 * pm : pm;
    if (p < Math.min(num(S.accaMinP, 0.7), 0.62)) continue;
    for (const b of KENYA_BOOKS) {
      const g = findGame(kBoards[b.slug], m), o = g && g.pr[mk];
      if (o && o >= 1.15) accaLegs.push({ key: m.key, date: m.date, home: m.home, away: m.away, mk, label: LABEL[mk](m), p, book: b.name, odds: o, ev: p * o });
    }
  }
}
let acca = null;
for (const b of KENYA_BOOKS.filter((k) => !S.accaBook || k.name.toLowerCase() === String(S.accaBook).toLowerCase())) {
  const one = {};
  for (const l of accaLegs.filter((x) => x.book === b.name && x.p >= num(S.accaMinP, 0.7))) if (!one[l.key] || l.ev > one[l.key].ev) one[l.key] = l;
  const legs = Object.values(one).sort((a, c) => c.ev - a.ev).slice(0, num(S.accaMaxLegs, 6));
  if (legs.length < 3) continue;
  const odds = legs.reduce((t, x) => t * x.odds, 1), pr = legs.reduce((t, x) => t * x.p, 1);
  if (!acca || pr * odds > acca.pr * acca.odds) acca = { book: b.name, legs: legs.sort((a, c) => a.date - c.date), odds, pr };
}
// ambitious slip: 10 to 20 odds, at most twice a week, Friday to Sunday, from games not in the daily multibet
const BIG_STAKE = num(S.bigStakeKES, 50);
let big = null;
const dayN = new Date(new Date(NOW).toLocaleString('en-US', { timeZone: TZ })).getDay(); // 0 Sunday ... 6 Saturday, Nairobi time
const bigThisWeek = store.multis.filter((x) => x.type === 'big' && NOW - (x.made || 0) < 6 * 864e5).length;
if (S.bigSlip !== false && (S.forceBig || ([5, 6, 0].includes(dayN) && bigThisWeek < 2))) {
  const inAcca = new Set(acca ? acca.legs.map((l) => l.key) : []);
  const best1 = {};
  for (const l of accaLegs.filter((x) => (!S.accaBook || x.book.toLowerCase() === String(S.accaBook).toLowerCase()) && x.odds >= 1.25 && !inAcca.has(x.key))) {
    l.eff = -Math.log(l.p) / Math.log(l.odds); // probability given up per unit of odds gained: lower is better
    if (!best1[l.key] || l.eff < best1[l.key].eff) best1[l.key] = l;
  }
  const chosen = []; let odds = 1;
  for (const l of Object.values(best1).sort((a, c) => a.eff - c.eff)) {
    if (odds >= 10) break;
    if (odds * l.odds > 20) continue;
    chosen.push(l); odds *= l.odds;
  }
  if (odds >= 10 && chosen.length >= 4) {
    big = { book: chosen[0].book, legs: chosen.sort((a, c) => a.date - c.date), odds, pr: chosen.reduce((t, x) => t * x.p, 1) };
    const id = 'big|' + big.legs.map((l) => l.key + l.mk).sort().join('|');
    if (!store.multis.some((x) => x.id === id))
      store.multis.push({ id, type: 'big', made: NOW, date: Math.max(...big.legs.map((l) => l.date)), stake: BIG_STAKE, minC: big.odds, odds: big.odds,
        legs: big.legs.map((l) => ({ key: l.key, mk: l.mk, label: l.label, match: `${l.home} v ${l.away}` })) });
  }
}
if (S.debug) notes.push('Multibet legs: ' + (accaLegs.filter((l) => !S.accaBook || l.book.toLowerCase() === String(S.accaBook).toLowerCase()).map((l) => `${l.home} v ${l.away} [${new Date(l.date).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' })}] ${l.mk} ${l.odds} p${Math.round(l.p * 100)}`).join('; ') || 'none'));
if (acca) {
  const id = 'acca|' + acca.legs.map((l) => l.key + l.mk).sort().join('|');
  if (!store.multis.some((x) => x.id === id))
    store.multis.push({ id, type: 'acca', date: Math.max(...acca.legs.map((l) => l.date)), stake: ACCA_STAKE, minC: acca.odds, odds: acca.odds,
      legs: acca.legs.map((l) => ({ key: l.key, mk: l.mk, label: l.label, match: `${l.home} v ${l.away}` })) });
}

// multibet: up to 4 strong legs from different matches, placed on the one platform that pays most for all legs
const legs = picks.filter((c) => c.p >= 0.62).sort((a, b) => b.p - a.p).slice(0, 4);
const MULTI_STAKE = Math.max(50, Math.round(picks.length ? picks[0].stake / 20 : 5) * 10);
let multi = null;
if (legs.length >= 2) {
  const minC = legs.reduce((s, x) => s * x.minOdds, 1), pr = legs.reduce((s, x) => s * x.p, 1);
  const offers = KENYA_BOOKS.map((b) => { const o = legs.map((l) => (l.prices.find((x) => x.name === b.name) || {}).odds); return o.every(Boolean) ? { name: b.name, odds: o.reduce((s, x) => s * x, 1) } : null; })
    .filter(Boolean).sort((a, b) => b.odds - a.odds);
  multi = { legs, minC, pr, offer: offers[0] || null };
  const id = legs.map((l) => l.key + l.mk).sort().join('|');
  if (!store.multis.some((b) => b.id === id))
    store.multis.push({ id, date: Math.max(...legs.map((l) => l.date)), stake: MULTI_STAKE, minC, odds: multi.offer && multi.offer.odds >= minC ? multi.offer.odds : null,
      legs: legs.map((l) => ({ key: l.key, mk: l.mk, label: l.label, match: `${l.home} v ${l.away}`, minOdds: l.minOdds })) });
}

// save picks for settlement
for (const p of picks) if (!store.picks.some((x) => x.key === p.key && x.mk === p.mk))
  store.picks.push({ key: p.key, mk: p.mk, label: p.label, match: `${p.home} v ${p.away}`, date: p.date, p: p.p, minOdds: p.minOdds, stake: p.stake,
    price: p.status === 'value' ? p.bestBook.odds : null, book: p.status === 'value' ? p.bestBook.name : null });
store.picks = store.picks.filter((x) => NOW - x.date < 120 * 864e5);
store.multis = store.multis.filter((b) => NOW - b.date < 120 * 864e5);

// ---------- 7. Jackpot analysis ----------
let jpLookups = 0;
store.jackpots = (store.jackpots || []).filter((j) => NOW - j.at < 30 * 864e5);
const jackpotParts = [];
if ((S.geminiKey || S.jackpotGames) && S.jackpots !== false) {
  const q = `Today is ${new Date(NOW).toISOString().slice(0, 10)}. Search the web for the current Kenyan football jackpots whose games have not started yet: SportPesa Mega Jackpot, SportPesa Midweek Jackpot, Betika Grand Jackpot, Betika Midweek Jackpot and Mozzart Super Jackpot. For each jackpot where you find the full official list of games for the coming round, give every game in order with the home and away team and, if you find them, the 1X2 odds shown for that game. Never invent games, teams or odds. Leave out any jackpot whose full current list you cannot confirm.\n\nReply with only a JSON array: [{"jackpot":"SportPesa Mega Jackpot","firstKickoff":"YYYY-MM-DD","games":[{"home":"","away":"","odds":[2.10,3.30,3.40]}]}]. Use null for odds you did not find.`;
  let list = null;
  // a jackpot list typed in by the owner ("Home v Away" per line) takes priority over the web search
  if (S.jackpotGames) {
    const games = String(S.jackpotGames).split(/\n|;/).map((x) => x.trim()).filter(Boolean)
      .map((x) => x.replace(/^\d+[.)]\s*/, '').split(/\s+(?:v|vs|VS|Vs)\.?\s+/)).filter((x) => x.length === 2).map(([home, away]) => ({ home: home.trim(), away: away.trim(), odds: null }));
    list = [{ jackpot: S.jackpotName || 'Betika Jackpot', firstKickoff: '', games }];
  } else {
    try { list = jsonArray(await gemini(q)); } catch (e) {}
  }
  if (!list && S.debug) notes.push(`Jackpot search: no list (${gemini.err || 'no reply'})`);
  const upcomingAll = all.filter((m) => m.upcoming && m.date > NOW && m.date < NOW + 8 * 864e5);
  for (const jp of list || []) {
    const games = (jp.games || []).filter((g) => g && g.home && g.away);
    if (games.length < 5 || !jp.jackpot) continue;
    const kick = Date.parse(jp.firstKickoff || '') || NOW;
    if (kick < NOW - 864e5) continue;
    const id = `${jp.jackpot}|${games[0].home}|${games[0].away}|${games.length}`.toLowerCase();
    if (!S.jackpotGames && store.jackpots.some((j) => j.id === id)) continue;
    const rows = [];
    for (const [i, g] of games.entries()) rows.push(await (async () => {
      const fx = upcomingAll.find((m) => either(g.home, m.home, m.homeFull) && either(g.away, m.away, m.awayFull));
      const M = fx ? modelFor(fx) : null;
      let pinG = fx ? findGame(pinB, fx) : findGame(pinB, { home: g.home, away: g.away });
      // any league: look the game up in the full fixture list and fetch its prices directly
      if (!pinG && S.oddsPapiKey && jpLookups < 24) {
        try {
          const names = await fixtureNameMap();
          const fid = Object.keys(names).find((k) => same(names[k].h, g.home) && same(names[k].a, g.away));
          if (fid) {
            jpLookups++;
            const r = await op('/odds', { fixtureId: fid, bookmakers: 'pinnacle,betika,mozzartbet', oddsFormat: 'decimal' });
            const f = Array.isArray(r) ? r[0] : r;
            for (const slug of ['pinnacle', 'betika', 'mozzartbet']) {
              if (f && f.bookmakerOdds && f.bookmakerOdds[slug]) { const pr = readPrices(f, slug); if (pr.H && pr.D && pr.A) { pinG = { pr, src: slug }; break; } }
            }
            if (!pinG && S.debug) notes.push(`Jackpot lookup ${g.home} v ${g.away}: ${JSON.stringify(r).slice(0, 160)}`);
          } else if (S.debug) notes.push(`Jackpot game not found in fixtures: ${g.home} v ${g.away}`);
        } catch (e) { if (S.debug) notes.push(`Jackpot lookup failed ${g.home} v ${g.away}: ${String(e.message).slice(0, 80)}`); }
      }
      const pin = pinG ? noVig(pinG.pr) : {};
      let p = null, src = '';
      if (pin.H && M) { p = ['H', 'D', 'A'].map((k) => 0.6 * pin[k] + 0.4 * M.probs[k]); src = 'model + Pinnacle'; }
      else if (pin.H) { p = [pin.H, pin.D, pin.A]; src = pinG.src || 'Pinnacle'; }
      else if (M) { p = [M.probs.H, M.probs.D, M.probs.A]; src = 'model'; }
      else if (Array.isArray(g.odds) && g.odds.length === 3 && g.odds.every((x) => Number(x) > 1)) { const inv = g.odds.map((x) => 1 / Number(x)), s = inv.reduce((a, b) => a + b, 0); p = inv.map((x) => x / s); src = 'bookmaker odds'; }
      const order = p ? [0, 1, 2].sort((a, b) => p[b] - p[a]) : null;
      return { n: i + 1, home: tidy(g.home, 40), away: tidy(g.away, 40), p, src, top: order ? order[0] : null, second: order ? order[1] : null };
    })());
    const SYM = ['1', 'X', '2'];
    // the weakest favourites get doubled first; games with no data count as the weakest
    const weakest = [...rows].sort((a, b) => (a.p ? a.p[a.top] : 0) - (b.p ? b.p[b.top] : 0));
    const plan = (k) => { const dbl = new Set(weakest.slice(0, k).map((r) => r.n)); let ch = 1; let known = true;
      for (const r of rows) { if (!r.p) { known = false; ch *= dbl.has(r.n) ? 0.66 : 0.45; continue; } ch *= r.p[r.top] + (dbl.has(r.n) ? r.p[r.second] : 0); }
      return { dbl, ch, known, lines: 2 ** k }; };
    const A = plan(0), B = plan(Math.min(3, rows.length)), C = plan(Math.min(5, rows.length));
    const odds1in = (c) => (c > 0 ? `1 in ${Math.round(1 / c).toLocaleString('en-KE')}` : 'too small to measure');
    let t = `<b>JACKPOT: ${esc(tidy(jp.jackpot, 40))}</b>\n${rows.length} games${jp.firstKickoff ? ` | first kickoff ${esc(tidy(jp.firstKickoff, 12))}` : ''}`;
    for (const r of rows) {
      const pick = r.top === null ? '? (no data, use your judgment)' : `${SYM[r.top]} (${Math.round(r.p[r.top] * 100)}%)`;
      const inPlans = B.dbl.has(r.n) ? ' in plans B and C' : ' in plan C';
      const cover = !C.dbl.has(r.n) ? '' : r.p ? `, double ${[SYM[r.top], SYM[r.second]].sort((a, b) => SYM.indexOf(a) - SYM.indexOf(b)).join('')}${inPlans}` : `, cover the two results you rate most${inPlans}`;
      t += `\n${r.n}. ${esc(r.home)} v ${esc(r.away)}: <b>${pick}</b>${cover}${S.debug && r.p ? ` [${r.src}: ${r.p.map((x) => Math.round(x * 100)).join('/')}]` : ''}`;
    }
    const nm = (P) => [...P.dbl].sort((a, b) => a - b).join(', ');
    t += `\n\nPlan A, 1 line, picks only: chance of all correct ${odds1in(A.ch)}`;
    t += `\nPlan B, ${B.lines} lines, doubles on games ${nm(B)}: ${odds1in(B.ch)}`;
    t += `\nPlan C, ${C.lines} lines, doubles on games ${nm(C)}: ${odds1in(C.ch)}`;
    if (!A.known) t += '\nSome games had no data, so these chances are rough.';
    t += '\nA jackpot is a long shot even with the best analysis. Spend on it only what you would spend on entertainment, and check the game list on the app before you play.';
    jackpotParts.push(t);
    store.jackpots.push({ id, at: NOW });
  }
}

// ---------- 8. Message ----------
const kes = (n) => 'KES ' + Math.round(n).toLocaleString('en-KE');
const when = (t) => new Date(t).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const today = new Date(NOW).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const valueN = picks.filter((p) => p.status === 'value').length;

const parts = [];
parts.push(`<b>TIMSAUTI BET DESK</b>\n${today}\n${FLAT > 0 ? `Stake per pick ${kes(FLAT)}` : `Bankroll ${kes(BANKROLL)}`} | Picks today: ${picks.length}${picks.length ? ` (${valueN} confirmed on Betika or Mozzart)` : ''}\n\nHow to use: where a pick says <b>BET on</b>, place it on that app. Where it says <b>CHECK</b>, open the apps and bet only where one pays the "Take at" price or higher. SportPesa prices are not available to the agent, so compare it yourself on every pick.`);

if (settled.length) {
  const w = settled.filter((x) => x.result === 'W').length, pl = settled.reduce((s, x) => s + x.pl, 0);
  let t = `<b>RESULTS SINCE LAST REPORT</b>\n${w} won, ${settled.length - w} lost | ${pl >= 0 ? 'Profit' : 'Loss'} ${kes(Math.abs(pl))}`;
  settled.forEach((x) => { t += `\n${x.result === 'W' ? 'WON' : 'LOST'} ${esc(x.match)} (${x.score}): ${esc(x.label)}`; });
  parts.push(t);
}
settledMultis.forEach((b) => parts.push(`<b>${b.type === 'acca' ? 'DAILY MULTIBET' : b.type === 'big' ? 'AMBITIOUS SLIP' : 'MULTIBET'} RESULT</b>\n${b.result === 'W' ? 'WON' : 'LOST'} ${b.legs.length} legs at ${(b.odds || b.minC).toFixed(2)} | ${b.result === 'W' ? 'Profit' : 'Loss'} ${kes(Math.abs(b.pl))}`));
const doneAll = store.picks.filter((x) => x.result);
if (doneAll.length) {
  const w = doneAll.filter((x) => x.result === 'W').length, st = doneAll.reduce((s, x) => s + x.stake, 0), pl = doneAll.reduce((s, x) => s + x.pl, 0);
  parts.push(`<b>RUNNING RECORD</b>\n${doneAll.length} picks settled, ${w} won (${Math.round((100 * w) / doneAll.length)}%)\nStaked ${kes(st)} | ${pl >= 0 ? 'Profit' : 'Loss'} ${kes(Math.abs(pl))} | Return ${((100 * pl) / st).toFixed(1)}%`);
}
const doneA = store.multis.filter((b) => b.result && b.type === 'acca');
if (doneA.length) {
  const w = doneA.filter((b) => b.result === 'W').length, st = doneA.reduce((t, b) => t + b.stake, 0), pl = doneA.reduce((t, b) => t + b.pl, 0);
  parts.push(`<b>DAILY MULTIBET RECORD</b>\n${doneA.length} slips settled, ${w} won | Staked ${kes(st)} | ${pl >= 0 ? 'Profit' : 'Loss'} ${kes(Math.abs(pl))}`);
}
const doneB = store.multis.filter((b) => b.result && b.type === 'big');
if (doneB.length) {
  const w = doneB.filter((b) => b.result === 'W').length, st = doneB.reduce((t, b) => t + b.stake, 0), pl = doneB.reduce((t, b) => t + b.pl, 0);
  parts.push(`<b>AMBITIOUS SLIP RECORD</b>\n${doneB.length} slips settled, ${w} won | Staked ${kes(st)} | ${pl >= 0 ? 'Profit' : 'Loss'} ${kes(Math.abs(pl))}`);
}
const doneM = store.multis.filter((b) => b.result && b.type !== 'acca' && b.type !== 'big');
if (doneM.length) {
  const w = doneM.filter((b) => b.result === 'W').length, pl = doneM.reduce((s, b) => s + b.pl, 0);
  parts.push(`<b>MULTIBET RECORD</b>\n${doneM.length} multibets settled, ${w} won | ${pl >= 0 ? 'Profit' : 'Loss'} ${kes(Math.abs(pl))}`);
}

if (acca) {
  let t = `<b>DAILY MULTIBET (${acca.legs.length} legs, short odds)</b>\nPlace all legs on <b>${acca.book}</b> as one slip | Stake ${kes(ACCA_STAKE)}`;
  acca.legs.forEach((l, i) => { t += `\n${i + 1}. ${esc(l.home)} v ${esc(l.away)} (${when(l.date)}): <b>${esc(l.label)}</b> at ${l.odds.toFixed(2)}, chance ${Math.round(l.p * 100)}%`; });
  t += `\nCombined odds ${acca.odds.toFixed(2)} | Pays ${kes(ACCA_STAKE * acca.odds)} if all legs win\nTrue chance all legs win: ${Math.round(acca.pr * 100)}% (about 1 in ${Math.max(1, Math.round(1 / acca.pr))})\nHonest note: over many slips, expect back about ${kes(acca.pr * acca.odds * 100)} for every KES 100 staked. The record below will show the real figure.`;
  parts.push(t);
}
if (big) {
  let t = `<b>AMBITIOUS SLIP (${big.legs.length} legs, about ${big.odds.toFixed(1)} odds)</b>\nPlace all legs on <b>${big.book}</b> as one slip | Stake ${kes(BIG_STAKE)}`;
  big.legs.forEach((l, i) => { t += `\n${i + 1}. ${esc(l.home)} v ${esc(l.away)} (${when(l.date)}): <b>${esc(l.label)}</b> at ${l.odds.toFixed(2)}, chance ${Math.round(l.p * 100)}%`; });
  t += `\nPays ${kes(BIG_STAKE * big.odds)} if all legs win | True chance about 1 in ${Math.max(1, Math.round(1 / big.pr))}\nA long shot by design: keep the stake small and expect most of these to lose.`;
  parts.push(t);
}
if (!picks.length) parts.push('No single pick beat the bookmaker prices today, so there are no value singles.' + (acca ? ' The daily multibet above is your bet for today.' : ' Not enough strong games for a daily multibet either: no bet today is the right call.'));
picks.forEach((p, i) => {
  const priceLine = p.prices.map((x) => `${x.name} ${x.odds ? x.odds.toFixed(2) : 'not listed'}`).join(' | ') + ' | SportPesa: compare in app';
  const where = p.status === 'value'
    ? `<b>BET on ${p.bestBook.name} at ${p.bestBook.odds.toFixed(2)}</b> | Stake ${kes(p.stake)}`
    : `<b>CHECK</b> Betika, Mozzart and SportPesa. Bet where one pays ${p.minOdds.toFixed(2)} or more | Stake ${kes(p.stake)}`;
  parts.push(`<b>${i + 1}. ${esc(p.home)} v ${esc(p.away)}</b>\n${esc(p.league)} | ${when(p.date)}\nPick: <b>${esc(p.label)}</b>\nTrue chance ${Math.round(p.p * 100)}% | Take at ${p.minOdds.toFixed(2)} or higher\n${where}\nPrices: ${priceLine}\nWhy: ${esc(p.why)}${p.news ? `\nTeam news: ${esc(p.news)}` : ''}${p.pin !== null ? `\nPinnacle rates it ${Math.round(p.pin * 100)}%` : ''}`);
});

if (noValue.length) {
  let t = '<b>GOOD PICKS, BUT PRICES TOO LOW (skip unless SportPesa pays the Take at price)</b>';
  noValue.slice(0, 6).forEach((x) => { t += `\n${esc(x.home)} v ${esc(x.away)}: ${esc(x.label)}. Best ${x.bestBook.name} ${x.bestBook.odds.toFixed(2)}, needs ${x.minOdds.toFixed(2)}`; });
  parts.push(t);
}
if (dropped.length) {
  let t = '<b>DROPPED AFTER TEAM NEWS CHECK</b>';
  dropped.forEach((x) => { t += `\n${esc(x.home)} v ${esc(x.away)} (${esc(x.label)}): ${esc(x.news || 'team news against it')}`; });
  parts.push(t);
}
if (multi) {
  let t = `<b>MULTIBET OPTION (${multi.legs.length} legs)</b>`;
  multi.legs.forEach((x) => { t += `\n${esc(x.home)} v ${esc(x.away)}: ${esc(x.label)} (take at ${x.minOdds.toFixed(2)})`; });
  t += `\nTrue chance all legs win: ${Math.round(multi.pr * 100)}%\nWorth it only at combined odds ${multi.minC.toFixed(2)} or higher.`;
  if (multi.offer && multi.offer.odds >= multi.minC) t += `\n<b>BET on ${multi.offer.name}: combined odds ${multi.offer.odds.toFixed(2)}</b> | Stake ${kes(MULTI_STAKE)}`;
  else if (multi.offer) t += `\n${multi.offer.name} pays ${multi.offer.odds.toFixed(2)}, below the minimum. Place it only if SportPesa pays ${multi.minC.toFixed(2)} or more | Stake ${kes(MULTI_STAKE)}`;
  else t += `\n<b>CHECK</b> the apps and place it where the combined odds reach ${multi.minC.toFixed(2)} | Stake ${kes(MULTI_STAKE)}`;
  parts.push(t);
}
jackpotParts.forEach((t) => parts.push(t));
if (S.debug) notes.push(`Odds service calls this run: ${oddsCalls} | Pinnacle games ${pinB.length} | Betika ${(kBoards.betika || []).length} | Mozzart ${(kBoards.mozzartbet || []).length}`);
if (notes.length) parts.push('<b>SYSTEM NOTES</b>\n' + notes.map(esc).join('\n'));
parts.push('Play within your bankroll. Never chase losses.');

// Telegram limit is 4096 characters per message: pack sections into messages
const msgs = []; let cur = '';
for (const s of parts) { if ((cur + '\n\n' + s).length > 3800) { msgs.push(cur); cur = s; } else cur = cur ? cur + '\n\n' + s : s; }
if (cur) msgs.push(cur);

if (S.telegramBotToken && S.telegramChatId && S.sendToTelegram !== false) {
  for (const text of msgs) {
    await http({ method: 'POST', url: `https://api.telegram.org/bot${S.telegramBotToken}/sendMessage`, body: { chat_id: S.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true } });
    await sleep(400);
  }
}

return [{ json: { picks: picks.length, settled: settled.length, notes, messages: msgs } }];
