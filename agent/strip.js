// Removes hidden labels (C2PA "made with AI" content credentials, XMP, EXIF, text notes) from PNG and JPEG files
// before they are uploaded, so Facebook never adds an "AI info" tag because of what an editing tool left in the file.
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
function strip(buf) {
  try {
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return stripPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
  } catch (e) {}
  return buf;
}
module.exports = { strip };
