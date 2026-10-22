import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same Q path, colour and uniform scale as the verified iPad launcher icon.
// Rounded outer corners are for browsers, which do not apply an iOS icon mask.
const svg = await fs.readFile(path.join(root, 'assets/branding/app-icon.svg'));
for (const name of ['src/app/icon.svg', 'public/logo.svg']) {
  await fs.writeFile(path.join(root, name), svg);
}
for (const [name, size] of [
  ['public/icon-32.png', 32],
  ['public/icon-48.png', 48],
  ['public/icon-192.png', 192],
  ['src/app/apple-icon.png', 180],
]) {
  await sharp(svg).resize(size, size).png().toFile(path.join(root, name));
}
// ICO directory with lossless PNG frames at the advertised favicon sizes.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((frame, i) => {
  const entry = 6 + i * 16;
  directory[entry] = sizes[i];
  directory[entry + 1] = sizes[i];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await fs.writeFile(path.join(root, 'public/favicon.ico'), Buffer.concat([directory, ...frames]));
