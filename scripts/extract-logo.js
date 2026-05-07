// node scripts/extract-logo.js <relativeSrc> <leftRatio> <rightRatio>
// 검은 배경을 제거 + 로고만 추출 (좌측 leftRatio~rightRatio 영역만 크롭 후 자동 trim)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', process.argv[2]);
const LEFT = parseFloat(process.argv[3] || '0');
const RIGHT = parseFloat(process.argv[4] || '0.5');
const TOL = parseInt(process.argv[5] || '40', 10);

(async () => {
  const meta0 = await sharp(SRC).metadata();
  const x = Math.floor(meta0.width * LEFT);
  const w = Math.floor(meta0.width * (RIGHT - LEFT));

  const cropped = await sharp(SRC)
    .extract({ left: x, top: 0, width: w, height: meta0.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = cropped;
  const { width, height, channels } = info;
  // 검은 배경 제거 (좌상단 픽셀 ref)
  const ref = [data[0], data[1], data[2]];
  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - ref[0];
    const dg = data[i+1] - ref[1];
    const db = data[i+2] - ref[2];
    if (Math.abs(dr) <= TOL && Math.abs(dg) <= TOL && Math.abs(db) <= TOL) {
      data[i+3] = 0;
    }
  }
  // 자동 trim → 정사각형 패딩
  const trimmed = await sharp(data, { raw: { width, height, channels } })
    .png()
    .trim()
    .toBuffer({ resolveWithObject: true });
  const tw = trimmed.info.width;
  const th = trimmed.info.height;
  const size = Math.max(tw, th);
  const tmp = SRC + '.tmp.png';
  await sharp(trimmed.data ? Buffer.from(trimmed.data) : await sharp(data, { raw: { width, height, channels } }).png().trim().toBuffer())
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(tmp);
  fs.renameSync(tmp, SRC);
  console.log('OK', SRC, `${tw}x${th} → ${size}x${size}`);
})().catch((e) => { console.error(e); process.exit(1); });
