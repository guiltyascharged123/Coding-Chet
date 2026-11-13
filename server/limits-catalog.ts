import { z } from 'zod';
import {
  backupSchema,
  collaborationSchema,
  stateSchema,
  policySchema,
  memorySchema,
} from '../shared/schemas.js';
import { projectUpdateSchema } from '../shared/projects.js';
import { teamMemberSchema } from '../shared/team.js';
import { workResultSchema, retrievalSchema } from '../shared/work.js';
import { contributionSchema, chairSchema } from '../shared/meetings.js';
import { connectionSettingsSchema } from './connection-settings.js';
import { planSchema } from './planning.js';
import { CONSOLE_LIMITS } from '../shared/console.js';
import { POLICY_FIELDS, RESOURCE_LIMITS } from '../shared/limits.js';
import { policy } from './policy.js';
import type { Store } from './store.js';
import type { Project } from '../shared/types.js';

export type FormatLimit = { group: string; field: string; rule: string; why: string };
function schemaRows(group: string, schema: z.ZodType, why: string): FormatLimit[] {
  const document = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as any;
  const rows: FormatLimit[] = [];
  function walk(node: any, path: string, seen = new Set<string>()) {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      if (seen.has(node.$ref)) return;
      const next = new Set(seen).add(node.$ref);
      const resolved = node.$ref
        .split('/')
        .slice(1)
        .reduce(
          (value: any, key: string) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')],
          document,
        );
      walk(resolved, path, next);
      return;
    }
    const rules: string[] = [];
    if (node.minLength !== undefined || node.maxLength !== undefined)
      rules.push(`${node.minLength ?? 0}–${node.maxLength ?? 'no field maximum'} characters`);
    if (node.minItems !== undefined || node.maxItems !== undefined)
      rules.push(`${node.minItems ?? 0}–${node.maxItems ?? 'no count cap'} items`);
    if (node.minimum !== undefined && Math.abs(node.minimum) < 1e9)
      rules.push(`minimum ${node.minimum}`);
    if (node.maximum !== undefined && Math.abs(node.maximum) < 1e9)
      rules.push(`maximum ${node.maximum}`);
    if (node.pattern) rules.push(`format: ${node.pattern}`);
    if (node.enum) rules.push(`allowed: ${node.enum.join(', ')}`);
    if (rules.length) rows.push({ group, field: path || group, rule: rules.join('; '), why });
    for (const [key, value] of Object.entries(node.properties || {}))
      walk(value, path ? `${path}.${key}` : key, seen);
    if (node.items) walk(node.items, `${path}[]`, seen);
    for (const alternative of [...(node.anyOf || []), ...(node.oneOf || []), ...(node.allOf || [])])
      walk(alternative, path, seen);
  }
  walk(document, '');
  return [...new Map(rows.map((row) => [`${row.field}:${row.rule}`, row])).values()];
}
let formats: FormatLimit[] | undefined;
export function limitsCatalog(store: Store, project?: Project) {
  formats ||= [
    ...schemaRows(
      'Project brief',
      projectUpdateSchema,
      'Edit the project brief. Field lengths bound interface/request size; original brief versions are retained.',
    ),
    ...schemaRows(
      'Task plan',
      planSchema,
      'Edit plan. Display titles are bounded labels; generated long titles are shortened only when the full wording fits in the assignment. Requirements are never cut to pass validation.',
    ),
    ...schemaRows(
      'Team roles',
      teamMemberSchema,
      'Your team → Edit role & desk. The selected 4/8/12 office bounds available desks.',
    ),
    ...schemaRows(
      'Project settings',
      collaborationSchema,
      'Edit plan → Team workflow; request timeout applies to model jobs, including managed coding.',
    ),
    ...schemaRows(
      'Work result',
      workResultSchema,
      'Model response contract. Public JSON must contain useful work and checkable evidence. Invalid fields are shown on the saved task; reduce scope or correct the response.',
    ),
    ...schemaRows(
      'Source request',
      retrievalSchema,
      'Text models can request up to three passages per retrieval round. Round count is adjustable in economy settings.',
    ),
    ...schemaRows(
      'Meeting contribution',
      contributionSchema,
      'Public model proposal format. Exact issues and the rejected reply are retained if validation fails.',
    ),
    ...schemaRows(
      'Meeting decision',
      chairSchema,
      'Chair response format. Actions must refer to existing queued work; meeting replies cannot execute actions.',
    ),
    ...schemaRows(
      'Memory',
      memorySchema,
      'Project memory. Split long facts and verify provenance; there is no count-based record retention cap.',
    ),
    ...schemaRows(
      'Connections',
      connectionSettingsSchema,
      'Models & sign-in. Model IDs, endpoints and credentials follow the connector format; credential values are never included in this reference.',
    ),
    ...schemaRows(
      'Stored records and backups',
      stateSchema,
      'Serialization/backup field constraints, not model context. Growing record collections have no count-based retention cap. For large backups, copy the stopped .data directory.',
    ),
    ...schemaRows(
      'Portable backup',
      backupSchema,
      'Backup & restore. File import also has a 25 MiB transport bound; full local .data copies preserve large databases, source files and console logs.',
    ),
  ];
  const current = policy(store);
  const localTokens = current.localContextTokens ?? RESOURCE_LIMITS.ollamaContextTokens;
  return {
    editable: POLICY_FIELDS.map(([key, name, min, max, why]) => ({
      key,
      name,
      value: current[key],
      min,
      max,
      why,
      edit: 'Workspace controls → Limits & connections',
    })),
    project: [
      {
        name: 'Request timeout',
        value: `${project?.requestTimeoutSeconds || 900} seconds (allowed 60–3600)`,
        why: 'Stops a model job that exceeds its wall-clock allowance; it does not roll back files or refund usage.',
        edit: 'Edit plan → Request timeout (seconds)',
      },
      {
        name: 'Effective Ollama input budget',
        value: `${Math.max(0, Math.min(current.maxInputBytes, (localTokens - current.maxOutputTokens - 1024) * 3))} bytes`,
        why: `Minimum of Maximum input bytes and the local context estimate after ${current.maxOutputTokens} output tokens plus 1,024 protocol tokens. Actual tokenization/model support varies.`,
        edit: 'Limits & connections → Maximum input bytes / Ollama context ceiling / Maximum output tokens',
      },
    ],
    fixed: [
      {
        name: 'Project HTTP tools and internet policy',
        value:
          'Configurable per-project GET pacing, request/byte/time/cache/redirect limits; server rate headers can impose stricter pauses',
        why: 'Inspect tools/network-policy.json and run node tools/workroom-download.mjs --help for defaults and ranges. Cache/host state and single-flight locking are in .workroom-http. These are separate from model requests and do not meter unrelated programs or accounts.',
      },
      {
        name: 'Project crawl and local search limits',
        value:
          'Default 25 pages (1–1000 total across resumes), depth 2 (0–10), text/page 100000 characters (1000–1000000), queue 10000, search results 5 (1–50)',
        why: 'Run node tools/workroom-crawl.mjs --help. Page/depth/text/search allowances and ignore/respect robots mode are explicit options; HTTP budgets apply additionally. Saved index text is searchable without site requests.',
      },
      {
        name: 'Tool promotion and Workroom patch checks',
        value:
          'Default 600000 ms/check (5000–3600000 adjustable), 4 MiB captured output/command; one lifecycle change per project',
        why: 'Run node tools/workroom-tools.mjs --help. Failed/time-limited checks do not promote candidates or mark core patches ready. Snapshots/receipts are retained under .workroom-tools; Workroom proposals are also visible under tool-proposals. These checks run inside the existing worker sandbox.',
      },
      {
        name: 'Saved record retention',
        value:
          'No count-based cap on saved historical records: projects, tasks, brief/instruction versions, meetings, memory, decisions or usage',
        why: 'Per-project task/request controls, available disk/RAM and browser restore size still apply. Keep a stopped .data copy for large workspaces.',
      },
      {
        name: 'File export exclusions',
        value: 'Hidden files, dependency folders, symlinks and private-key extensions are omitted',
        why: 'Protects credentials and avoids exporting dependencies. Use the local folder when you need the complete source tree; no source files are deleted.',
      },
      {
        name: 'Codex sign-in setup',
        value: '15 minutes; retained status output up to 16,000 characters',
        why: 'A stalled login is stopped without changing project work. Reset sign-in or reconnect through Models & sign-in.',
      },
      {
        name: 'Normal API request',
        value: `${RESOURCE_LIMITS.requestBytes} bytes (1 MiB)`,
        why: 'Bounds parsing and memory use. Split a large edit; it is rejected before mutation.',
      },
      {
        name: 'Portable JSON restore / source ZIP',
        value: `${RESOURCE_LIMITS.restoreBytes} bytes (25 MiB)`,
        why: 'Browser import/export memory bound. Copy the local project folder or stopped .data for larger workspaces; source files are never deleted by this cap.',
      },
      {
        name: 'Browser source listing',
        value: `${RESOURCE_LIMITS.projectFiles} files; ${RESOURCE_LIMITS.projectDepth} folder levels`,
        why: 'Bounds traversal. Excess depth now raises an explicit error instead of silently omitting files. Use the local folder.',
      },
      {
        name: 'File preview',
        value: `${RESOURCE_LIMITS.filePreviewBytes} bytes`,
        why: 'Bounds browser previews. Download a source ZIP within its cap or open the local file.',
      },
      {
        name: 'Raw model reply',
        value: `${RESOURCE_LIMITS.modelReplyCharacters} characters; Ollama stream line ${RESOURCE_LIMITS.ollamaStreamLineCharacters} characters`,
        why: 'Bounds response handling. Lower output tokens or split the assignment; partial public output remains in Live console.',
      },
      {
        name: 'Live console retention',
        value: `${CONSOLE_LIMITS.projectEntries} entries / ${CONSOLE_LIMITS.projectCharacters} characters per project; ${CONSOLE_LIMITS.workspaceEntries} / ${CONSOLE_LIMITS.workspaceCharacters} workspace-wide; ${CONSOLE_LIMITS.entryCharacters} per displayed entry`,
        why: 'This operational log is a rolling window. Export logs before rollover. Saved accepted task outputs, decisions, messages and usage are separate retained records.',
      },
      {
        name: 'Recent display windows',
        value:
          '250 activity events; 200 recent messages/cards; 500 recent receipts plus unresolved receipts',
        why: 'Older activity, conversations, ideas and receipts are paginated. Display size does not delete their journals or set model context.',
      },
      {
        name: 'Task evidence display',
        value:
          '100 most recent tool receipts/observations per task; 20,000 context source references',
        why: 'Keeps saved task details bounded. The console has its separate rolling retention; evidence checks must cite retained observations.',
      },
      {
        name: 'External worker lease',
        value:
          '120 seconds; example worker heartbeats every 30 seconds; control requests time out at 20 seconds',
        why: 'Detects disconnected workers. Send heartbeats to retain the lease; expired work needs usage review before retry. The example honors supplied input/output/context and project timeout limits; custom workers must implement their own enforcement.',
      },
      {
        name: 'Browser session',
        value: `${RESOURCE_LIMITS.browserSessionHours} hours`,
        why: 'Renews through the private pairing link; this is unrelated to ChatGPT sign-in.',
      },
      {
        name: 'Provider limits and machine resources',
        value: 'Provider/account/model-specific; available disk, RAM and browser storage',
        why: 'Workroom cannot raise a provider quota or a model’s trained context window. Green metadata checks do not prove remaining allowance or task quality. Draft storage failures show a warning.',
      },
    ],
    formats,
    formatNotice:
      'These field constraints are read from the actual validators. Range bounds are fixed compatibility/resource bounds; their current operational values are editable where indicated. Structural requirements also enforce valid owners, earlier dependencies, unique criterion IDs, met evidence checks and authorized tools. No user content or credential values are included here.',
  };
}
