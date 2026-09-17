#!/usr/bin/env node
// node scripts/build.mjs                       rebuild the line in place
// node scripts/build.mjs --check               say what is stale, change nothing
// node scripts/build.mjs --works <dir> --out <dir>   build a whole site elsewhere

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLine, LineError } from '../src/build.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};

const worksDir = value('--works') ? path.resolve(value('--works')) : path.join(root, 'works');
const outDir = value('--out') ? path.resolve(value('--out')) : root;
const checkOnly = args.includes('--check');
const STATIC = ['styles.css', 'app.js', 'robots.txt', '.nojekyll'];

try {
  const { outputs, works } = await buildLine({ root, worksDir });

  if (checkOnly) {
    const stale = [];
    for (const [name, content] of outputs) {
      const current = await readFile(path.join(outDir, name), 'utf8').catch(() => null);
      if (current !== content) stale.push(name);
    }
    if (stale.length) {
      console.error(`The line is out of step with its entries. Stale: ${stale.join(', ')}`);
      console.error('Run: node scripts/build.mjs');
      process.exit(1);
    }
    console.log(`The line is current: ${works.length} plate${works.length === 1 ? '' : 's'}, ${outputs.size} built files.`);
    process.exit(0);
  }

  for (const [name, content] of outputs) {
    const target = path.join(outDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  if (outDir !== root) {
    for (const name of STATIC) {
      await copyFile(path.join(root, name), path.join(outDir, name));
    }
    await mkdir(path.join(outDir, 'templates'), { recursive: true });
    await copyFile(path.join(root, 'templates', 'work.md'), path.join(outDir, 'templates', 'work.md'));
    await mkdir(path.join(outDir, 'works'), { recursive: true });
    for (const name of await readdir(worksDir)) {
      if (name.endsWith('.md')) await copyFile(path.join(worksDir, name), path.join(outDir, 'works', name));
    }
  }

  console.log(`Raised the line: ${works.length} plate${works.length === 1 ? '' : 's'} → ${path.relative(process.cwd(), outDir) || '.'}`);
  for (const name of outputs.keys()) console.log(`  ${name}`);
} catch (error) {
  if (error instanceof LineError) {
    console.error('The line was not built. Nothing was written.\n');
    for (const { file, errors } of error.problems) {
      console.error(file);
      for (const problem of errors) console.error(`  - ${problem}`);
      console.error('');
    }
    process.exit(1);
  }
  throw error;
}
