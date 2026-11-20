// Owner, 20 Nov 2026: none of our posters should carry Facebook's "AI content" label. The honest way to get that is to
// never publish an AI made image: Facebook is right to label one, and hiding the tag on a realistic picture of real people
// would mislead readers. So every upload first checks the file: if it says it was made by an AI image tool, publishing
// stops with a clear message and the poster must be rebuilt from a real photo in the house style.
// Files that pass have camera details (EXIF, location, notes) removed for privacy before upload.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD']);
function stripPng(b) {
  const out = [b.subarray(0, 8)]; let i = 8;
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i); const type = b.toString('latin1', i + 4, i + 8); const end = i + 12 + len;
    if (end > b.length) break;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end; if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
function stripJpeg(b) {
  const out = [b.subarray(0, 2)]; let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda) { out.push(b.subarray(i)); return Buffer.concat(out); }   // image data: keep the rest as it is
    const len = b.readUInt16BE(i + 2); const seg = b.subarray(i, i + 2 + len);
    const drop = m === 0xe1 || (m >= 0xe2 && m <= 0xef && m !== 0xe2) || m === 0xfe;   // EXIF/XMP, APP3 to APP15 (C2PA lives in APP11), comments; ICC colour (APP2) is kept
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  return b;
}
const AI_MARKS = [/trainedAlgorithmicMedia/i, /compositeWithTrainedAlgorithmicMedia/i, /algorithmicMedia/i, /gpt-image|DALL.?E|ChatGPT/i,
  /Imagen|Gemini|SynthID/i, /Midjourney|Stable Diffusion|Firefly|Ideogram|Leonardo\.ai|Flux/i];
// Only the file's label sections are read (PNG chunks other than image data; JPEG segments before the image data).
function labels(b) {
  const parts = [];
  try {
    if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') {
      let i = 8;
      while (i + 8 <= b.length) { const len = b.readUInt32BE(i); const type = b.toString('latin1', i + 4, i + 8); if (type !== 'IDAT') parts.push(type, b.toString('latin1', i + 8, Math.min(b.length, i + 8 + len))); i += 12 + len; if (type === 'IEND') break; }
    } else if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 4 <= b.length && b[i] === 0xff && b[i + 1] !== 0xda) { const len = b.readUInt16BE(i + 2); parts.push(b.toString('latin1', i + 4, i + 2 + len)); i += 2 + len; }
    }
  } catch (e) {}
  return parts.join('\n');
}
function aiMade(buf) {
  const t = labels(buf);
  if (!t) return null;
  const hit = AI_MARKS.find((r) => r.test(t)); return hit ? hit.source : null;
}
function strip(buf, name = 'poster') {
  const ai = aiMade(buf);
  if (ai) { const e = new Error(`${name} was made with an AI image tool (${ai.replace(/\\/g, '')}). We do not publish AI made images: rebuild it from a real photo in the house style.`); e.aiImage = true; throw e; }
  try {
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return stripPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
  } catch (e) {}
  return buf;
}
module.exports = { strip, aiMade };
