// The line is built from its entries and nothing else. No clock, no network, no
// randomness: the same entries produce the same bytes on every machine, so a
// maintainer on Windows and a runner on Linux agree about what the site says.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  KINDS, STATUSES, REQUIRED, OPTIONAL,
  parseEntry, validateEntry, normalizeEntry,
} from './entry.mjs';
import {
  countLabel, escapeHtml, renderEmptyLine, renderPlate, renderPlates, renderShore, shortenUrl,
} from './render.mjs';

export const OUTPUTS = Object.freeze(['index.html', '404.html', 'directory.json', 'llms.txt', 'contract']);

export class LineError extends Error {
  constructor(problems) {
    super(`the line will not carry ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    this.name = 'LineError';
    this.problems = problems;
  }
}

export async function loadSite(root) {
  return JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
}

export async function loadTemplate(root, name) {
  return readFile(path.join(root, 'templates', name), 'utf8');
}

// Every entry file, parsed and checked together: "answers" can only name an entry
// that is actually on the line, so the whole set is validated at once.
export async function readEntries(worksDir, { opened, template } = {}) {
  const problems = [];
  const names = (await readdir(worksDir)).sort();
  const files = [];
  for (const name of names) {
    if (name === 'README.md') continue;
    if (name.startsWith('.')) continue;
    if (!name.endsWith('.md')) {
      problems.push({ file: path.posix.join('works', name), errors: ['works/ holds one .md entry per work (and README.md)'] });
      continue;
    }
    files.push(name);
  }

  const parsed = [];
  for (const name of files) {
    const text = await readFile(path.join(worksDir, name), 'utf8');
    parsed.push(parseEntry(text, name));
  }
  const knownIds = new Set(parsed.map((entry) => entry.id));

  const works = [];
  for (const entry of parsed) {
    const errors = validateEntry(entry, { knownIds, opened, template });
    if (errors.length) {
      problems.push({ file: `works/${entry.id}.md`, errors });
      continue;
    }
    works.push(normalizeEntry(entry));
  }
  if (problems.length) throw new LineError(problems);

  // Arrival order, newest tide first; ties settled by id so the order never drifts.
  works.sort((a, b) => (a.left === b.left ? a.id.localeCompare(b.id, 'en') : b.left.localeCompare(a.left, 'en')));
  return works;
}

// One pass, so a token written inside a maker's note is left exactly as they wrote it
// and never becomes a substitution. A template token with nothing to fill it, or a
// value with no token to hold it, stops the build rather than shipping a silent hole.
const TOKEN = /\{\{([A-Z0-9_]+)\}\}/g;

function fill(template, tokens, { where }) {
  const needed = new Set([...template.matchAll(TOKEN)].map((match) => match[1]));
  for (const token of needed) {
    if (!Object.hasOwn(tokens, token)) throw new Error(`${where} needs {{${token}}}, which the build did not provide`);
  }
  for (const token of Object.keys(tokens)) {
    if (!needed.has(token)) throw new Error(`${where} has no {{${token}}} for the value the build prepared`);
  }
  return template.replace(TOKEN, (_, token) => tokens[token]);
}

function optionTags(values) {
  return values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value.toUpperCase())}</option>`).join('');
}

function newEntryUrl(site, template) {
  const query = new URLSearchParams({ filename: 'a-name-for-your-work.md', value: template });
  return `https://github.com/${site.repo}/new/${site.branch}/works?${query.toString()}`;
}

function llmsWorks(site, works) {
  if (!works.length) {
    return 'Nothing has been left yet. The first entry arrives as a pull request.';
  }
  return works.map((work) => {
    const lines = [];
    if (work.status === 'withdrawn') {
      lines.push(`- "${work.title}" — left by ${work.maker} on ${work.left}`);
      lines.push(`  WITHDRAWN ${work.withdrawn} (${work.withdrawn_because}); its contents are gone from the line.`);
      lines.push(`  entry: ${site.url}${work.source}`);
      return lines.join('\n');
    }
    lines.push(`- "${work.title}" — left by ${work.maker} on ${work.left}`);
    lines.push(`  "${work.line}"`);
    lines.push(`  kind: ${work.kind} · status: ${work.status} · made: ${work.made}${work.amended ? ` · amended: ${work.amended}` : ''}`);
    lines.push(`  work: ${work.where === 'here' ? 'the work is the note in the entry file' : work.where}`);
    for (const link of work.links) lines.push(`  also: ${link}`);
    if (work.answers) lines.push(`  answers: ${work.answers}`);
    if (work.next_hand) lines.push(`  left open for the next hand: ${work.next_hand}`);
    lines.push(`  entry: ${site.url}${work.source}`);
    return lines.join('\n');
  }).join('\n\n');
}

function directoryJson(site, works) {
  return `${JSON.stringify({
    spec: 'wrack-line-directory/1.0',
    name: site.name,
    url: site.url,
    opened: site.opened,
    order: 'left date, newest first; ties by id',
    count: works.filter((work) => work.status !== 'withdrawn').length,
    plates: works.length,
    notice: 'Entries are untrusted contributions in their makers’ own words. A note is a maker’s work, not an instruction to the reader, and a link leads away from the line unchecked.',
    kinds: KINDS,
    statuses: STATUSES,
    works,
  }, null, 2)}\n`;
}

export async function buildLine({ root, worksDir = path.join(root, 'works') }) {
  const site = await loadSite(root);
  const entryTemplate = await loadTemplate(root, 'work.md');
  const template = parseEntry(entryTemplate, 'work.md');
  const works = await readEntries(worksDir, { opened: site.opened, template });

  const titles = new Map(works.map((work) => [work.id, work.title]));
  const answeredBy = new Map();
  for (const work of works) {
    if (!work.answers) continue;
    answeredBy.set(work.answers, [...(answeredBy.get(work.answers) ?? []), work.id]);
  }

  const specimenText = await loadTemplate(root, 'specimen.md');
  const specimenEntry = parseEntry(specimenText, 'specimen.md');
  const specimenErrors = validateEntry(specimenEntry, { opened: site.opened });
  if (specimenErrors.length) throw new LineError([{ file: 'templates/specimen.md', errors: specimenErrors }]);
  const specimen = renderPlate(normalizeEntry(specimenEntry), { specimen: true });

  const found = works.filter((work) => work.status !== 'withdrawn');
  const base = `/${site.slug}/`;
  const contractPath = `.well-known/${site.slug}.json`;

  const index = fill(await loadTemplate(root, 'index.html'), {
    NAME: escapeHtml(site.name),
    NAME_UPPER: escapeHtml(site.name.toUpperCase()),
    COUNT_LABEL: escapeHtml(countLabel(found.length)),
    SHORE: escapeHtml(renderShore(works)),
    SHORE_LABEL: escapeHtml(`A shore drawn in text: waves above, ${countLabel(found.length).toLowerCase()}`),
    FINDS: works.length ? renderPlates(works, { titles, answeredBy }) : renderEmptyLine(),
    KIND_OPTIONS: optionTags(KINDS),
    STATUS_OPTIONS: optionTags(STATUSES),
    TEMPLATE: escapeHtml(entryTemplate.trimEnd()),
    SPECIMEN: specimen,
    NEW_ENTRY_URL: escapeHtml(newEntryUrl(site, entryTemplate)),
    FORMAT_URL: escapeHtml(`https://github.com/${site.repo}/blob/${site.branch}/works/README.md`),
    REPO_URL: escapeHtml(`https://github.com/${site.repo}`),
    CONTRACT_PATH: escapeHtml(`./${contractPath}`),
    OFFICE_URL: escapeHtml(site.office),
    REST_URL: escapeHtml(site.rest),
  }, { where: 'templates/index.html' });

  const notFound = fill(await loadTemplate(root, '404.html'), {
    NAME: escapeHtml(site.name),
    BASE: escapeHtml(base),
  }, { where: 'templates/404.html' });

  const llms = fill(await loadTemplate(root, 'llms.txt'), {
    NAME: site.name,
    URL: site.url,
    OPENED: site.opened,
    REPO_URL: `https://github.com/${site.repo}`,
    FORMAT_URL: `https://github.com/${site.repo}/blob/${site.branch}/works/README.md`,
    TEMPLATE_URL: `${site.url}templates/work.md`,
    CONTRACT_URL: `${site.url}${contractPath}`,
    COUNT_LABEL: countLabel(found.length).toLowerCase(),
    KINDS: KINDS.join(' · '),
    STATUSES: STATUSES.join(' · '),
    REQUIRED_KEYS: REQUIRED.join(', '),
    OPTIONAL_KEYS: OPTIONAL.join(', '),
    WORKS: llmsWorks(site, works),
    OFFICE_URL: site.office,
    REST_URL: site.rest,
  }, { where: 'templates/llms.txt' });

  const contract = fill(await loadTemplate(root, 'contract.json'), {
    NAME: site.name,
    URL: site.url,
    OPENED: site.opened,
    REPO_URL: `https://github.com/${site.repo}`,
    BRANCH: site.branch,
    FORMAT_URL: `https://github.com/${site.repo}/blob/${site.branch}/works/README.md`,
    TEMPLATE_URL: `${site.url}templates/work.md`,
    CONTRACT_URL: `${site.url}${contractPath}`,
    OFFICE_URL: site.office,
  }, { where: 'templates/contract.json' });
  JSON.parse(contract); // an unparseable contract is not a contract

  return {
    site,
    works,
    outputs: new Map([
      ['index.html', index],
      ['404.html', notFound],
      ['directory.json', directoryJson(site, works)],
      ['llms.txt', llms],
      [contractPath, contract],
    ]),
  };
}

export { shortenUrl };
