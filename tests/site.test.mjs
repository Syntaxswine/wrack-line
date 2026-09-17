// "The line does not keep visits" is only true if the page cannot keep them.
// These checks hold the page to what the terms of deposit claim.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { KEYS, KINDS, STATUSES, parseEntry, validateEntry } from '../src/entry.mjs';
import { loadSite, readEntries } from '../src/build.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8');

test('the page loads nothing from anywhere else', async () => {
  for (const file of [['templates', 'index.html'], ['templates', '404.html']]) {
    const html = await read(...file);
    for (const [, source] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(source.startsWith('./'), `${file.join('/')} loads a script from ${source}`);
    }
    for (const [, href] of html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)) {
      assert.ok(href.startsWith('./') || href.startsWith('{{BASE}}'), `${file.join('/')} loads styles from ${href}`);
    }
    assert.ok(!/<img|<iframe|<video|<audio|<object|<embed/.test(html), `${file.join('/')} embeds no remote media`);
  }

  const css = await read('styles.css');
  assert.ok(!css.includes('@import'), 'the stylesheet imports nothing');
  assert.ok(!/url\(\s*['"]?https?:/.test(css), 'the stylesheet fetches nothing');
  // Plates are grids and the sifting row is a flex row, so [hidden] needs to win
  // over their own display rules or filtering silently stops hiding anything.
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, 'the stylesheet makes [hidden] hide');

  const js = await read('app.js');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'sendBeacon', 'WebSocket', 'EventSource']) {
    assert.ok(!js.includes(forbidden), `app.js does not use ${forbidden}`);
  }
});

test('the page declares what it is allowed to do, and it is very little', async () => {
  const html = await read('templates', 'index.html');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'the page carries a content security policy');
  assert.match(csp[1], /default-src 'none'/);
  assert.match(csp[1], /script-src 'self'/);
  assert.match(csp[1], /form-action 'none'/);
  assert.ok(!csp[1].includes('unsafe-inline'));
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('a machine arriving at the root is told where to begin', async () => {
  const robots = await read('robots.txt');
  assert.match(robots, /llms\.txt/);
  assert.match(robots, /directory\.json/);
});

test('the format guide describes every key, kind, and status the code accepts', async () => {
  const guide = await read('works', 'README.md');
  for (const key of KEYS) assert.ok(guide.includes(`\`${key}\``), `works/README.md describes "${key}"`);
  for (const kind of KINDS) assert.ok(guide.includes(`\`${kind}\``), `works/README.md lists the kind "${kind}"`);
  for (const status of STATUSES) assert.ok(guide.includes(`\`${status}\``), `works/README.md lists the status "${status}"`);
});

test('the specimen in the instructions is a valid entry', async () => {
  const site = await loadSite(root);
  const specimen = parseEntry(await read('templates', 'specimen.md'), 'specimen.md');
  assert.deepEqual(validateEntry(specimen, { opened: site.opened }), []);
});

test('every entry actually on the line is valid right now', async () => {
  const site = await loadSite(root);
  const template = parseEntry(await read('templates', 'work.md'), 'work.md');
  try {
    const works = await readEntries(path.join(root, 'works'), { opened: site.opened, template });
    assert.ok(Array.isArray(works));
  } catch (error) {
    if (!error.problems) throw error;
    // Say which entry and why, rather than making a maker read a stack trace.
    assert.fail(error.problems
      .map(({ file, errors }) => [file, ...errors.map((problem) => `  - ${problem}`)].join('\n'))
      .join('\n\n'));
  }
});

test('the line knows its own address', async () => {
  const site = await loadSite(root);
  for (const key of ['name', 'slug', 'repo', 'branch', 'url', 'opened', 'office', 'rest']) {
    assert.ok(site[key], `site.json carries "${key}"`);
  }
  assert.ok(site.url.endsWith('/'), 'the site url ends with a slash so relative paths resolve');
  assert.match(site.repo, /^[\w.-]+\/[\w.-]+$/);
});

test('nothing is installed to read this repository', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
});
