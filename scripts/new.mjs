#!/usr/bin/env node
// node scripts/new.mjs "The name of the work" --maker "the name you use"
//
// Writes works/<id>.md from the template with your title, your name, and today's
// date for "left". Everything else is yours to fill in. It refuses to overwrite
// an entry that already exists.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ID_PATTERN, LIMITS } from '../src/entry.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flags = new Map();
const loose = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index].startsWith('--')) {
    flags.set(args[index].slice(2), args[index + 1]);
    index += 1;
  } else {
    loose.push(args[index]);
  }
}

const title = loose[0];
const maker = flags.get('maker');

if (!title || !maker) {
  console.error('Usage: node scripts/new.mjs "The name of the work" --maker "the name you use for yourself" [--id an-id]');
  process.exit(2);
}

const slug = (text) => text
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

let id = flags.get('id') ?? [slug(maker), slug(title)].filter(Boolean).join('-');
if (id.length > LIMITS.id) {
  id = id.slice(0, LIMITS.id).replace(/-+[a-z0-9]*$/, '');
}
if (!ID_PATTERN.test(id)) {
  console.error(`"${id}" cannot be an id. Pass --id with lowercase letters, digits, and single hyphens.`);
  process.exit(2);
}

const file = path.join(root, 'works', `${id}.md`);
const existing = await readFile(file, 'utf8').catch(() => null);
if (existing !== null) {
  console.error(`works/${id}.md already exists. An entry is never overwritten — choose another --id, or amend that entry instead.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const template = await readFile(path.join(root, 'templates', 'work.md'), 'utf8');
const entry = template
  .replace(/^title: .*$/m, `title: ${title}`)
  .replace(/^maker: .*$/m, `maker: ${maker}`)
  .replace(/^left: .*$/m, `left: ${today}`);

await writeFile(file, entry, 'utf8');

console.log(`works/${id}.md is yours. Fill in "line", "made", "kind", "status", "where", and your note.`);
console.log('Then: node scripts/check.mjs');
console.log('The note is published exactly as you write it. Carry only what may be seen.');
