// Makes private judge codes for a challenge: writes only the scrambled code (hash) into the challenge file and prints the codes once,
// so they can be given privately to each judge. Usage: node tools/judgecodes.js content/challenges/<file>.json "Name|Role" "Name|Role"
'use strict';
const fs = require('fs'), crypto = require('crypto');
const [file, ...people] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(file, 'utf8')); c.judges = c.judges || [];
const words = 'pesa,simu,kazi,mbegu,jua,mvua,soko,tembo,simba,nyota,mlima,ziwa,daraja,bustani,taa,ramani'.split(',');
for (const p of people) {
  const [name, role] = p.split('|');
  const code = words[crypto.randomInt(words.length)] + '-' + crypto.randomBytes(5).toString('hex') + '-' + crypto.randomInt(100, 999);
  c.judges = c.judges.filter((j) => j.name !== name).concat([{ name, role: role || '', codeHash: crypto.createHash('sha256').update(code).digest('hex') }]);
  console.log(`${name}: ${code}`);
}
fs.writeFileSync(file, JSON.stringify(c, null, 1));
