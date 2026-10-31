// Generate isolated Modded actor/model copies without altering the source actors.
// Long state machines are equivalent apart from explicitly listed substitutions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const read = f => fs.readFileSync(f, 'utf8').replace(/\r/g, '');
function block(text, kind, name) {
  const start = text.search(new RegExp(`^${kind} ${name}(?=\\s|:)`, 'im'));
  if (start < 0) return null;
  let depth = 0;
  for (let p = text.indexOf('{', start); p < text.length; p++) {
    if (text[p] === '{') depth++;
    if (text[p] === '}' && --depth === 0) return text.slice(start, p + 1);
  }
  throw new Error(`Unclosed ${name}`);
}
const sources = config.sources.map(read).join('\n');
const replacements = new Map(config.actors.map(n => [n, n + '_Modded']));
for (const [from, to] of Object.entries(config.sprites || {})) replacements.set(from, to);
for (const [from, to] of Object.entries(config.sounds || {})) replacements.set(from, to);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regex = new RegExp(`(?<![\\w])(?:${[...replacements.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|')})(?![\\w])`, 'g');
const convert = text => text.replace(regex, key => replacements.get(key));
const header = `// Generated from ${process.argv[2].replaceAll('\\','/')} by Tools/WeaponSkinActors.cjs.\n// Customize this independent copy; regeneration refuses changed output.\n\n`;
const trimLines = text => text.replace(/[ \t]+$/gm, '');
const output = header + config.actors.map(n => { const b = block(sources, 'Actor', n); assert(b, n); return trimLines(convert(b)); }).join('\n\n') + '\n';
const target = `Decorate/Weapons/Modded/${config.weapon}.QCD`;
if (fs.existsSync(target)) assert.equal(trimLines(read(target)), output, `Refusing to overwrite customized ${target}`);
const modelSource = read('MODELDEF.WPN'), models = [];
if (config.modelPath) for (const n of config.actors) {
  const b = block(modelSource, 'Model', n);
  if (b) models.push(trimLines(convert(b).replace(/Path "[^"]+"/i, `Path "${config.modelPath}"`)));
}
let modelOutput = modelSource;
if (models.length) {
  const start = `// BEGIN GENERATED ${config.weapon} MODELS`, end = `// END GENERATED ${config.weapon} MODELS`;
  const section = `${start}\n${models.join('\n\n')}\n${end}\n`;
  const p = modelSource.indexOf(start);
  if (p >= 0) { const q = modelSource.indexOf(end, p); assert(q >= p); assert.equal(trimLines(modelSource.slice(p,q+end.length)).trim(),section.trim(), 'Generated models were customized'); modelOutput = modelSource.slice(0,p) + section.trimEnd() + modelSource.slice(q+end.length); }
  else modelOutput = modelSource.trimEnd() + '\n\n' + section;
}
fs.mkdirSync(path.dirname(target), {recursive:true});
fs.writeFileSync(target, output);
if (modelOutput !== modelSource) fs.writeFileSync('MODELDEF.WPN', modelOutput);
console.log(`${config.weapon}: generated/verified ${config.actors.length} isolated actors and ${models.length} model definitions.`);
