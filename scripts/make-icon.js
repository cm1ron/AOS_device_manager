const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../assets/qa-icon-source.png');
const OUT = path.resolve(__dirname, '../assets/qa-icon.ico');
const PNG_OUT = path.resolve(__dirname, '../assets/qa-icon.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const TOP_PAD_RATIO = 0.10; // 위쪽에 캔버스 10% 만큼 투명 패딩 추가 → 그림이 살짝 아래로

(async () => {
  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  const topPad = Math.round(h * TOP_PAD_RATIO);
  const padded = await sharp(SRC)
    .extend({ top: topPad, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(Math.max(w, h + topPad), Math.max(w, h + topPad), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  fs.writeFileSync(PNG_OUT, padded);
  const buffers = await Promise.all(
    SIZES.map((s) => sharp(padded).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
  );
  const ico = await pngToIco(buffers);
  fs.writeFileSync(OUT, ico);
  console.log('OK', OUT, ico.length, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
