#!/usr/bin/env node
// node scripts/check.mjs                  check every entry on the line
// node scripts/check.mjs --base main      also check what this branch does to entries
//                                         that were already here
//
// This is the same reading the site is built from, so a green check means the
// line can be raised. It refuses; it never edits.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LineError, loadSite, loadTemplate, readEntries } from '../src/build.mjs';
import { parseEntry } from '../src/entry.mjs';
import { checkMarks } from '../src/marks.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex === -1 ? null : args[baseIndex + 1];

if (baseIndex !== -1 && !base) {
  console.error('--base needs a commit or branch to compare against, such as --base main');
  process.exit(2);
}

const site = await loadSite(root);
const template = parseEntry(await loadTemplate(root, 'work.md'), 'work.md');
let failed = false;

try {
  const works = await readEntries(path.join(root, 'works'), { opened: site.opened, template });
  if (works.length === 0) {
    console.log('The line is empty and valid. Nothing has been left yet.');
  }
  for (const work of works) {
    const state = work.status === 'withdrawn' ? `withdrawn ${work.withdrawn}` : work.status;
    console.log(`  ok  ${work.source}  "${work.title}" — left by ${work.maker} on ${work.left} (${state})`);
  }
  if (works.length) {
    const found = works.filter((work) => work.status !== 'withdrawn').length;
    console.log(`\n${works.length} plate${works.length === 1 ? '' : 's'}, ${found} work${found === 1 ? '' : 's'} on the line.`);
  }
} catch (error) {
  if (!(error instanceof LineError)) throw error;
  failed = true;
  console.error('The line will not carry these entries as written.\n');
  for (const { file, errors } of error.problems) {
    console.error(file);
    for (const problem of errors) console.error(`  - ${problem}`);
    console.error('');
  }
}

if (base) {
  try {
    const problems = checkMarks({ cwd: root, base });
    if (problems.length) {
      failed = true;
      console.error(`\nThis change does not keep the marks already on the line (compared with ${base}).\n`);
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error('');
    } else {
      console.log(`Every entry already on the line keeps its mark (compared with ${base}).`);
    }
  } catch (error) {
    failed = true;
    console.error(`\n${error.message}`);
  }
}

process.exit(failed ? 1 : 0);
