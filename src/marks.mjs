// What a change is allowed to do to an entry that is already on the line.
// The rule the line is built on: the archive accretes, it is not rewritten. An
// answer is a new entry, an amendment shows its date, a withdrawal leaves the
// plate standing. Nothing is silently deleted, renamed, or reattributed.

import { execFileSync } from 'node:child_process';

import { parseEntry } from './entry.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function checkMarks({ cwd, base }) {
  let mergeBase;
  try {
    mergeBase = git(cwd, ['merge-base', base, 'HEAD']).trim();
  } catch {
    throw new Error(`cannot compare against "${base}": this clone has no such commit (fetch it, or pass --base with one it has)`);
  }

  const problems = [];
  const diff = git(cwd, ['diff', '--name-status', '-M', mergeBase, 'HEAD', '--', 'works/']).trim();
  if (!diff) return problems;

  for (const row of diff.split('\n')) {
    const columns = row.split('\t');
    const code = columns[0][0];
    const file = columns[1];
    if (file === 'works/README.md') continue;

    if (code === 'A' || code === 'C') continue;
    if (code === 'D') {
      problems.push(`${file} was deleted. An entry is never deleted: withdraw it instead, with status: withdrawn, a withdrawn date, and withdrawn-because.`);
      continue;
    }
    if (code === 'R') {
      problems.push(`${file} was renamed to ${columns[2]}. An id is permanent once it is merged, because other entries and other pages point at it.`);
      continue;
    }
    if (code !== 'M') {
      problems.push(`${file} changed in a way this check does not understand (${columns[0]}).`);
      continue;
    }

    const before = parseEntry(git(cwd, ['show', `${mergeBase}:${file}`]), file);
    const after = parseEntry(git(cwd, ['show', `HEAD:${file}`]), file);
    const withdrawing = Boolean(after.header.withdrawn) && !before.header.withdrawn;

    if (!withdrawing) {
      if (!after.header.amended) {
        problems.push(`${file} was changed without an "amended" date. An amendment stays visible: add amended: YYYY-MM-DD, or withdraw the entry.`);
      } else if (before.header.amended && after.header.amended < before.header.amended) {
        problems.push(`${file} moves "amended" backwards, from ${before.header.amended} to ${after.header.amended}.`);
      }
      if (before.header.maker && after.header.maker && before.header.maker !== after.header.maker) {
        problems.push(`${file} changes "maker" from "${before.header.maker}" to "${after.header.maker}". A plate keeps the name it was left under; a different maker leaves a new entry.`);
      }
    }
    if (before.header.left && after.header.left && before.header.left !== after.header.left) {
      problems.push(`${file} changes "left" from ${before.header.left} to ${after.header.left}. The date a work arrived does not move.`);
    }
  }

  return problems;
}
