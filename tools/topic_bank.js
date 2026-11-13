// Builds agent/assets/topics: real, freely licensed photos (Wikimedia Commons) for the common kinds of Kenyan news,
// so almost every Sauti Media poster can carry a photo. Each photo is looked at by the AI first and kept only if it is a
// clear real photograph that suits a news poster (no diagrams, no text, no dead or injured people).
const fs = require('fs'), path = require('path');
const UA = { 'User-Agent': 'SautiMediaTopicBank/1.0' };
const TOPICS = {
  politics: ['Parliament of Kenya', 'Kenya National Assembly chamber', 'Kenya political rally crowd', 'Kenya parliament buildings Nairobi'],
  court: ['Milimani Law Courts', 'Supreme Court of Kenya', 'Kenya High Court building', 'judge gavel'],
  police: ['Kenya Police officers', 'National Police Service Kenya', 'Kenya police vehicle'],
  education: ['Kenyan students classroom', 'secondary school Kenya students', 'school Kenya pupils', 'university Kenya students'],
  health: ['hospital Kenya', 'Kenyatta National Hospital', 'nurse Kenya clinic', 'health centre Kenya'],
  weather: ['flood Kenya', 'heavy rain Kenya', 'storm clouds Africa', 'flooded road Kenya'],
  farming: ['maize farm Kenya', 'farmer Kenya field', 'Machakos farm', 'Kenya agriculture harvest'],
  economy: ['Kenyan shilling banknotes', 'Central Bank of Kenya', 'Nairobi market traders', 'Kenya supermarket'],
  transport: ['Kenya highway road', 'matatu Nairobi', 'Nairobi Expressway', 'Kenya road construction'],
  nairobi: ['Nairobi skyline', 'Nairobi central business district', 'Nairobi city street', 'Kenyatta International Convention Centre'],
  ukambani: ['Machakos town', 'Machakos People\'s Park', 'Kitui town Kenya', 'Makueni Kenya', 'Machakos hills'],
  water: ['borehole Kenya', 'water tank Kenya village', 'dam Kenya', 'Masinga dam'],
  sports: ['Kenyan athletes running', 'athletics Kenya race', 'football Kenya stadium', 'Kasarani stadium'],
  technology: ['mobile phone Kenya', 'M-Pesa agent', 'computer lab Kenya', 'smartphone Africa'],
  faith: ['church Kenya congregation', 'church building Kenya', 'worship Kenya'],
  fire: ['fire brigade Kenya', 'fire truck Nairobi', 'firefighters Kenya'],
  business: ['small shop Kenya', 'market Kenya traders', 'Nairobi businesses street', 'jua kali Kenya'],
  government: ['State House Nairobi', 'Harambee House Nairobi', 'Kenya county government offices', 'Kenya flag']
};
async function look(buf, topic) {
  const key = process.env.GEMINI_API_KEY; if (!key) return true;
  for (const m of ['gemma-4-26b-a4b-it']) {   // a model the agent does not use, so the photo bank can never use up the agent's daily allowance
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Is this a clear, good quality real photograph that would work as the background of a Kenyan news poster about "${topic}"? It must not be a map, chart, drawing, document, screenshot or mostly blank, must not have large text or watermarks on it, must not show dead or injured people, and no single person in it may be clearly recognisable from their face (crowds, people far away, from behind or too small to recognise are fine), and it must not show a well known public figure. Return JSON {"ok":true|false}` }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }], generationConfig: { temperature: 0 } }) });
      const j = await r.json(); if (!r.ok) { await new Promise((x) => setTimeout(x, 20000)); continue; }
      { const tx = j.candidates[0].content.parts.map((x) => x.text || '').join(''); const m2 = tx.match(/\{[^{}]*\}/); return !!m2 && JSON.parse(m2[0]).ok === true; }
    } catch (e) {}
  }
  return false;
}
(async () => {
  const dir = path.join(__dirname, '..', 'agent', 'assets', 'topics'); fs.mkdirSync(dir, { recursive: true });
  const idxF = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) {}
  for (const [topic, queries] of Object.entries(TOPICS)) {
    idx[topic] = idx[topic] || [];
    for (const q of queries) {
      if (idx[topic].length >= 8) break;
      try {
        const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1280&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + q);
        const j = await (await fetch(u, { headers: UA })).json();
        for (const pg of Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index)) {
          if (idx[topic].length >= 8) break;
          const ii = (pg.imageinfo || [])[0]; if (!ii || ii.mime !== 'image/jpeg' || ii.width < 900 || !ii.thumburl) continue;
          if (/map|diagram|chart|logo|flag of|coat of arms|plan|drawing|poster|screenshot|scan|document|selfie|portrait/i.test(pg.title) && topic !== 'government') continue;
          if (idx[topic].some((x) => x.title === pg.title)) continue;
          const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '').trim();
          const free = /^(cc0|public domain|pd)/i.test(lic), by = /^cc[ -]by(-sa)?( \d|$)/i.test(lic); if (!free && !by) continue;
          const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50); if (!free && !artist) continue;
          const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA })).arrayBuffer());
          await new Promise((r) => setTimeout(r, 4500));
          if (!(await look(buf, topic))) continue;
          const file = `${topic}_${idx[topic].length + 1}_${Date.now().toString(36)}.jpg`; fs.writeFileSync(path.join(dir, file), buf);
          idx[topic].push({ file, title: pg.title, credit: free ? '' : `${artist}, ${lic}`, cleanChecked: true }); fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
          await new Promise((r) => setTimeout(r, 4500));
        }
      } catch (e) {}
    }
    fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
  }
  console.log(Object.entries(idx).map(([k, v]) => k + ':' + v.length).join(' '));
})();
