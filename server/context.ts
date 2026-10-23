import type { Task } from '../shared/types.js';
import { mkdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type Data = Record<string, any>;
export type SavedSource = { id: string; text: string; label: string };
const fields = [
  'humanDirection',
  'verifiedMemory',
  'teammateOutputs',
  'teamDecisions',
  'contributions',
  'recentWork',
  'requestedSources',
];
const textKeys = ['feedback', 'output', 'decisions', 'content', 'result', 'text'];
const size = (value: unknown) =>
  Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));

export function contextSources(data: Data): SavedSource[] {
  const sources: SavedSource[] = [];
  for (const field of fields)
    for (const [index, entry] of (data[field] || []).entries()) {
      const key = textKeys.find((key) => typeof entry[key] === 'string');
      if (key)
        sources.push({
          id: entry.sourceId || `${field}:${entry.id || index}`,
          text: entry[key],
          label: entry.title || entry.agenda || entry.role || field,
        });
    }
  if (data.task?.previousOutput)
    sources.push({
      id: 'previous-output',
      text: data.task.previousOutput,
      label: 'Previous attempt',
    });
  return sources;
}

/** Budget the transport bytes, not an assumed token count. Required instructions are never silently cut. */
export function assembleContext(system: string, data: Data, limit: number) {
  const originalBytes = size(system) + size(data);
  const sources = contextSources(data).map((s) => ({ ...s, chars: Array.from(s.text) }));
  const base = structuredClone(data);
  for (const field of fields) delete base[field];
  if (base.task) delete base.task.previousOutput;
  const required = size(system) + size(base);
  if (required + 512 > limit)
    throw new Error(
      `The saved brief, assignment and required instructions need at least ${required + 512} input bytes; the configured limit is ${limit}. Supporting work was compacted automatically. Increase Maximum input bytes in Workspace controls; your work is saved. No request was sent.`,
    );
  const prioritized = sources
    .map((source, i) => ({
      ...source,
      i,
      priority: source.id.startsWith('requested:')
        ? 0
        : source.id.startsWith('approval:')
          ? 1
          : source.id.startsWith('memory:')
            ? 2
            : 3,
    }))
    .sort((a, b) => a.priority - b.priority || b.i - a.i);
  let included = new Set(prioritized.map((s) => s.id));
  function build(cap: number): Data {
    const result = structuredClone(base);
    let cursor = 0;
    for (const field of fields) {
      result[field] = [];
      for (const entry of data[field] || []) {
        const key = textKeys.find((key) => typeof entry[key] === 'string');
        if (!key) {
          result[field].push(entry);
          continue;
        }
        const source = sources[cursor++];
        if (!included.has(source.id)) continue;
        const chars = source.chars;
        const text = chars.slice(0, cap).join('');
        result[field].push({
          ...entry,
          sourceId: source.id,
          [key]: text,
          ...(text.length < source.text.length
            ? {
                excerpt: true,
                totalCharacters: chars.length,
                nextOffset: Math.min(cap, chars.length),
              }
            : {}),
        });
      }
    }
    if (data.task?.previousOutput && included.has('previous-output')) {
      const chars = sources.find((s) => s.id === 'previous-output')!.chars;
      result.task.previousOutput = chars.slice(0, cap).join('');
      if (cap < chars.length)
        result.task.previousOutputExcerpt = {
          sourceId: 'previous-output',
          totalCharacters: chars.length,
          nextOffset: cap,
        };
    }
    if (originalBytes > limit)
      result.contextNotice = {
        partial: true,
        omittedSources: sources.length - included.size,
        indexSourceId: 'source-index',
        instruction:
          'Excerpts only. Retrieve source-index for omitted source IDs, then retrieve needed evidence. Originals are saved; teammate claims are not verification.',
      };
    return result;
  }
  // Keep identifiers and provenance; if a very large index cannot fit, omit the lowest-priority sources explicitly.
  while (size(system) + size(build(0)) > limit && included.size) {
    included.delete(prioritized.filter((s) => included.has(s.id)).at(-1)!.id);
  }
  let lo = 0,
    hi = Math.max(0, ...sources.map((s) => s.chars.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(system) + size(build(mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  const packed = build(lo),
    user = JSON.stringify(packed);
  const report: NonNullable<Task['contextReport']> = {
    inputBytes: size(system) + size(user),
    originalBytes,
    limit,
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label.slice(0, 100),
      totalCharacters: s.chars.length,
      includedCharacters: included.has(s.id) ? Math.min(lo, s.chars.length) : 0,
    })),
  };
  return { user, report };
}

export function retrieveSources(
  sources: SavedSource[],
  requests: { sourceId: string; offset: number }[],
  pageSize: number,
) {
  return requests.map((request) => {
    const source =
      request.sourceId === 'source-index'
        ? {
            id: 'source-index',
            label: 'Saved evidence index',
            text: sources.map((s) => `${s.id} | ${s.label}\n`).join(''),
          }
        : sources.find((s) => s.id === request.sourceId);
    if (!source)
      return {
        sourceId: `requested:${request.sourceId}`,
        title: request.sourceId,
        text: 'Unknown source ID. Use the identifiers in the supplied context.',
      };
    const chars = Array.from(source.text);
    return {
      sourceId: `requested:${source.id}:${request.offset}`,
      originalSourceId: source.id,
      title: `${source.label} · passage at ${request.offset}`,
      offset: request.offset,
      nextOffset: Math.min(chars.length, request.offset + pageSize),
      totalCharacters: chars.length,
      text: chars.slice(request.offset, request.offset + pageSize).join(''),
    };
  });
}

export function writeSourceBundle(directory: string, data: Data) {
  const folder = join(directory, '.workroom-context');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = lstatSync(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(
      'The project context folder is not a safe directory. Remove its symlink before retrying.',
    );
  const path = join(folder, `${randomUUID()}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      instruction:
        'Read-only copies of saved project evidence. Task outputs are not verified facts. The database originals remain authoritative.',
      sources: contextSources(data),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return path;
}
