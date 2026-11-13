import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ProjectNetwork } from './network.mjs';

export function projectPath(root, path) {
  const destination = resolve(root, path),
    rel = relative(root, destination);
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Paths must stay inside the project folder.');
  let check = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    check = join(check, part);
    if (existsSync(check) && lstatSync(check).isSymbolicLink())
      throw new Error('Download paths cannot contain symlinks.');
  }
  return destination;
}
const inside = projectPath;
export async function downloadImages({
  urls,
  output,
  root = process.cwd(),
  policy = {},
  client,
} = {}) {
  root = realpathSync(root);
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string'))
    throw new Error('The URL input must be a JSON array of actual HTTPS image URLs.');
  const folder = inside(root, output || 'downloads');
  mkdirSync(folder, { recursive: true });
  const indexPath = inside(root, join(relative(root, folder), 'download-index.json'));
  const network =
    client ||
    new ProjectNetwork({
      directory: inside(root, '.workroom-http'),
      policy,
      onEvent: (event) => console.log(JSON.stringify(event)),
    });
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8'))
    : { files: [], failures: [] };
  if (!Array.isArray(index.files) || !Array.isArray(index.failures))
    throw new Error('Invalid download index; preserve it and select a new output folder.');
  let completed = 0,
    skipped = 0,
    failed = 0,
    stopped;
  for (const url of [...new Set(urls)]) {
    try {
      const prior = index.files.find((file) => file.url === url);
      if (prior && /^[a-f0-9]{24}\.[a-z0-9]{1,8}$/.test(prior.filename)) {
        const path = inside(root, join(relative(root, folder), prior.filename));
        if (
          existsSync(path) &&
          createHash('sha256').update(readFileSync(path)).digest('hex') === prior.sha256
        ) {
          skipped++;
          continue;
        }
      }
      const resource = await network.get(url, { accept: 'image/*' });
      const type = resource.contentType.split(';')[0].toLowerCase();
      if (!type.startsWith('image/'))
        throw new Error(
          `Expected an image, received ${type || 'no content type'}. No image file written.`,
        );
      const extension =
        {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/avif': 'avif',
          'image/svg+xml': 'svg',
        }[type] || 'img';
      const filename = `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.${extension}`;
      const path = inside(root, join(relative(root, folder), filename));
      writeFileSync(path, resource.bytes, { flag: 'wx' });
      index.files = index.files.filter((file) => file.url !== url);
      index.files.push({
        url,
        filename,
        sha256: resource.sha256,
        bytes: resource.bytes.length,
        contentType: type,
        downloadedAt: new Date().toISOString(),
      });
      completed++;
    } catch (error) {
      failed++;
      index.failures.push({
        url,
        code: error.code || 'DOWNLOAD_ERROR',
        message: error.message,
        retryAt: error.retryAt,
        at: new Date().toISOString(),
      });
      if (
        [
          'HTTP_401',
          'HTTP_403',
          'HTTP_429',
          'HOST_PAUSED',
          'REQUEST_LIMIT',
          'SOURCE_POLICY',
          'TRANSPORT_ERROR',
          'NETWORK_BUSY',
        ].includes(error.code) ||
        /^HTTP_5/.test(error.code || '')
      )
        stopped = error.message;
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    if (stopped) break;
  }
  return { completed, skipped, failed, stopped, indexPath, requests: network.requests };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.length) {
    console.log(
      'Usage: node tools/workroom-download.mjs --urls urls.json --output images [--policy tools/network-policy.json]\nGET-only, sequential downloads. Policy defaults: 100 requests, 1000ms spacing, 10MiB/response, 30s timeout, 10min cache, 15min blocked-host cooldown, 3 redirects. Edit the machine-consumed policy to set site-specific published limits, blocked paths and preferred API/cache/dataset sources. Existing checked files are skipped. No 403/429 retry or access bypass.',
    );
  } else {
    try {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        if (!['--urls', '--output', '--policy'].includes(args[i]) || !args[i + 1])
          throw new Error('Unknown or incomplete option; use --help.');
        options[args[i]] = args[i + 1];
      }
      if (!options['--urls']) throw new Error('--urls is required.');
      const root = realpathSync(process.cwd()),
        policyPath = inside(root, options['--policy'] || 'tools/network-policy.json');
      const policy = existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : {};
      const result = await downloadImages({
        urls: JSON.parse(readFileSync(inside(root, options['--urls']), 'utf8')),
        output: options['--output'],
        root,
        policy,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.stopped || result.failed) process.exitCode = 2;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
