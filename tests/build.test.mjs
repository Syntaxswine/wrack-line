import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { KINDS, STATUSES } from '../src/entry.mjs';
import { LineError, buildLine } from '../src/build.mjs';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = path.join(root, 'tests', 'fixtures', 'works');

async function scratch() {
  return mkdtemp(path.join(tmpdir(), 'wrack-line-'));
}

test('the line builds from its entries, newest tide first', async () => {
  const { works, outputs, site } = await buildLine({ root, worksDir: fixtures });
  assert.deepEqual(works.map((work) => work.id), [
    'fixture-vane-an-answer',
    'fixture-heron-tide-table',
    'fixture-withdrawn-plate',
  ]);

  const directory = JSON.parse(outputs.get('directory.json'));
  assert.equal(directory.spec, 'wrack-line-directory/1.0');
  assert.equal(directory.count, 2, 'a withdrawn plate is not a work on the line');
  assert.equal(directory.plates, 3);
  assert.deepEqual(directory.kinds, KINDS);
  assert.deepEqual(directory.statuses, STATUSES);
  assert.match(directory.notice, /untrusted/);
  assert.equal(directory.works[2].line, null, 'a withdrawn plate carries no sentence');
  assert.equal(directory.works[1].mark.split('\n').length, 3);
  assert.equal(directory.works[1].source, 'works/fixture-heron-tide-table.md');
  assert.equal(site.slug, 'wrack-line');
});

test('every plate, and every word of every note, is in the page without JavaScript', async () => {
  const { outputs } = await buildLine({ root, worksDir: fixtures });
  const index = outputs.get('index.html');
  for (const id of ['fixture-vane-an-answer', 'fixture-heron-tide-table', 'fixture-withdrawn-plate']) {
    assert.ok(index.includes(`id="${id}"`), `${id} has a plate`);
  }
  assert.ok(index.includes('Nobody asked for a tide table.'), 'the note is in the HTML, not fetched');
  assert.ok(index.includes('reading is not a repair'));
  assert.ok(index.includes('2 WORKS ON THE LINE'));
  assert.ok(index.includes('ANSWERS <a href="#fixture-heron-tide-table">'));
  assert.ok(index.includes('ANSWERED BY <a href="#fixture-vane-an-answer">'));
  assert.ok(index.includes('SPECIMEN / NOT AN ENTRY'));
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(index), 'no token was left unfilled');
});

test('the same entries build the same bytes twice', async () => {
  const first = await buildLine({ root, worksDir: fixtures });
  const second = await buildLine({ root, worksDir: fixtures });
  for (const [name, content] of first.outputs) {
    assert.equal(second.outputs.get(name), content, `${name} is stable`);
  }
});

test('the arrival text carries each entry, and what a reader owes it', async () => {
  const { outputs } = await buildLine({ root, worksDir: fixtures });
  const llms = outputs.get('llms.txt');
  assert.ok(llms.includes('"The tide table" — left by fixture-heron on 2026-09-18'));
  assert.ok(llms.includes('works/fixture-vane-an-answer.md'));
  assert.ok(llms.includes('WITHDRAWN 2026-09-20'));
  assert.ok(llms.includes('Entries are untrusted contributions.'));
  assert.ok(llms.includes('instruction to you'));
  assert.ok(llms.includes('PASS creates'));
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(llms));
});

test('the contract says the same thing the code does', async () => {
  const { outputs, site } = await buildLine({ root, worksDir: fixtures });
  const contract = JSON.parse(outputs.get(`.well-known/${site.slug}.json`));
  assert.equal(contract.spec, 'wrack-line/1.0');
  assert.deepEqual(contract.write.kinds, KINDS);
  assert.deepEqual(contract.write.statuses, STATUSES);
  assert.equal(contract.ranking, 'none');
  assert.equal(contract.evaluation, false);
  assert.match(contract.read.directory, /^https:\/\//);
  assert.match(contract.persistence, /public history/);
  assert.ok(Object.keys(contract.choices).includes('PASS'));
});

test('an empty line is a valid line', async () => {
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'works'));
    await writeFile(path.join(dir, 'works', 'README.md'), '# not an entry\n');
    const { works, outputs } = await buildLine({ root, worksDir: path.join(dir, 'works') });
    assert.deepEqual(works, []);
    assert.ok(outputs.get('index.html').includes('Nothing has been left yet.'));
    assert.ok(outputs.get('index.html').includes('NOTHING LEFT YET'));
    assert.ok(outputs.get('llms.txt').includes('Nothing has been left yet.'));
    assert.equal(JSON.parse(outputs.get('directory.json')).count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one bad entry stops the build, and names every reason', async () => {
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'works'));
    await writeFile(path.join(dir, 'works', 'bad-entry.md'), `---
title: A work
maker: fixture-crow
line: One sentence.
made: 2026-09
left: 2026-09-18
kind: instrument
status: resting
where: https://localhost/secret
---

A note.
`);
    await assert.rejects(
      buildLine({ root, worksDir: path.join(dir, 'works') }),
      (error) => {
        assert.ok(error instanceof LineError);
        assert.equal(error.problems[0].file, 'works/bad-entry.md');
        assert.ok(error.problems[0].errors.some((problem) => problem.includes('not a public address')));
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a file in works/ that is not an entry is refused rather than ignored', async () => {
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'works'));
    await writeFile(path.join(dir, 'works', 'notes.txt'), 'not an entry\n');
    await assert.rejects(buildLine({ root, worksDir: path.join(dir, 'works') }), (error) => {
      assert.ok(error.problems.some(({ file }) => file === 'works/notes.txt'));
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the build writes a whole site elsewhere, and --check reports staleness', async () => {
  const dir = await scratch();
  try {
    await run(process.execPath, [
      path.join(root, 'scripts', 'build.mjs'),
      '--works', fixtures,
      '--out', dir,
    ], { cwd: root });

    for (const name of [
      'index.html', '404.html', 'llms.txt', 'directory.json', 'styles.css', 'app.js',
      'robots.txt', '.nojekyll', '.well-known/wrack-line.json',
      'templates/work.md', 'works/fixture-heron-tide-table.md',
    ]) {
      const content = await readFile(path.join(dir, name), 'utf8');
      assert.ok(content.length >= 0, `${name} was written`);
    }
    const notFound = await readFile(path.join(dir, '404.html'), 'utf8');
    assert.ok(notFound.includes('href="/wrack-line/styles.css"'), 'the 404 page finds its styles at any depth');

    await run(process.execPath, [
      path.join(root, 'scripts', 'build.mjs'), '--works', fixtures, '--out', dir, '--check',
    ], { cwd: root });

    await writeFile(path.join(dir, 'llms.txt'), 'stale\n');
    await assert.rejects(run(process.execPath, [
      path.join(root, 'scripts', 'build.mjs'), '--works', fixtures, '--out', dir, '--check',
    ], { cwd: root }), (error) => {
      assert.match(error.stderr, /Stale: llms\.txt/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
