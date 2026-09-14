import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Optional design-time dependency; the shipped app consumes the generated assets directly.
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHIYE_SHARP_MODULE || 'sharp');
const root = new URL('../public/icons/', import.meta.url);
const svg = await fs.readFile(new URL('shiye.svg', root));
// Render the vector at the target density; do not enlarge a 256px raster for HD output.
const render = (size) => sharp(svg, { density: (72 * size) / 256 }).resize(size, size);
for (const size of [32, 64, 192, 512, 1024]) {
  await render(size)
    .png()
    .toFile(fileURLToPath(new URL(`shiye-${size}.png`, root)));
}
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const frames = await Promise.all(sizes.map((size) => render(size).png().toBuffer()));
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
// A new filename also avoids Windows reusing the previous shortcut icon cache.
await fs.writeFile(new URL('shiye-hd.ico', root), Buffer.concat([header, ...frames]));
console.log('Built native-resolution PNG assets and ten-resolution Windows icons from SVG');
