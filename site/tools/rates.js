// Fetches today's market exchange rates for the Kenya shilling (no key needed). Keeps the last good rates if the service is down.
'use strict';
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, '..', 'content', 'data', 'rates.json');
(async () => {
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(20000) })).json();
    const r = j && j.rates; if (!r || !r.KES) throw new Error('no rates');
    const out = { date: new Date((j.time_last_update_unix || Date.now() / 1000) * 1000).toISOString().slice(0, 10), usd: +r.KES.toFixed(2), eur: +(r.KES / r.EUR).toFixed(2), gbp: +(r.KES / r.GBP).toFixed(2), ugx: +(r.UGX / r.KES).toFixed(2), tzs: +(r.TZS / r.KES).toFixed(2), source: 'ExchangeRate-API market rates', url: 'https://www.exchangerate-api.com' };
    fs.writeFileSync(F, JSON.stringify(out, null, 1)); console.log('rates for ' + out.date);
  } catch (e) { console.log('rates not updated: ' + e.message); }
})();
