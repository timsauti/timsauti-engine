// Second look at the topic photo bank: these photos go on stories about other people, so any photo where a person's
// face can be clearly recognised (or that shows a well known public figure) is removed. Scenes, buildings, crowds seen
// from afar and objects stay.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'agent', 'assets', 'topics'); const idxF = path.join(dir, 'index.json');
const idx = JSON.parse(fs.readFileSync(idxF, 'utf8'));
async function ask(buf) {
  const key = process.env.GEMINI_API_KEY;
  for (const m of ['gemma-4-26b-a4b-it']) {   // a model the agent does not use, so the photo bank can never use up the agent's daily allowance
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'This photo will be used as a generic background for news stories about other people. Can any single person in it be clearly recognised from their face (a close or medium shot where the face is sharp and easy to see), or does it show a well known public figure? Crowds or people seen from far away, from behind or too small to recognise do not count. Return JSON {"recognisable":true|false}' }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }], generationConfig: { temperature: 0 } }) });
      const j = await r.json(); if (!r.ok) { await new Promise((x) => setTimeout(x, 20000)); continue; }
      { const tx = j.candidates[0].content.parts.map((x) => x.text || '').join(''); const m2 = tx.match(/\{[^{}]*\}/); if (!m2) return null; return JSON.parse(m2[0]).recognisable === true; }
    } catch (e) {}
  }
  return null;   // the check could not run: keep the photo for now, it is checked again next time
}
(async () => {
  let removed = 0;
  for (const [t, list] of Object.entries(idx)) {
    const keep = [];
    for (const p of list) {
      const f = path.join(dir, p.file); if (!fs.existsSync(f)) continue;
      if (p.cleanChecked) { keep.push(p); continue; }
      const v = await ask(fs.readFileSync(f));
      if (v === true) { fs.unlinkSync(f); removed++; } else { if (v === false) p.cleanChecked = true; keep.push(p); }
      await new Promise((r) => setTimeout(r, 4500));   // stay under the AI's per minute limit
    }
    idx[t] = keep;
  }
  fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
  console.log('removed ' + removed + '; ' + Object.entries(idx).map(([k, v]) => k + ':' + v.length).join(' '));
})();
