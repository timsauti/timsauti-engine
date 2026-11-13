// Local test: runs engine.js with mocked APIs to check the maths and the report.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/engine.js', 'utf8');
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const NOW = Date.now();
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pois = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };

const teamsPL = ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Wolves', 'Everton', 'Brentford', 'Fulham', 'Spurs', 'Leeds'];
const str = Object.fromEntries(teamsPL.map((t, i) => [t, 1.6 - i * 0.1]));
let id = 1;
function season(teams) {
  const out = [];
  let day = 80;
  for (let r = 0; r < 2; r++) for (const h of teams) for (const a of teams) if (h !== a && rnd() < 0.55) {
    const t = NOW - day * 864e5; day -= 0.7;
    if (day > 1) out.push({ id: id++, utcDate: new Date(t).toISOString(), status: 'FINISHED', homeTeam: { id: teamsPL.indexOf(h) + 1, shortName: h }, awayTeam: { id: teamsPL.indexOf(a) + 1, shortName: a },
      score: { fullTime: { home: pois(1.5 * str[h] / str[a] * 0.8), away: pois(1.15 * str[a] / str[h] * 0.8) } } });
  }
  out.push({ id: 9001, utcDate: new Date(NOW + 20 * 36e5).toISOString(), status: 'TIMED', homeTeam: { id: teamsPL.indexOf('Arsenal') + 1, shortName: 'Arsenal' }, awayTeam: { id: teamsPL.indexOf('Wolves') + 1, shortName: 'Wolves' }, score: { fullTime: {} } });
  out.push({ id: 9002, utcDate: new Date(NOW + 22 * 36e5).toISOString(), status: 'TIMED', homeTeam: { id: teamsPL.indexOf('Leeds') + 1, shortName: 'Leeds' }, awayTeam: { id: teamsPL.indexOf('Liverpool') + 1, shortName: 'Liverpool' }, score: { fullTime: {} } });
  out.push({ id: 9003, utcDate: new Date(NOW + 24 * 36e5).toISOString(), status: 'TIMED', homeTeam: { id: teamsPL.indexOf('Fulham') + 1, shortName: 'Fulham' }, awayTeam: { id: teamsPL.indexOf('Brentford') + 1, shortName: 'Brentford' }, score: { fullTime: {} } });
  [['Chelsea', 'Spurs'], ['Everton', 'Fulham'], ['Brentford', 'Wolves'], ['Liverpool', 'Chelsea'], ['Spurs', 'Leeds'], ['Wolves', 'Man City'], ['Arsenal', 'Everton'], ['Leeds', 'Brentford']]
    .forEach(([h, a], i) => out.push({ id: 9100 + i, utcDate: new Date(NOW + (26 + i) * 36e5).toISOString(), status: 'TIMED', homeTeam: { id: teamsPL.indexOf(h) + 1, shortName: h }, awayTeam: { id: teamsPL.indexOf(a) + 1, shortName: a }, score: { fullTime: {} } }));
  out.push({ id: 9004, utcDate: new Date(NOW + 25 * 36e5).toISOString(), status: 'TIMED', homeTeam: { id: teamsPL.indexOf('Man City') + 1, shortName: 'Man City' }, awayTeam: { id: teamsPL.indexOf('Everton') + 1, shortName: 'Everton' }, score: { fullTime: {} } });
  return out;
}
const pl = season(teamsPL);
const sent = [], gem = [];
const helpers = {
  async httpRequest(o) {
    const u = o.url;
    if (u.includes('football-data.org')) { if (u.includes('/PL/')) return { matches: pl }; throw new Error('Request failed with status code 403'); }
    if (u.includes('api-sports.io/leagues')) return { response: [{ league: { id: 276, name: 'Premier League' }, seasons: [{ year: 2026, current: true }] }] };
    if (u.includes('api-sports.io/fixtures')) return { errors: { plan: 'Free plans do not have access to this season' }, response: [] };
    if (u.endsWith('/tournaments')) return [{ tournamentId: 17, tournamentName: 'Premier League', categoryName: 'England', futureFixtures: 30 }, { tournamentId: 99, tournamentName: 'Premier League 2', categoryName: 'England' }];
    if (u.endsWith('/fixtures')) return [['x1', 'Arsenal FC', 'Wolverhampton Wanderers', 20], ['x2', 'Leeds United', 'Liverpool FC', 22], ['x3', 'Fulham FC', 'Brentford FC', 24], ['x4', 'Manchester City', 'Everton FC', 25], ['y0', 'Chelsea', 'Tottenham Hotspur', 26], ['y1', 'Everton', 'Fulham', 27], ['y2', 'Brentford', 'Wolves', 28], ['y3', 'Liverpool', 'Chelsea', 29], ['y4', 'Tottenham', 'Leeds United', 30], ['y5', 'Wolves', 'Manchester City', 31], ['y6', 'Arsenal', 'Everton', 32], ['y7', 'Leeds United', 'Brentford', 33]]
      .map(([id, h, a, hr]) => ({ fixtureId: id, participant1Name: h, participant2Name: a, startTime: new Date(NOW + hr * 36e5).toISOString() }));
    if (u.endsWith('/odds-by-tournaments')) {
      const P = (v) => ({ players: { 0: { price: v } } });
      const mk = (o) => { const m = {}; for (const [mid, outs] of Object.entries(o)) { m[mid] = { outcomes: {} }; for (const [oid, v] of Object.entries(outs)) m[mid].outcomes[oid] = P(v); } return m; };
      const books = {
        pinnacle: { x1: { 101: { 101: 1.42, 102: 4.9, 103: 7.4 }, 1010: { 1010: 1.62, 1011: 2.4 } } },
        betika: { ...Object.fromEntries(['y0','y1','y2','y3','y4','y5','y6','y7'].map((k) => [k, { 101: { 101: 1.9, 102: 3.6, 103: 3.9 }, 104: { 104: 1.62, 105: 2.2 }, 108: { 108: 1.28, 109: 3.4 }, 1010: { 1010: 1.75, 1011: 2.0 }, 1012: { 1012: 3.1, 1013: 1.33 } }])), x1: { 101: { 101: 1.60, 102: 4.4, 103: 6.0 }, 1010: { 1010: 1.72, 1011: 2.1 } }, x2: { 101: { 101: 6.0, 102: 4.5, 103: 1.40 } }, x3: { 1010: { 1010: 2.6, 1011: 1.58 } } },
        mozzartbet: { x1: { 101: { 101: 1.30, 102: 5, 103: 8 }, 1010: { 1010: 1.66, 1011: 2.1 } }, x2: { 101: { 101: 6.0, 102: 4.5, 103: 1.28 } }, x3: { 1010: { 1010: 2.5, 1011: 1.61 } }, x4: { 1010: { 1010: 1.9, 1011: 1.7 } } },
      };
      const b = o.qs.bookmaker; return Object.entries(books[b] || {}).map(([fid, o2]) => ({ fixtureId: fid, bookmakerOdds: { [b]: { markets: mk(o2) } } }));
    }
    if (u.includes('generativelanguage')) {
      const q = o.body.contents[0].parts[0].text; gem.push(q.slice(0, 40));
      const text = /jackpot/i.test(q)
        ? '[{"jackpot":"SportPesa Mega Jackpot","firstKickoff":"2026-11-08","games":[{"home":"Arsenal","away":"Wolves","odds":null},{"home":"Leeds","away":"Liverpool","odds":null},{"home":"Ajax","away":"PSV","odds":[2.6,3.5,2.6]},{"home":"Celtic","away":"Rangers","odds":[1.9,3.6,3.9]},{"home":"Brann","away":"Molde","odds":null},{"home":"Fulham","away":"Brentford","odds":null}]}]'
        : '[{"n":1,"verdict":"keep","news":"Full squad available"},{"n":2,"verdict":"drop","news":"Top scorer ruled out with a hamstring injury"}]';
      return { candidates: [{ content: { parts: [{ text }] } }] };
    }
    if (u.includes('telegram')) { sent.push(o.body.text); return { ok: true }; }
    throw new Error('unmocked ' + u);
  },
};
const store = { multis: [{ id: 'x', date: Date.now() - 3 * 864e5, stake: 50, minC: 3.1, legs: [{ key: 'fd:5', mk: 'H', label: 'Test to win', match: 'X v Y', minOdds: 1.75 }, { key: 'fd:6', mk: 'O15', label: 'Over 1.5', match: 'Z v W', minOdds: 1.4 }] }], picks: [{ key: 'fd:5', mk: 'H', label: 'Test to win', match: 'X v Y', date: NOW - 3 * 864e5, p: 0.6, minOdds: 1.75, stake: 150 }] };
const settings = { footballDataKey: 'a', apiFootballKey: 'b', oddsPapiKey: 'c', telegramBotToken: 't', geminiKey: 'g', flatStakeKES: 100, forceBig: true, accaMinP: 0.95, telegramChatId: '1', bankrollKES: 10000, minEdgePercent: 5, maxPicks: 10, hoursAhead: 30, maxStakePercent: 2 };
global.setTimeout = (f) => f(); // skip waits in the test
(async () => {
  const fn = new AsyncFn('$', '$getWorkflowStaticData', body);
  const out = await fn.call({ helpers }, () => ({ first: () => ({ json: settings }) }), () => store);
  console.log(JSON.stringify(out[0].json.notes, null, 1));
  console.log('\n===== TELEGRAM =====\n' + sent.join('\n\n------\n\n'));
  console.log('\nGemini calls:', gem.length);
  console.log('\nstored picks:', store.picks.length, 'settled earlier pick:', store.picks[0].result || 'open');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
