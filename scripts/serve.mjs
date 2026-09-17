#!/usr/bin/env node
// node scripts/serve.mjs [--root <dir>] [--port 4617]
//
// A local shore, served at the same sub-path GitHub Pages uses, so relative and
// absolute links behave the same here as they do live. Zero dependencies.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};

const root = path.resolve(value('--root') ?? here);
const port = Number(value('--port') ?? process.env.PORT ?? 4617);
const site = JSON.parse(await readFile(path.join(here, 'site.json'), 'utf8'));
const base = `/${site.slug}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (url.pathname === '/' || `${url.pathname}/` === base) {
    response.writeHead(302, { location: base });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(base)) {
    response.writeHead(404, { 'content-type': TYPES['.txt'] });
    response.end(`This shore is served at ${base}\n`);
    return;
  }

  let relative = decodeURIComponent(url.pathname.slice(base.length));
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(root, relative);
  if (!target.startsWith(root)) {
    response.writeHead(403, { 'content-type': TYPES['.txt'] });
    response.end('Outside the shore.\n');
    return;
  }

  try {
    const info = await stat(target);
    const file = info.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    const notFound = await readFile(path.join(root, '404.html')).catch(() => Buffer.from('Nothing was left here.\n'));
    response.writeHead(404, { 'content-type': TYPES['.html'] });
    response.end(notFound);
  }
});

server.listen(port, () => {
  console.log(`The line is at http://localhost:${port}${base} (serving ${root})`);
});
