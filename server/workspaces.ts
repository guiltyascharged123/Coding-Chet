import { createHash } from 'node:crypto';
import { mkdirSync, lstatSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { zipSync } from 'fflate';
import type { Project } from '../shared/types.js';

export function workspaceFolder(project: Project) {
  const slug =
    project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'project';
  return `${slug}-${createHash('sha256').update(project.id).digest('hex').slice(0, 16)}`;
}
export function projectWorkspace(database: string, project: Project) {
  const folder = workspaceFolder(project);
  if (project.workspaceFolder && project.workspaceFolder !== folder)
    throw new Error('Project folder does not match its identity.');
  const root = resolve(database === ':memory:' ? '.data' : dirname(database), 'projects');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, folder);
  if (lstatSafe(path)?.isSymbolicLink())
    throw new Error('Project folders cannot be symbolic links.');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (dirname(realpathSync(path)) !== realpathSync(root))
    throw new Error('Project folder escapes the managed root.');
  return path;
}
function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}
const excluded = (name: string) =>
  name.startsWith('.') ||
  ['node_modules', 'vendor', '__pycache__', 'cli-state'].includes(name) ||
  /\.(pem|key|p12|pfx)$/i.test(name);
export function workspaceFiles(root: string) {
  const files: { path: string; bytes: number }[] = [];
  function walk(folder: string, depth: number) {
    if (depth > 15) return;
    for (const e of readdirSync(folder, { withFileTypes: true })) {
      if (excluded(e.name) || e.isSymbolicLink()) continue;
      const path = join(folder, e.name);
      if (e.isDirectory()) walk(path, depth + 1);
      else if (e.isFile())
        files.push({
          path: relative(root, path).split('\\').join('/'),
          bytes: lstatSync(path).size,
        });
      if (files.length > 2000)
        throw new Error(
          'The project exceeds the 2,000-file browser export limit. Use the local folder directly.',
        );
    }
  }
  walk(root, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function workspaceFile(root: string, name: string, max = 256000) {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((p) => p === '..' || excluded(p))
  )
    throw new Error('Invalid project file.');
  let path = root;
  for (const p of name.split('/')) {
    path = join(path, p);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Symbolic links are not exposed.');
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.size > max)
    throw new Error('Use the local folder for large or non-file items.');
  return readFileSync(path);
}
export function workspaceZip(root: string) {
  const files = workspaceFiles(root);
  if (files.reduce((n, f) => n + f.bytes, 0) > 25 * 1024 * 1024)
    throw new Error('Use the local folder for projects larger than 25 MB.');
  return zipSync(
    Object.fromEntries(files.map((f) => [f.path, workspaceFile(root, f.path, 25 * 1024 * 1024)])),
  );
}
