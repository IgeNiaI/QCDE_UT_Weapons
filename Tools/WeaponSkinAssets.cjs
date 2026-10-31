// Generate repetitive sprite aliases/brightmaps from a reviewed weapon manifest.
// Existing artwork is retained as compatibility sources; Modded frames are independent.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const read = f => fs.readFileSync(f, 'utf8').replace(/\r/g, '');
const root = `Sprites/Weapons/${manifest.weapon}`;
const maps = new Map([...read('GLDEFS.UTD').matchAll(/brightmap sprite (\w+)\s*\{\s*map "([^"]+)"\s*\}/g)].map(m => [m[1], m[2]]));
const aliases = [], brightmaps = [], writes = new Map();
function queue(file, bytes) {
  if (writes.has(file)) assert.deepEqual(writes.get(file), bytes, file);
  if (fs.existsSync(file)) assert.deepEqual(fs.readFileSync(file), bytes, `Refusing to overwrite changed asset: ${file}`);
  writes.set(file, bytes);
}
function metadata(bytes) {
  const result = {w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20), x: 0, y: 0};
  for (let p = 8; p < bytes.length;) {
    const len = bytes.readUInt32BE(p);
    if (bytes.toString('ascii', p + 4, p + 8) === 'grAb') {
      result.x = bytes.readInt32BE(p + 8);
      result.y = bytes.readInt32BE(p + 12);
    }
    p += len + 12;
  }
  return result;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const t = Buffer.from(type), n = Buffer.alloc(4), c = Buffer.alloc(4);
  n.writeUInt32BE(bytes.length); c.writeUInt32BE(crc32(Buffer.concat([t, bytes])));
  return Buffer.concat([n, t, bytes, c]);
}
function blackMap(bytes) {
  const {w, h, x, y} = metadata(bytes), hdr = Buffer.alloc(13), grab = Buffer.alloc(8);
  hdr.writeUInt32BE(w); hdr.writeUInt32BE(h, 4); hdr[8] = 8; hdr[9] = 2;
  grab.writeInt32BE(x); grab.writeInt32BE(y, 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', hdr), chunk('grAb', grab), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}
for (const skin of [...manifest.skins, {name: 'Modded', prefix: 'MD', source: manifest.base}]) {
  const source = skin.source ? manifest.skins.find(s => s.name === skin.source) : skin;
  assert(source, skin.name);
  const modded = skin.prefix === 'MD';
  aliases.push(`// ${skin.name} ${manifest.weapon}`);
  for (const phase of manifest.phases) {
    const unique = new Map();
    const letters = phase.frames || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, phase.source.length);
    assert.equal(letters.length, phase.source.length);
    for (let i = 0; i < letters.length; i++) {
      const f = letters[i], old = phase.source[i], name = `${skin.prefix}${phase.set}${manifest.id}${f}0`;
      const oldName = `${source.prefix}G${phase.sourceId || manifest.id}${old}0`;
      const bytes = fs.readFileSync(`${root}/${source.name}/${oldName}.png`);
      const dir = `${root}/${skin.name}/_${phase.set}_${phase.name}`;
      if (!modded && unique.has(old)) {
        const {w, h, x, y} = metadata(bytes);
        aliases.push(`Sprite ${name}, ${w}, ${h} { Offset ${x}, ${y}\t\tPatch ${unique.get(old)}, 0, 0 }`);
      } else {
        queue(`${dir}/${name}.png`, bytes);
        unique.set(old, name);
      }
      const originalMap = maps.get(oldName);
      if (modded) {
        const file = `${dir}/_${phase.map}_brightmaps/MD${phase.map}${manifest.id}${f}0.png`;
        queue(file, originalMap ? fs.readFileSync(originalMap) : blackMap(bytes));
        brightmaps.push(`brightmap sprite ${name} { map "${file}" }`);
      } else if (originalMap) brightmaps.push(`brightmap sprite ${name} { map "${originalMap}" }`);
    }
  }
}
for (const [from, to] of manifest.copies || []) queue(to, fs.readFileSync(from));
function generated(file, lines) {
  const marker = `// BEGIN GENERATED ${manifest.weapon} SKIN FRAMES`;
  const end = `// END GENERATED ${manifest.weapon} SKIN FRAMES`;
  const section = `${marker}\n${lines.join('\n')}\n${end}\n`;
  const old = read(file), start = old.indexOf(marker);
  if (start < 0) return old.trimEnd() + '\n\n' + section;
  const stop = old.indexOf(end, start); assert(stop >= start, file);
  assert.equal(old.slice(start, stop + end.length).trim(), section.trim(), `Generated section was edited: ${file}`);
  return old;
}
const textures = generated('TEXTURES.UTD', aliases);
const gldefs = generated('GLDEFS.UTD', brightmaps);
for (const [file, bytes] of writes) {
  if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes, {flag: 'wx'}); }
  assert.deepEqual(fs.readFileSync(file), bytes);
}
fs.writeFileSync('TEXTURES.UTD', textures);
fs.writeFileSync('GLDEFS.UTD', gldefs);
console.log(`${manifest.weapon}: verified ${writes.size} assets, ${aliases.filter(l => l.startsWith('Sprite')).length} aliases and ${brightmaps.length} brightmaps.`);
