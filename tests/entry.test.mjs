import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  KINDS, LIMITS, STATUSES,
  countWords, extractMark, isDay, isMade, normalizeEntry, parseEntry, splitNote, urlProblem, validateEntry,
} from '../src/entry.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPENED = '2026-09-17';

const GOOD = `---
title: The tide table
maker: fixture-heron
line: A tide table for a sea that only exists while someone is reading it.
made: 2026-09
left: 2026-09-18
kind: instrument
status: unfinished
where: https://nowhere.fixture/tide-table/
---

A first paragraph.

A second one.
`;

function entryWith(changes = {}, note = 'A note that is long enough to mean something.') {
  const header = {
    title: 'The tide table',
    maker: 'fixture-heron',
    line: 'One sentence about the work.',
    made: '2026-09',
    left: '2026-09-18',
    kind: 'instrument',
    status: 'unfinished',
    where: 'https://nowhere.fixture/tide-table/',
    ...changes,
  };
  const lines = Object.entries(header)
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => (Array.isArray(value)
      ? [`${key}:`, ...value.map((item) => `  - ${item}`)]
      : [`${key}: ${value}`]));
  return parseEntry(`---\n${lines.join('\n')}\n---\n\n${note}\n`, 'a-work.md');
}

function problems(changes, note) {
  return validateEntry(entryWith(changes, note), { opened: OPENED });
}

function refuses(changes, note, fragment) {
  const found = problems(changes, note);
  assert.ok(
    found.some((problem) => problem.includes(fragment)),
    `expected a refusal mentioning "${fragment}", got: ${JSON.stringify(found)}`,
  );
}

test('a well-formed entry parses into its header and its note', () => {
  const entry = parseEntry(GOOD, 'works/the-tide-table.md');
  assert.equal(entry.id, 'the-tide-table');
  assert.deepEqual(entry.errors, []);
  assert.equal(entry.header.title, 'The tide table');
  assert.equal(entry.header.kind, 'instrument');
  assert.equal(entry.note, 'A first paragraph.\n\nA second one.');
  assert.deepEqual(validateEntry(entry, { opened: OPENED }), []);
});

test('a Windows file with a byte-order mark parses the same as a plain one', () => {
  const windows = `﻿${GOOD.replaceAll('\n', '\r\n')}`;
  assert.deepEqual(parseEntry(windows, 'a.md'), parseEntry(GOOD, 'a.md'));
});

test('values keep their colons, lose their quotes, and ignore comments', () => {
  const entry = parseEntry(`---
# a comment, and the next line is blank

title: "Notes: on tides"
maker: 'fixture-heron'
line: One sentence.
made: 2026
left: 2026-09-18
kind: writing
status: resting
where: here
links:
  - https://one.fixture/a
  - https://two.fixture/b
---
A note.
`, 'a.md');
  assert.deepEqual(entry.errors, []);
  assert.equal(entry.header.title, 'Notes: on tides');
  assert.equal(entry.header.maker, 'fixture-heron');
  assert.deepEqual(entry.header.links, ['https://one.fixture/a', 'https://two.fixture/b']);
});

test('a single link written on the key line is still a list', () => {
  const entry = entryWith({ links: undefined });
  const one = parseEntry(`---\ntitle: a\nmaker: b\nline: c\nmade: 2026\nleft: 2026-09-18\nkind: other\nstatus: resting\nwhere: here\nlinks: https://one.fixture/a\n---\nnote\n`, 'a.md');
  assert.deepEqual(one.header.links, ['https://one.fixture/a']);
  assert.deepEqual(entry.header.links, undefined);
});

test('the shape of the file is refused when it is not a file of this shape', () => {
  assert.match(parseEntry('title: a\n', 'a.md').errors[0], /must begin with a line containing only ---/);
  assert.match(parseEntry('---\ntitle: a\n', 'a.md').errors[0], /header is never closed/);
  assert.match(parseEntry('---\nauthor: me\n---\nnote\n', 'a.md').errors[0], /did you mean "maker"/);
  assert.match(parseEntry('---\ncarried_by: me\n---\nnote\n', 'a.md').errors[0], /did you mean "carried-by"/);
  assert.match(parseEntry('---\ntitle: a\ntitle: b\n---\nnote\n', 'a.md').errors[0], /appears more than once/);
  assert.match(parseEntry('---\n- https://a.fixture/\n---\nnote\n', 'a.md').errors[0], /must follow a list key/);
  assert.match(parseEntry('---\ntitle:\n---\nnote\n', 'a.md').errors[0], /has no value/);
  assert.match(parseEntry('---\nnot a pair\n---\nnote\n', 'a.md').errors[0], /expected "key: value"/);
});

test('every required key is required', () => {
  for (const key of ['title', 'maker', 'line', 'made', 'left', 'kind', 'status', 'where']) {
    refuses({ [key]: undefined }, undefined, `"${key}" is required`);
  }
});

test('the id comes from the file name and must be a plain handle', () => {
  const entry = parseEntry(GOOD, 'works/Not An Id.md');
  assert.ok(validateEntry(entry, { opened: OPENED }).some((problem) => problem.includes('lowercase letters')));
  assert.ok(validateEntry(parseEntry(GOOD, 'works/readme.md'), { opened: OPENED }).some((problem) => problem.includes('reserved')));
});

test('dates are calendar dates, in order, and not before the line opened', () => {
  assert.ok(isDay('2026-09-18'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('2026-09'));
  assert.ok(isMade('2026') && isMade('2026-09') && isMade('2026-09-18'));
  assert.ok(!isMade('2026-13'));
  refuses({ left: '2026-09-31' }, undefined, '"left" must be a calendar date');
  refuses({ left: '2026-09-16' }, undefined, 'the line opened on 2026-09-17');
  refuses({ made: '2026-10', left: '2026-09-18' }, undefined, 'comes after "left"');
  refuses({ amended: '2026-09-17', left: '2026-09-18' }, undefined, '"amended" (2026-09-17) comes before "left"');
});

test('kind and status come from the two lists, in any case', () => {
  refuses({ kind: 'sculpture' }, undefined, `"kind" must be one of: ${KINDS.join(', ')}`);
  refuses({ status: 'perfect' }, undefined, `"status" must be one of: ${STATUSES.join(', ')}`);
  assert.deepEqual(problems({ kind: 'Instrument', status: 'Unfinished' }), []);
});

test('a link must be a public http or https address', () => {
  assert.equal(urlProblem('https://nowhere.fixture/a'), null);
  assert.equal(urlProblem('http://nowhere.fixture/a'), null);
  for (const [link, fragment] of [
    ['javascript:alert(1)', 'only http and https'],
    ['data:text/html,<script>', 'only http and https'],
    ['file:///etc/passwd', 'only http and https'],
    ['https://user:secret@nowhere.fixture/', 'carries credentials'],
    ['https://localhost:8080/', 'not a public address'],
    ['https://127.0.0.1/', 'not a public address'],
    ['https://10.1.2.3/', 'not a public address'],
    ['https://192.168.0.5/', 'not a public address'],
    ['https://100.100.1.1/', 'not a public address'],
    ['https://169.254.1.1/', 'not a public address'],
    ['https://[::1]/', 'not a public address'],
    ['https://box.ts.net/', 'not a public address'],
    ['https://example.com/', 'not a public address'],
    ['https://a.example/', 'not a public address'],
    ['https://thing.local/', 'not a public address'],
    ['not-a-url', 'not a complete link'],
    ['https://nowhere.fixture/a b', 'contains whitespace'],
  ]) {
    assert.ok(urlProblem(link)?.includes(fragment), `${link} should be refused for "${fragment}", got ${urlProblem(link)}`);
    refuses({ where: link }, undefined, '"where"');
  }
  assert.deepEqual(problems({ where: 'here' }), []);
  assert.deepEqual(problems({ where: 'HERE' }), []);
});

test('links are few, public, and not repeated', () => {
  refuses({ links: Array.from({ length: 9 }, (_, index) => `https://nowhere.fixture/${index}`) }, undefined, 'the limit is 8');
  refuses({ links: ['https://nowhere.fixture/a', 'https://nowhere.fixture/a'] }, undefined, 'repeats an earlier link');
  refuses({ links: ['https://localhost/a'] }, undefined, 'item 1 points at');
});

test('an answer names another entry that is actually on the line', () => {
  const context = { opened: OPENED, knownIds: new Set(['a-work', 'another-work']) };
  assert.deepEqual(validateEntry(entryWith({ answers: 'another-work' }), context), []);
  assert.ok(validateEntry(entryWith({ answers: 'a-work' }), context).some((problem) => problem.includes('names this entry itself')));
  assert.ok(validateEntry(entryWith({ answers: 'a-ghost' }), context).some((problem) => problem.includes('is not on the line')));
});

test('a note is required, bounded, and its fences are closed', () => {
  refuses({}, '   ', 'the note is empty');
  refuses({}, 'x'.repeat(LIMITS.note + 1), `the limit is ${LIMITS.note}`);
  refuses({}, 'a note\n\n```\nunclosed\n', 'never closes it');
});

test('one mark, small enough to sit on a plate', () => {
  const mark = (body) => `A note.\n\n\`\`\`mark\n${body}\n\`\`\`\n`;
  assert.deepEqual(problems({}, mark(' /\\\n/__\\')), []);
  assert.equal(extractMark(mark(' /\\\n/__\\')), ' /\\\n/__\\');
  refuses({}, mark('x'.repeat(LIMITS.markColumns + 1)), 'columns wide');
  refuses({}, mark(Array.from({ length: LIMITS.markLines + 1 }, () => 'x').join('\n')), 'lines tall');
  refuses({}, `${mark(' /\\')}\n${mark('/__\\')}`, 'more than one "mark" block');
});

test('text that hides what it says, or carries what may not be seen, is refused', () => {
  refuses({ title: 'abell' }, undefined, 'control character');
  refuses({ title: 'a‮txet' }, undefined, 'bidirectional control character');
  refuses({}, `a note with ⁦hidden⁩ order`, 'bidirectional control character');
  refuses({}, `a note mentioning ${'gh' + 'p_'}${'a1'.repeat(20)}`, 'a GitHub token');
  refuses({}, 'a note with -----BEGIN OPENSSH PRIVATE KEY----- in it', 'a private key');
  refuses({}, `write to me at heron${'@'}nowhere.fixture please`, 'email address');
  refuses({ maker: 'x'.repeat(LIMITS.maker + 1) }, undefined, `the limit is ${LIMITS.maker}`);
});

test('an unedited template is refused, key by key', async () => {
  const template = parseEntry(await readFile(path.join(root, 'templates', 'work.md'), 'utf8'), 'work.md');
  const found = validateEntry(template, { opened: OPENED, template });
  assert.ok(found.some((problem) => problem.includes('"title" still holds the template')), JSON.stringify(found));
  assert.ok(found.some((problem) => problem.includes("the note is still the template")), JSON.stringify(found));
  // Filled in, the same template is a valid entry: the form itself is not broken.
  const filled = parseEntry(`---
title: A real title
maker: a real name
line: A real sentence about a real thing.
made: 2026-09
left: 2026-09-18
kind: other
status: resting
where: here
---

A real note, written by whoever left it.
`, 'a-real-work.md');
  assert.deepEqual(validateEntry(filled, { opened: OPENED, template }), []);
});

test('a withdrawn entry keeps its place and nothing else', () => {
  const tombstone = (changes = {}) => parseEntry(`---
title: A plate that was withdrawn
maker: fixture-gull
left: 2026-09-17
status: withdrawn
withdrawn: 2026-09-20
withdrawn-because: maker-request
${Object.entries(changes).map(([key, value]) => `${key}: ${value}`).join('\n')}
---

Withdrawn at the maker's request.
`, 'a-work.md');
  assert.deepEqual(validateEntry(tombstone(), { opened: OPENED }), []);
  assert.ok(validateEntry(tombstone({ line: 'still here' }), { opened: OPENED })
    .some((problem) => problem.includes('"line" must be removed when an entry is withdrawn')));
  assert.ok(validateEntry(tombstone({ where: 'https://nowhere.fixture/' }), { opened: OPENED })
    .some((problem) => problem.includes('"where" must be removed')));
  const missing = parseEntry(`---\ntitle: a\nmaker: b\nleft: 2026-09-18\nstatus: withdrawn\n---\n\nGone.\n`, 'a-work.md');
  const found = validateEntry(missing, { opened: OPENED });
  assert.ok(found.some((problem) => problem.includes('"withdrawn" is required')));
  assert.ok(found.some((problem) => problem.includes('"withdrawn-because" is required')));
  const wordy = parseEntry(`---\ntitle: a\nmaker: b\nleft: 2026-09-18\nstatus: withdrawn\nwithdrawn: 2026-09-20\nwithdrawn-because: safety\n---\n\n${'x'.repeat(LIMITS.tombstoneNote + 1)}\n`, 'a-work.md');
  assert.ok(validateEntry(wordy, { opened: OPENED }).some((problem) => problem.includes('at most 280 characters')));
});

test('a key that only belongs on a tombstone is refused elsewhere', () => {
  refuses({ withdrawn: '2026-09-20' }, undefined, 'only used when an entry is withdrawn');
});

test('notes split into prose and fences, and words are counted without the mark', () => {
  const note = 'one two three\n\n```\nfour five\n```\n\n```mark\nsix\n```';
  const { blocks, errors } = splitNote(note);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocks.map((block) => block.type), ['prose', 'fence', 'fence']);
  assert.equal(countWords(note), 5);
});

test('a valid entry normalizes into the shape the line renders', () => {
  const work = normalizeEntry(entryWith({ kind: 'Instrument', status: 'Unfinished', where: 'HERE' }));
  assert.equal(work.kind, 'instrument');
  assert.equal(work.status, 'unfinished');
  assert.equal(work.where, 'here');
  assert.equal(work.source, 'works/a-work.md');
});
