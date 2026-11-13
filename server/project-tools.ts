import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Install real utilities/configuration, never sample project data. */
export function ensureProjectTools(root: string) {
  const folder = join(root, 'tools');
  if (existsSync(folder) && lstatSync(folder).isSymbolicLink())
    throw new Error('Project tools cannot use a symlink folder.');
  mkdirSync(folder, { recursive: true });
  const checked = (name: string) => {
    const path = join(folder, name);
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error('Project tool/config files cannot be symlinks.');
    return path;
  };
  for (const name of [
    'network.mjs',
    'workroom-download.mjs',
    'workroom-crawl.mjs',
    'workroom-tools.mjs',
  ]) {
    const path = checked(name);
    if (!existsSync(path))
      copyFileSync(
        fileURLToPath(new URL(`../project-tools/${name}`, import.meta.url)),
        path,
        constants.COPYFILE_EXCL,
      );
  }
  const files = {
    'network-policy.json': {
      crawlRobots: 'ignore',
      userAgent: 'WorkroomProjectTool/1.0',
      minIntervalMs: 1000,
      maxRequests: 100,
      maxBytes: 10485760,
      timeoutMs: 30000,
      cacheTtlMs: 600000,
      blockedCooldownMs: 900000,
      maxRedirects: 3,
      hosts: {},
    },
    'workroom-tools.json': {
      version: 1,
      tools: [
        {
          id: 'download-images',
          target: 'tools/workroom-download.mjs',
          command:
            'node tools/workroom-download.mjs --urls <project-relative-json-array-file> --output <project-relative-folder>',
          purpose:
            'Download HTTPS images with caching, paced GET requests and persisted host/rate feedback.',
          help: 'node tools/workroom-download.mjs --help',
          policyFile: 'tools/network-policy.json',
          output:
            'Images and download-index.json receipts. Exit 2 means blocked/partial work; inspect the receipt before retry.',
        },
        {
          id: 'crawl-site',
          target: 'tools/workroom-crawl.mjs',
          command:
            'node tools/workroom-crawl.mjs --start <https-url> --output <project-folder> --max-pages 25',
          purpose:
            'Crawl static HTML in one origin/path scope with paced requests, caching, checkpoints and a local searchable index. Robots handling is explicit and configurable.',
          help: 'node tools/workroom-crawl.mjs --help',
          policyFile: 'tools/network-policy.json',
          output:
            'crawl-state.json and search-index.json with real page text/URLs. Exit 2 means paused or page allowance reached; inspect the receipt before resuming.',
        },
        {
          id: 'search-site-index',
          command:
            'node tools/workroom-crawl.mjs --search <query> --output <saved-index-folder> --limit 5',
          purpose: 'Search previously crawled page text locally without additional site requests.',
          help: 'node tools/workroom-crawl.mjs --help',
        },
        {
          id: 'manage-project-tools',
          target: 'tools/workroom-tools.mjs',
          command: 'node tools/workroom-tools.mjs --help',
          purpose:
            'Check and promote candidate tools, register verified commands, retain rollback snapshots, or prepare a checked Workroom patch from a separate project-local clone.',
          help: 'node tools/workroom-tools.mjs --help',
        },
      ],
      extensionProtocol:
        'Build candidates separately from active tools. Use workroom-tools.mjs promote with a meaningful behavior check to install and register a candidate only after checks pass; retain the returned revision for rollback. Have a separate reviewer inspect important changes. Reuse working tools for the goal. To change Workroom itself, use a separate full clone inside this project and workroom-tools.mjs propose-core; build/unit and relevant browser checks must pass before the patch is ready for review. Never edit the running host installation. This catalog does not grant permissions. Do not add dummy results or credentials.',
      networkProtocol:
        'Before bulk requests, inspect site/API documentation and published quotas using actual sources. Record per-host policySource, preferredSources, access (public/api-only/blocked), disallowPaths and minIntervalMs/maxRequests in network-policy.json. crawlRobots controls ignore/respect mode; robots are not silently enforced in ignore mode. Respect actual access restrictions and server rate feedback in either mode. Prefer official APIs or suitable caches/datasets when direct access is inappropriate. Reuse ProjectNetwork from tools/network.mjs to share cache, single-flight locking and host feedback. It is GET-only. Mutations need an explicitly authorized service connector and configured account access; no credential guessing or access bypass.',
    },
  };
  for (const [name, value] of Object.entries(files)) {
    const path = checked(name);
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' });
  }
}
