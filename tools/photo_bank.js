// Builds agent/assets/leaders: one freely licensed photo per Kenyan public figure, taken from the lead image of
// their Wikipedia article (hosted on Wikimedia Commons), with the licence and photographer recorded for the small credit.
// Only public domain, CC0, CC BY and CC BY-SA photos are kept. Run from GitHub Actions (photo bank workflow).
const fs = require('fs'), path = require('path');
const UA = { 'User-Agent': 'SautiMediaPhotoBank/1.0 (timmuli24@gmail.com)' };
const NAMES = ['William Ruto', 'Kithure Kindiki', 'Rigathi Gachagua', 'Kalonzo Musyoka', 'Raila Odinga', 'Musalia Mudavadi', 'Johnson Sakaja', 'Ferdinand Waititu',
  'Wavinya Ndeti', 'Mutula Kilonzo Junior', 'Julius Malombe', 'Alfred Mutua', 'Charity Ngilu', 'Kipchumba Murkomen', 'John Mbadi', 'Aden Duale', "Moses Wetang'ula",
  'Amason Kingi', 'Martha Karua', 'Eugene Wamalwa', "Fred Matiang'i", 'Edwin Sifuna', 'Gladys Wanga', "Anyang' Nyong'o", 'Simba Arati', 'Junet Mohamed',
  "Kimani Ichung'wah", 'Opiyo Wandayi', 'Ababu Namwamba', 'Hassan Joho', 'Mike Sonko', 'Uhuru Kenyatta', 'Martha Koome', 'Okiya Omtatah', 'Babu Owino',
  'Anne Waiguru', 'Kimani Wamatangi', 'Mike Mbuvi Sonko', 'Justin Muturi', 'Mithika Linturi', 'Moses Kuria', 'Peter Salasya', 'Ndindi Nyoro', 'Gideon Moi',
  'Cleophas Malala', 'Oscar Sudi', 'Millicent Omanga', 'Susan Kihika', 'Fatuma Achani', 'Ali Hassan Joho', 'Stephen Kalonzo Musyoka', 'Raila Odinga Junior',
  'Winnie Odinga', 'Rosemary Odinga', 'Ida Odinga', 'Paul Kihara Kariuki', 'Githu Muigai', 'Dorcas Oduor', 'Geoffrey Ruku', 'Musalia Mudavadi', 'Kipchumba Murkomen', 'Julius Ogamba', 'John Mbadi', 'Hassan Joho', 'Salim Mvurya', 'Rebecca Miano', 'Aisha Jumwa', 'Ezekiel Machogu', 'David Maraga', 'Willy Mutunga', 'Philomena Mwilu', 'Nelson Havi', 'Ahmednasir Abdullahi', 'Kindiki Kithure', 'Anyang Nyongo', 'Kenneth Marende', 'Moses Kuria', 'Stephen Mbogo', 'Wycliffe Oparanya', 'Hillary Barchok', 'Abdulswamad Nassir', 'Natembeya George', 'Kawira Mwangaza'];
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '_');
(async () => {
  const dir = path.join(__dirname, '..', 'agent', 'assets', 'leaders'); fs.mkdirSync(dir, { recursive: true });
  const idxF = path.join(dir, 'index.json'); let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) {}
  for (const name of NAMES) {
    const key = slug(name); if (idx[key] && idx[key].file && fs.existsSync(path.join(dir, idx[key].file))) continue;
    try {
      const w = await (await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=original|name&titles=' + encodeURIComponent(name), { headers: UA })).json();
      const pg = Object.values((w.query && w.query.pages) || {})[0]; if (!pg || !pg.pageimage) { idx[key] = { name, missing: 'no lead image' }; continue; }
      const c = await (await fetch('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1200&titles=' + encodeURIComponent('File:' + pg.pageimage), { headers: UA })).json();
      const cp = Object.values((c.query && c.query.pages) || {})[0]; const ii = cp && cp.imageinfo && cp.imageinfo[0];
      if (!ii) { idx[key] = { name, missing: 'image not on Commons (may be non free)' }; continue; }
      const md = ii.extmetadata || {}; const lic = String((md.LicenseShortName || {}).value || '').trim();
      const free = /^(cc0|public domain|pd)/i.test(lic), by = /^cc[ -]by(-sa)?( \d|$)/i.test(lic);
      if (!free && !by) { idx[key] = { name, missing: 'licence not usable: ' + lic }; continue; }
      if (ii.mime !== 'image/jpeg') { idx[key] = { name, missing: 'not a photo file' }; continue; }
      const artist = String((md.Artist || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (!free && !artist) { idx[key] = { name, missing: 'no photographer name' }; continue; }
      const buf = Buffer.from(await (await fetch(ii.thumburl || ii.url, { headers: UA })).arrayBuffer());
      fs.writeFileSync(path.join(dir, key + '.jpg'), buf);
      idx[key] = { name, title: pg.title, file: key + '.jpg', credit: free ? '' : `${artist}, ${lic}`, source: ii.descriptionurl || '', w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height };
    } catch (e) { idx[key] = { name, missing: String(e.message).slice(0, 80) }; }
    await new Promise((r) => setTimeout(r, 400));
  }
  fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
  console.log(Object.values(idx).filter((x) => x.file).length + ' photos, ' + Object.values(idx).filter((x) => !x.file).length + ' missing');
})();
