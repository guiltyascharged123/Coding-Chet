import { createHmac, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';
import { serviceUrl } from './managed.js';
import { DEFAULT_LOCAL_MODEL } from '../shared/defaults.js';
import { COMMUNITY_ANONYMOUS_KEY, isCommunityEndpoint } from '../shared/community.js';

const assertServiceUrl = (value: string, localOnly = false) => {
  try {
    serviceUrl(value, localOnly);
  } catch {
    throw new SettingsError(
      'Use a loopback HTTP model server, or a remote HTTPS service without embedded credentials, query strings or fragments.',
    );
  }
};
const publicEndpoint = (value: string) => {
  try {
    serviceUrl(value);
    return value;
  } catch {
    return '';
  }
};
const model = z
  .string()
  .trim()
  .max(150)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,149}$/);
const key = z
  .string()
  .trim()
  .max(8192)
  .regex(/^[A-Za-z0-9._~+\-/=:]*$/)
  .optional();
const apiFields = { model, apiKey: key, clearKey: z.boolean().default(false) };
export const connectionSettingsSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('codex'),
      revision: z.string(),
      enabled: z.boolean(),
      model: model.or(z.literal('')),
    })
    .strict(),
  z.object({ provider: z.literal('openai'), revision: z.string(), ...apiFields }).strict(),
  z.object({ provider: z.literal('gemini'), revision: z.string(), ...apiFields }).strict(),
  z
    .object({
      provider: z.literal('ollama'),
      revision: z.string(),
      model,
      url: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      provider: z.literal('compatible'),
      revision: z.string(),
      ...apiFields,
      url: z.string().max(2048),
      billing: z.enum(['local', 'api', 'community']),
    })
    .strict(),
]);
export class SettingsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Update a key's entire assignment (including quoted multiline values), remove
// duplicate assignments for that key, and preserve unrelated settings and comments.
export function patchEnv(source: string, changes: Record<string, string>) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/),
    seen = new Set<string>(),
    output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    const match = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      output.push(lines[i]);
      continue;
    }
    const [_, name, raw] = match,
      quote = raw[0];
    if (['"', "'", '`'].includes(quote)) {
      let text = raw.slice(1);
      const closed = (value: string) =>
        [...value.matchAll(/['"`]/g)].some(
          (m) =>
            m[0] === quote && (value.slice(0, m.index).match(/\\*$/)?.[0].length || 0) % 2 === 0,
        );
      while (!closed(text) && i + 1 < lines.length) text += '\n' + lines[++i];
      if (!closed(text))
        throw new SettingsError(
          'The existing .env has an unterminated quoted setting. Correct it before saving connections.',
        );
    }
    if (!(name in changes)) output.push(...lines.slice(start, i + 1));
    else {
      if (!seen.has(name)) output.push(`${name}='${changes[name]}'`);
      seen.add(name);
    }
  }
  while (output.at(-1) === '') output.pop();
  for (const [name, value] of Object.entries(changes)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /['\r\n\0]/.test(value))
      throw new SettingsError('Invalid connection setting.');
    if (!seen.has(name)) output.push(`${name}='${value}'`);
  }
  return output.join(newline) + newline;
}

export class ConnectionSettings {
  private secret = randomBytes(32);
  private file: string;
  constructor(
    root: string,
    private env: NodeJS.ProcessEnv = process.env,
  ) {
    this.file = join(root, '.env');
  }
  private read() {
    if (!existsSync(this.file)) return '';
    const stat = lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new SettingsError(
        'Workroom connection settings require a regular .env file under 1 MB.',
      );
    return readFileSync(this.file, 'utf8');
  }
  private revision(source: string) {
    return createHmac('sha256', this.secret).update(source).digest('hex');
  }
  view() {
    const source = this.read(),
      persisted = parse(source);
    const saved = (name: string) =>
      Object.hasOwn(persisted, name) ? persisted[name] : this.env[name];
    return {
      revision: this.revision(source),
      environmentOverrides: Object.entries(persisted)
        .filter(
          ([name, value]) =>
            /^(WORKROOM_CODEX_|OPENAI_|GEMINI_|OLLAMA_|COMPATIBLE_)/.test(name) &&
            this.env[name] !== undefined &&
            this.env[name] !== value,
        )
        .map(([name]) => name),
      codex: {
        enabled: saved('WORKROOM_CODEX_ENABLED') === '1',
        model: saved('WORKROOM_CODEX_MODEL') || '',
      },
      openai: { model: saved('OPENAI_MODEL') || 'gpt-4.1-mini', hasKey: !!saved('OPENAI_API_KEY') },
      gemini: {
        model: saved('GEMINI_MODEL') || 'gemini-2.5-flash',
        hasKey: !!saved('GEMINI_API_KEY'),
      },
      ollama: {
        model: saved('OLLAMA_MODEL') || DEFAULT_LOCAL_MODEL,
        url: publicEndpoint(saved('OLLAMA_URL') || 'http://127.0.0.1:11434'),
      },
      compatible: {
        model: saved('COMPATIBLE_MODEL') || '',
        url: publicEndpoint(saved('COMPATIBLE_API_URL') || 'http://127.0.0.1:1234/v1'),
        billing:
          saved('COMPATIBLE_BILLING') === 'community'
            ? ('community' as const)
            : saved('COMPATIBLE_BILLING') === 'local'
              ? ('local' as const)
              : ('api' as const),
        hasKey: !!saved('COMPATIBLE_API_KEY'),
      },
    };
  }
  save(input: unknown) {
    const data = connectionSettingsSchema.parse(input),
      source = this.read();
    if (this.revision(source) !== data.revision)
      throw new SettingsError(
        'Connection settings changed elsewhere. Reload the saved settings before saving again. Your inputs have been retained.',
        409,
      );
    const changes: Record<string, string> = {};
    if (data.provider === 'codex')
      Object.assign(changes, {
        WORKROOM_CODEX_ENABLED: data.enabled ? '1' : '0',
        WORKROOM_CODEX_MODEL: data.model,
      });
    if (data.provider === 'ollama') {
      assertServiceUrl(data.url, true);
      Object.assign(changes, { OLLAMA_MODEL: data.model, OLLAMA_URL: data.url });
    }
    if (
      data.provider === 'openai' ||
      data.provider === 'gemini' ||
      data.provider === 'compatible'
    ) {
      const prefix = data.provider.toUpperCase();
      changes[`${prefix}_MODEL`] = data.model;
      if (data.clearKey && data.apiKey)
        throw new SettingsError('Choose either removing the saved key or providing a replacement.');
      if (data.clearKey) changes[`${prefix}_API_KEY`] = '';
      else if (data.apiKey) changes[`${prefix}_API_KEY`] = data.apiKey;
      if (data.provider === 'compatible') {
        assertServiceUrl(data.url, data.billing === 'local');
        if (data.billing === 'community') {
          if (!isCommunityEndpoint(data.url))
            throw new SettingsError(
              'Free community mode is restricted to the official AI Horde HTTPS endpoint.',
            );
          changes.COMPATIBLE_API_KEY = COMMUNITY_ANONYMOUS_KEY;
        }
        Object.assign(changes, { COMPATIBLE_API_URL: data.url, COMPATIBLE_BILLING: data.billing });
      }
    }
    const next = patchEnv(source, changes);
    // A lock serializes Workroom saves; a second read catches ordinary external edits.
    const lock = `${this.file}.workroom-lock`,
      temp = `${this.file}.workroom-${randomBytes(8).toString('hex')}.tmp`;
    let fd: number;
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch {
      let dead = false;
      try {
        const record = JSON.parse(readFileSync(lock, 'utf8'));
        if (Number.isInteger(record.pid) && record.pid > 1) {
          try {
            process.kill(record.pid, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
          }
        }
      } catch {
        /* An unknown or live lock cannot be stolen. */
      }
      if (!dead)
        throw new SettingsError(
          'Another connection save is in progress. Try again after that Workroom process stops.',
          409,
        );
      rmSync(lock);
      fd = openSync(lock, 'wx', 0o600);
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      fsyncSync(fd);
      if (this.read() !== source)
        throw new SettingsError(
          'The .env file changed during this save. Reload settings before trying again.',
          409,
        );
      const output = openSync(temp, 'wx', 0o600);
      try {
        writeFileSync(output, next);
        fsyncSync(output);
      } finally {
        closeSync(output);
      }
      if (this.read() !== source)
        throw new SettingsError(
          'The .env file changed during this save. Reload settings before trying again.',
          409,
        );
      renameSync(temp, this.file);
      const persisted = parse(next);
      const owned =
        data.provider === 'codex'
          ? ['WORKROOM_CODEX_ENABLED', 'WORKROOM_CODEX_MODEL']
          : data.provider === 'ollama'
            ? ['OLLAMA_MODEL', 'OLLAMA_URL']
            : data.provider === 'compatible'
              ? [
                  'COMPATIBLE_MODEL',
                  'COMPATIBLE_API_URL',
                  'COMPATIBLE_BILLING',
                  'COMPATIBLE_API_KEY',
                ]
              : [`${data.provider.toUpperCase()}_MODEL`, `${data.provider.toUpperCase()}_API_KEY`];
      for (const name of owned)
        if (Object.hasOwn(persisted, name)) this.env[name] = persisted[name];
      return this.view();
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
      rmSync(temp, { force: true });
    }
  }
}
