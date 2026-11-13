// Opportunity Desk self check: no internet, no AI. Run before every change is pushed.
'use strict';
const E = require('./engine'); let bad = 0; const ok = (c, w) => { if (!c) { bad++; console.log('FAIL: ' + w); } };
const P = E.PROFILE(); ok(P.company && P.person && P.wanted.length > 10, 'the profile is incomplete');
ok(E.SOURCES().length >= 5 && E.SOURCES().every((s) => s.name && s.type && (s.url || s.q)), 'a source is missing its address');
const now = new Date().toUTCString(), old = new Date(Date.now() - 60 * 86400000).toUTCString();
const feed = E.parseFeed(`<rss><channel>
<item><title><![CDATA[Consultancy: Training of Trainers on Customer Care &amp; Leadership]]></title><link>https://example.org/a?utm=1</link><description>&lt;p&gt;An NGO in Kenya seeks a facilitator.&lt;/p&gt;</description><pubDate>${now}</pubDate></item>
<item><title>Supply of Motor Vehicle Tyres</title><link>https://example.org/b</link><description>Tender for training yard</description><pubDate>${now}</pubDate></item>
<item><title>Communications consultant, old notice</title><link>https://example.org/c</link><description>x</description><pubDate>${old}</pubDate></item>
<item><title>Borehole drilling works</title><link>https://example.org/d</link><description>works</description><pubDate>${now}</pubDate></item>
</channel></rss>`);
ok(feed.length === 4 && feed[0].title === 'Consultancy: Training of Trainers on Customer Care & Leadership' && /seeks a facilitator/.test(feed[0].summary) && feed[0].date > 0, 'the feed reader misreads a notice');
const atom = E.parseFeed('<feed><entry><title>Call for facilitators</title><link href="https://example.org/e"/><updated>2026-11-10T08:00:00Z</updated><summary>governance training</summary></entry></feed>');
ok(atom.length === 1 && atom[0].link === 'https://example.org/e', 'the feed reader misses Atom links');
const S = { seen: {}, items: [], inbox: [], health: {}, days: {} };
const pass = E.sieve(feed.map((x) => Object.assign(x, { source: 't' })), S, P);
ok(pass.length === 1 && /Training of Trainers/.test(pass[0].title), 'the first sieve keeps the wrong notices: ' + pass.map((x) => x.title).join(' / '));
for (const x of pass) S.seen[x.id] = Date.now();
ok(E.sieve(feed, S, P).length === 0, 'a notice already seen is shown twice');
const tj = E.parseJson(JSON.stringify({ data: [{ id: 77, title: 'Provision of Staff Training Services', pe: { name: 'County X' }, close_at: '2026-12-01', published_at: '2026-11-10' }] }), {});
ok(tj.length === 1 && /County X/.test(tj[0].summary) && /77$/.test(tj[0].link), 'the tender list reader misreads a record');
ok(E.idOf('https://a.org/x/?utm=1') === E.idOf('https://A.org/x'), 'the same link gets two ids');
const c = E.card({ title: 'T', fit: 80, as: 'person', kind: 'Consultancy', why: 'w', deadline: '1 Dec 2026', deadlineConfirmed: true, source: 's', link: 'https://a.org', asks: ['CV'] }, P, 1);
ok(/Bid as: Timothy Muli Makasa/.test(c) && /read on the notice itself/.test(c) && !/[–—]/.test(c), 'the Telegram card is wrong');
// the whole morning flow with a stand in AI and Telegram
(async () => {
  const sent = []; const tg = { send: async (t, rows) => { sent.push({ t, rows }); return sent.length; } };
  const realFetch = global.fetch; const page = '<html><body><h1>Training of Trainers</h1><p>' + 'The organisation seeks a facilitator for customer care training in Machakos. '.repeat(8) + 'Applications must be received by 30 December 2099 at 5pm.</p></body></html>';
  global.fetch = async () => ({ ok: true, url: 'https://example.org/a', text: async () => page });
  const ask = async (p) => { if (/NOTICES/.test(p.user)) return { results: [{ n: 1, fit: 88, as: 'company', kind: 'Call for trainers', why: 'Customer care training of trainers in Kenya.', deadline: '' }] };
    if (/PAGE TEXT/.test(p.user)) return { isNotice: true, closed: false, deadline: '30 December 2099', deadlineISO: '2099-12-30', deadlineQuote: 'Applications must be received by 30 December 2099', organisation: 'Example NGO', asks: ['Technical proposal'], howToApply: 'Email' };
    return { subject: 'EOI', letter: ('Dear Example NGO,\n\n' + 'We are pleased to respond. '.repeat(30) + '\n\n[state your daily rate]'), attach: ['CV'], gaps: ['Daily rate'], advice: 'Bid.' }; };
  const S2 = { seen: {}, items: [], inbox: [], health: {}, days: {} };
  const one = [Object.assign({}, E.parseFeed(`<rss><item><title>Consultancy: Training of Trainers on Customer Care</title><link>https://example.org/a</link><description>facilitator needed in Kenya</description><pubDate>${now}</pubDate></item></rss>`)[0], { source: 't' })];
  const j = await E.assess(E.sieve(one, S2, P), P, ask); await E.verify(j[0], ask);
  ok(j[0].deadlineConfirmed === true && j[0].deadlineISO === '2099-12-30' && !j[0].closed, 'a deadline written on the page is not confirmed');
  const bad2 = Object.assign({}, j[0], { deadlineConfirmed: false }); const liar = async (p) => (/PAGE TEXT/.test(p.user) ? { isNotice: true, deadline: '1 Jan 2099', deadlineISO: '2099-01-01', deadlineQuote: 'Closing date is 1 January 2099' } : ask(p));
  await E.verify(bad2, liar); ok(bad2.deadlineConfirmed === false, 'a deadline that is NOT on the page was accepted as confirmed');
  const d = await E.draft(j[0], P, ask); ok(d.letter.length > 500 && d.gaps.length === 1, 'the draft writer fails');
  global.fetch = realFetch;
  console.log(bad ? `OPPORTUNITY DESK CHECK FAILED: ${bad}` : 'Opportunity Desk check passed'); process.exit(bad ? 1 : 0);
})();
