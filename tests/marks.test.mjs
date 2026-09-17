// The guard that makes "the archive accretes, it is not rewritten" a rule the
// repository can enforce, rather than a request in a document.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkMarks } from '../src/marks.mjs';

const ENTRY = `---
title: The tide table
maker: fixture-heron
line: One sentence about the work.
made: 2026-09
left: 2026-09-18
kind: instrument
status: unfinished
where: https://nowhere.fixture/tide-table/
---

A note.
`;

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

async function shore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'wrack-marks-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'config', 'user.email', 'fixture@fixture.fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await mkdir(path.join(dir, 'works'));
  await writeFile(path.join(dir, 'works', 'a-work.md'), ENTRY);
  await writeFile(path.join(dir, 'works', 'README.md'), '# the format\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'Leave a work');
  git(dir, 'checkout', '-b', 'change');
  return dir;
}

async function change(edit) {
  const dir = await shore();
  await edit(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'A change');
  try {
    return checkMarks({ cwd: dir, base: 'main' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const file = (dir, name = 'a-work.md') => path.join(dir, 'works', name);

test('leaving a new work leaves every other mark alone', async () => {
  assert.deepEqual(await change(async (dir) => {
    await writeFile(file(dir, 'another-work.md'), ENTRY);
  }), []);
});

test('changing an entry without an amended date is refused', async () => {
  const problems = await change(async (dir) => {
    await writeFile(file(dir), ENTRY.replace('A note.', 'A different note.'));
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /without an "amended" date/);
});

test('an amendment that shows its date is allowed', async () => {
  assert.deepEqual(await change(async (dir) => {
    await writeFile(file(dir), ENTRY
      .replace('status: unfinished', 'status: unfinished\namended: 2026-09-20')
      .replace('A note.', 'A note, with a correction.'));
  }), []);
});

test('an amended date cannot move backwards', async () => {
  const dir = await shore();
  await writeFile(file(dir), ENTRY.replace('status: unfinished', 'status: unfinished\namended: 2026-09-25'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'Amend');
  git(dir, 'checkout', 'main');
  git(dir, 'merge', '--ff-only', 'change');
  git(dir, 'checkout', '-b', 'again');
  await writeFile(file(dir), ENTRY.replace('status: unfinished', 'status: unfinished\namended: 2026-09-19'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'Amend backwards');
  try {
    const problems = checkMarks({ cwd: dir, base: 'main' });
    assert.match(problems[0], /moves "amended" backwards/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an entry is never deleted', async () => {
  const problems = await change(async (dir) => {
    await unlink(file(dir));
  });
  assert.match(problems[0], /never deleted/);
});

test('an id is permanent once it is merged', async () => {
  const problems = await change(async (dir) => {
    await rename(file(dir), file(dir, 'a-renamed-work.md'));
  });
  assert.ok(problems.some((problem) => /permanent/.test(problem)), JSON.stringify(problems));
});

test('a plate keeps the name it was left under, and the day it arrived', async () => {
  const reattributed = await change(async (dir) => {
    await writeFile(file(dir), ENTRY
      .replace('maker: fixture-heron', 'maker: someone-else')
      .replace('status: unfinished', 'status: unfinished\namended: 2026-09-20'));
  });
  assert.match(reattributed[0], /keeps the name it was left under/);

  const backdated = await change(async (dir) => {
    await writeFile(file(dir), ENTRY
      .replace('left: 2026-09-18', 'left: 2026-09-30')
      .replace('status: unfinished', 'status: unfinished\namended: 2026-09-30'));
  });
  assert.match(backdated[0], /does not move/);
});

test('a withdrawal needs no amendment: the tombstone is the record', async () => {
  assert.deepEqual(await change(async (dir) => {
    await writeFile(file(dir), `---
title: The tide table
maker: fixture-heron
left: 2026-09-18
status: withdrawn
withdrawn: 2026-09-21
withdrawn-because: maker-request
---

Withdrawn at the maker's request.
`);
  }), []);
});

test('the format guide is not an entry and may be edited', async () => {
  assert.deepEqual(await change(async (dir) => {
    await writeFile(file(dir, 'README.md'), '# the format, explained better\n');
  }), []);
});

test('a base the clone does not have stops the check instead of passing it', async () => {
  const dir = await shore();
  try {
    assert.throws(() => checkMarks({ cwd: dir, base: 'origin/nowhere' }), /cannot compare against/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
