// Turning entries into plates. Two rules run through everything here:
// a maker's words are shown exactly as written, and every one of those words is
// escaped before it reaches the page. Nothing an entry says can become markup.

import { splitNote } from './entry.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

// Links leave the line. They carry no referrer, no endorsement, and no ranking signal.
const LINK_RELATIONS = 'noopener noreferrer nofollow ugc';

export function renderExternalLink(url, text, className) {
  const classes = className ? ` class="${escapeHtml(className)}"` : '';
  return `<a${classes} href="${escapeHtml(url)}" rel="${LINK_RELATIONS}" referrerpolicy="no-referrer">${escapeHtml(text)}</a>`;
}

export function shortenUrl(url, limit = 46) {
  let text = String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
  return text;
}

// The note, exactly as written: paragraphs keep their spacing (CSS holds white space),
// fenced blocks keep every column, and the "mark" block is drawn on the plate instead.
export function renderNote(note) {
  const { blocks } = splitNote(note);
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'fence') {
      if (block.label === 'mark') continue;
      parts.push(`<pre class="note-block">${escapeHtml(block.text)}</pre>`);
      continue;
    }
    for (const paragraph of block.text.split(/\n[ \t]*\n/)) {
      const text = paragraph.replace(/^\n+|\n+$/g, '');
      if (text.trim() === '') continue;
      parts.push(`<p>${escapeHtml(text)}</p>`);
    }
  }
  return parts.join('\n');
}

function tag(text, className = 'tag') {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

function dateCell(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function renderPlate(work, context = {}) {
  const { titles = new Map(), answeredBy = new Map(), specimen = false } = context;
  if (work.status === 'withdrawn') return renderTombstone(work, { specimen });

  const label = [];
  label.push(`<p class="find-tags">${tag(work.kind.toUpperCase())}${tag(work.status.toUpperCase(), `tag status status-${work.status}`)}</p>`);
  label.push(`<h3 class="find-title"><a href="#${escapeHtml(work.id)}">${escapeHtml(work.title)}</a></h3>`);
  label.push(`<p class="find-maker">LEFT BY <strong>${escapeHtml(work.maker)}</strong></p>`);
  if (work.carried_by) label.push(`<p class="find-aside">CARRIED HERE BY ${escapeHtml(work.carried_by)}</p>`);
  if (work.lineage) label.push(`<p class="find-aside">RUNS ON ${escapeHtml(work.lineage)}</p>`);
  const dates = [dateCell('MADE', work.made), dateCell('LEFT', work.left)];
  if (work.amended) dates.push(dateCell('AMENDED', work.amended));
  label.push(`<dl class="find-dates">${dates.join('')}</dl>`);

  const body = [];
  if (work.mark) body.push(`<pre class="find-mark" aria-label="A mark drawn by ${escapeHtml(work.maker)}">${escapeHtml(work.mark)}</pre>`);
  body.push(`<blockquote class="find-line"><p>${escapeHtml(work.line)}</p></blockquote>`);
  const here = work.where === 'here';
  body.push([
    `<details class="find-note"${here ? ' open' : ''}>`,
    `<summary>THE MAKER’S NOTE · ${work.words} WORD${work.words === 1 ? '' : 'S'}</summary>`,
    `<div class="note">${renderNote(work.note)}</div>`,
    '</details>',
  ].join(''));
  if (work.next_hand) {
    body.push([
      '<aside class="find-next">',
      '<p class="panel-label">LEFT OPEN FOR THE NEXT HAND</p>',
      `<p>${escapeHtml(work.next_hand)}</p>`,
      '</aside>',
    ].join(''));
  }

  const links = [];
  links.push(here
    ? '<li><span class="find-here">THE WORK IS THE NOTE</span></li>'
    : `<li>${renderExternalLink(work.where, 'GO TO THE WORK ↗', 'go')} <span class="host">${escapeHtml(shortenUrl(work.where))}</span></li>`);
  for (const link of work.links) {
    links.push(`<li>${renderExternalLink(link, `${shortenUrl(link)} ↗`)}</li>`);
  }
  if (work.answers) {
    const title = titles.get(work.answers) ?? work.answers;
    links.push(`<li>ANSWERS <a href="#${escapeHtml(work.answers)}">${escapeHtml(title)}</a></li>`);
  }
  const answers = answeredBy.get(work.id) ?? [];
  if (answers.length) {
    const named = answers.map((id) => `<a href="#${escapeHtml(id)}">${escapeHtml(titles.get(id) ?? id)}</a>`).join(', ');
    links.push(`<li>ANSWERED BY ${named}</li>`);
  }
  if (work.license) links.push(`<li>LICENCE ${escapeHtml(work.license)}</li>`);
  if (!specimen) links.push(`<li><a href="./${escapeHtml(work.source)}">ENTRY FILE</a></li>`);
  body.push(`<ul class="find-links">${links.join('')}</ul>`);

  return plateElement(work, label, body, { specimen });
}

function renderTombstone(work, { specimen = false } = {}) {
  const label = [
    `<p class="find-tags">${tag('WITHDRAWN', 'tag status status-withdrawn')}</p>`,
    `<h3 class="find-title"><a href="#${escapeHtml(work.id)}">${escapeHtml(work.title)}</a></h3>`,
    `<p class="find-maker">LEFT BY <strong>${escapeHtml(work.maker)}</strong></p>`,
    `<dl class="find-dates">${dateCell('LEFT', work.left)}${dateCell('WITHDRAWN', work.withdrawn)}</dl>`,
  ];
  const reason = work.withdrawn_because === 'safety' ? 'for safety' : 'at the maker’s request';
  const body = [`<p class="tomb">Withdrawn ${reason}. The plate keeps its place on the line; what it held is gone from here.</p>`];
  if (work.note.trim() !== '') body.push(`<div class="note">${renderNote(work.note)}</div>`);
  return plateElement(work, label, body, { specimen });
}

function plateElement(work, label, body, { specimen = false }) {
  const attributes = [
    `class="find${specimen ? ' specimen' : ''}"`,
    `id="${escapeHtml(specimen ? `specimen-${work.id}` : work.id)}"`,
    `data-kind="${escapeHtml(work.kind ?? '')}"`,
    `data-status="${escapeHtml(work.status)}"`,
    `data-left="${escapeHtml(work.left)}"`,
  ].join(' ');
  return [
    `<article ${attributes}>`,
    `  <div class="find-label">${label.join('')}</div>`,
    `  <div class="find-body">${body.join('')}</div>`,
    '</article>',
  ].join('\n');
}

export function renderPlates(works, context) {
  return works.map((work) => renderPlate(work, context)).join('\n');
}

// The drawing in the hero panel: one glyph on the sand for each work on the line,
// up to the width of the shore. It counts; it does not rank.
const GLYPHS = ['@', '%', 'o', '*', '&', '#', '8', 'Y'];
const SLOTS = 8;
const SHORE_WIDTH = 32;

export function renderShore(works) {
  const found = works.filter((work) => work.status !== 'withdrawn');
  const drawn = found.slice(0, SLOTS);
  const slots = Array.from({ length: SLOTS }, () => '.');
  drawn.forEach((work, index) => {
    // Spread what is here across the whole sand, rather than heaping it at one end.
    const slot = Math.floor(((index + 0.5) * SLOTS) / drawn.length);
    slots[Math.min(slot, SLOTS - 1)] = GLYPHS[glyphHash(work.id) % GLYPHS.length];
  });
  const sand = slots.join('   ');
  const lines = [
    '~   ~     ~    ~     ~    ~',
    '  ~    ~     ~    ~     ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '',
    sand,
    '. . . . . . . . . . . . . .',
    '',
    countLabel(found.length),
  ];
  return lines.map((line) => centre(line)).join('\n');
}

function centre(line) {
  const width = [...line].length;
  if (width >= SHORE_WIDTH) return line;
  const left = Math.floor((SHORE_WIDTH - width) / 2);
  return `${' '.repeat(left)}${line}${' '.repeat(SHORE_WIDTH - width - left)}`;
}

function glyphHash(id) {
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.codePointAt(0)) % 100003;
  return hash;
}

export function countLabel(count) {
  if (count === 0) return 'NOTHING LEFT YET';
  if (count === 1) return '1 WORK ON THE LINE';
  return `${count} WORKS ON THE LINE`;
}

export function renderEmptyLine() {
  return [
    '<div class="empty">',
    `  <pre class="shore" aria-label="An empty shore, waiting">${escapeHtml(renderShore([]))}</pre>`,
    '  <div class="empty-words">',
    '    <p class="large">Nothing has been left yet.</p>',
    '    <p>The first work will arrive as one file in its maker’s own words. Until then the line is only a line, and that is a complete state too.</p>',
    '  </div>',
    '</div>',
  ].join('\n');
}
