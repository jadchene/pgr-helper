import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/** 生成程序原创书签图标，无需外部图像或字体。 */
const rounded = (x, y, left, top, right, bottom, radius) => {
  if (x < left || x > right || y < top || y > bottom) return false;
  const centerX = Math.max(left + radius, Math.min(right - radius, x));
  const centerY = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
};
/** 超采样抗锯齿输出 RGBA。 */
const size = 256;
const bytes = Buffer.alloc((size * 4 + 1) * size);
for (let row = 0; row < size; row++) {
  for (let column = 0; column < size; column++) {
    const channels = [0, 0, 0, 0];
    for (let sampleY = 0; sampleY < 4; sampleY++) {
      for (let sampleX = 0; sampleX < 4; sampleX++) {
        const x = (column + (sampleX + 0.5) / 4) / 4;
        const y = (row + (sampleY + 0.5) / 4) / 4;
        if (!rounded(x, y, 2, 2, 62, 62, 15)) continue;
        const outline = rounded(x, y, 18, 12, 47, 53, 4) && !rounded(x, y, 21, 15, 44, 50, 1);
        const bottom = y >= 43 && y <= 46 && x >= 20 && x <= 45;
        const bookmark = x >= 27 && x <= 38 && y >= 14 && y <= 30 - Math.min(x - 27, 38 - x) * 0.8;
        const color = outline || bottom || bookmark ? [255, 255, 255, 255] : [249, 115, 22, 255];
        color.forEach((value, index) => { channels[index] += value; });
      }
    }
    const offset = row * (size * 4 + 1) + 1 + column * 4;
    channels.forEach((value, index) => { bytes[offset + index] = Math.round(value / 16); });
  }
}
/** PNG 块 CRC 校验。 */
const crc = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
/** 编码一个标准 PNG 块。 */
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
  return Buffer.concat([header, body, checksum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../resources/icon.png', import.meta.url), png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(new URL('../resources/icon.ico', import.meta.url), Buffer.concat([ico, png]));
