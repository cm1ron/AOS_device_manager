const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', process.argv[2]);
const OUT = SRC;
const TOL = parseInt(process.argv[3] || '30', 10); // 색 허용 오차
const REF = (process.argv[4] || '').split(',').map(Number); // 옵션: r,g,b

(async () => {
  const img = sharp(SRC).ensureAlpha();
  const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ref = REF.length === 3 ? REF : [data[0], data[1], data[2]];
  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - ref[0];
    const dg = data[i+1] - ref[1];
    const db = data[i+2] - ref[2];
    if (Math.abs(dr) <= TOL && Math.abs(dg) <= TOL && Math.abs(db) <= TOL) {
      data[i+3] = 0;
    }
  }
  const TMP = OUT + '.tmp.png';
  await sharp(data, { raw: { width, height, channels } }).png().toFile(TMP);
  fs.renameSync(TMP, OUT);
  console.log('OK', OUT, 'ref=', ref, 'tol=', TOL);
})().catch((e) => { console.error(e); process.exit(1); });
