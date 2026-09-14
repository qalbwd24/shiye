import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Optional design-time dependency; the shipped app consumes the generated assets directly.
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHIYE_SHARP_MODULE || 'sharp');
const root = new URL('../public/icons/', import.meta.url);
const svg = await fs.readFile(new URL('shiye.svg', root));
for (const size of [32, 192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`shiye-${size}.png`, root)));
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(
  sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await fs.writeFile(new URL('shiye.ico', root), Buffer.concat([header, ...frames]));
console.log('Built PNG assets and seven-resolution Windows icon from public/icons/shiye.svg');
