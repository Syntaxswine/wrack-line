import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEntry, parseEntry } from '../src/entry.mjs';
import {
  countLabel, escapeHtml, renderEmptyLine, renderNote, renderPlate, renderShore, shortenUrl,
} from '../src/render.mjs';

function work(header, note) {
  const lines = Object.entries(header).flatMap(([key, value]) => (Array.isArray(value)
    ? [`${key}:`, ...value.map((item) => `  - ${item}`)]
    : [`${key}: ${value}`]));
  return normalizeEntry(parseEntry(`---\n${lines.join('\n')}\n---\n\n${note}\n`, 'a-work.md'));
}

const plain = {
  title: 'The tide table',
  maker: 'fixture-heron',
  line: 'One sentence about the work.',
  made: '2026-09',
  left: '2026-09-18',
  kind: 'instrument',
  status: 'unfinished',
  where: 'https://nowhere.fixture/tide-table/',
};

test('a maker can write anything; none of it becomes markup', () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const html = renderPlate(work({
    ...plain,
    title: hostile,
    maker: `</strong>${hostile}`,
    line: `"${hostile}"`,
  }, `${hostile}\n\n</details><script>alert(2)</script>`));
  assert.ok(!html.includes('<img'), 'no raw img survived');
  assert.ok(!html.includes('<script'), 'no raw script survived');
  assert.ok(!html.includes('</details><script'), 'the note cannot close the plate');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('a note keeps its paragraphs, its spacing, and its fences', () => {
  const html = renderNote('one\n  two indented\n\nsecond paragraph\n\n```\n    exact    columns\n```');
  assert.equal(html.split('<p>').length - 1, 2, 'two paragraphs');
  assert.ok(html.includes('one\n  two indented'), 'newlines and indentation survive inside a paragraph');
  assert.ok(html.includes('<pre class="note-block">    exact    columns</pre>'));
});

test('the mark is drawn on the plate, not repeated in the note', () => {
  const html = renderPlate(work(plain, 'A note.\n\n```mark\n /\\\n/__\\\n```'));
  assert.ok(html.includes('<pre class="find-mark"'));
  assert.equal(html.match(/\/__\\/g).length, 1);
  assert.ok(!html.includes('<pre class="note-block">'));
});

test('a link out carries no referrer, no endorsement, and no ranking signal', () => {
  const html = renderPlate(work(plain));
  assert.ok(html.includes('href="https://nowhere.fixture/tide-table/"'));
  assert.ok(html.includes('rel="noopener noreferrer nofollow ugc"'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
  assert.equal(shortenUrl('https://nowhere.fixture/tide-table/'), 'nowhere.fixture/tide-table');
});

test('a work that is its own note opens with the note showing', () => {
  const html = renderPlate(work({ ...plain, where: 'here' }, 'The work is these words.'));
  assert.ok(html.includes('<details class="find-note" open>'));
  assert.ok(html.includes('THE WORK IS THE NOTE'));
  assert.ok(!html.includes('GO TO THE WORK'));
});

test('answers point both ways without either plate being edited', () => {
  const answering = work({ ...plain, answers: 'the-tide-table' }, 'A reading, not a repair.');
  const context = {
    titles: new Map([['the-tide-table', 'The tide table'], ['a-work', 'A reading']]),
    answeredBy: new Map([['a-work', ['another-work']]]),
  };
  const html = renderPlate(answering, context);
  assert.ok(html.includes('ANSWERS <a href="#the-tide-table">The tide table</a>'));
  assert.ok(html.includes('ANSWERED BY <a href="#another-work">'));
});

test('a withdrawn plate keeps its place and shows none of its contents', () => {
  const html = renderPlate(work({
    title: 'A plate that was withdrawn',
    maker: 'fixture-gull',
    left: '2026-09-17',
    status: 'withdrawn',
    withdrawn: '2026-09-20',
    'withdrawn-because': 'maker-request',
  }, 'Withdrawn at the maker’s request.'));
  assert.ok(html.includes('WITHDRAWN'));
  assert.ok(html.includes('A plate that was withdrawn'));
  assert.ok(html.includes('The plate keeps its place on the line'));
  assert.ok(!html.includes('find-links'), 'a tombstone offers no links');
  assert.ok(!html.includes('find-line'), 'a tombstone carries no sentence');
});

test('the shore is a rectangle, so centring it does not bend the drawing', () => {
  const widths = new Set(renderShore([]).split('\n').map((line) => [...line].length));
  assert.equal(widths.size, 1);
  assert.ok(renderShore([]).includes('NOTHING LEFT YET'));
  assert.equal(countLabel(0), 'NOTHING LEFT YET');
  assert.equal(countLabel(1), '1 WORK ON THE LINE');
  assert.equal(countLabel(7), '7 WORKS ON THE LINE');
  const drawn = renderShore([work(plain), work({ ...plain, title: 'Another' })]);
  assert.ok(drawn.includes('2 WORKS ON THE LINE'));
  assert.ok(/[@%o*&#8Y]/.test(drawn), 'a glyph on the sand for each work');
});

test('an empty line says so in words, and is a complete state', () => {
  const html = renderEmptyLine();
  assert.ok(html.includes('Nothing has been left yet.'));
  assert.ok(html.includes('complete state'));
});
