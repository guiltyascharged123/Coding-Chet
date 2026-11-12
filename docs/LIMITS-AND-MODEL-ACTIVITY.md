# Model activity, limits and planning recovery

## Update and retry the saved project

Stop Workroom with Ctrl+C, then run in Coding-Chet:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
npm run local
```

Open the private link printed in the terminal. Select the existing project and use **Retry planning**. The original brief is retained; you do not need to create another project.

The reported failure was a 134-character task title against the 100-character display-label bound. The old planner supplied neither that bound to Ollama's output schema nor a useful field-level error. A valid generated plan can now shorten a display title without another model call **only if its complete original wording also fits in the assignment description**. Requirements, dependencies and acceptance checks are retained. The event is recorded in Live console. An oversized assignment or evidence requirement is never silently cut to pass validation.

Other malformed plans receive the exact field/rule and at most the configured number of same-model format corrections. The default is one. Failures retain **Rejected plan · saved validation details**, including a downloadable reply or a clearly labeled display excerpt. Explicit retry uses the saved diagnosis when the brief, team, model and applicable direction still match; changed scope starts from current instructions. Network errors, unknown usage, cancellation, output truncation and exhausted budgets do not trigger automatic retries or a provider switch.

A format-valid plan is not proof that its proposed business will work. A text-only model cannot perform market research, contact buyers, collect money or build files merely by assigning those actions. Review capability fit and evidence before relying on an outcome.

## See what is happening

**Model activity** appears with real model jobs across Workspace, Task board, discussions and the console. It identifies the responsible agent, role, project assignment, provider and model. It distinguishes:

- Preparing the role instructions, brief and selected evidence.
- Waiting for public provider output. Local model loading and prompt processing can take minutes on a CPU; Workroom does not invent more detailed provider progress.
- Receiving public text and its observed character count.
- Checking a reply. A provider completion receipt does not mean the plan or work was accepted.
- A format-correction request or a saved-source retrieval request.
- Running an observed tool, waiting for dependencies/capacity, and saved or failed work.

The card shows wall-clock request elapsed time, the configured timeout, input bytes/budget, selected source count, and confirmed token counts when a receipt supplies them. **Request details** expands the stage explanation. A correction uses its own request timer and output count; earlier rejected output is not presented as fresh output. When idle, the latest record is compact. **Open live console** shows public text and tool output. **View limits and timeouts** opens the reference; **Pause project work** stops work rather than just the animation.

No private chain of thought, estimated percentage or invented milestones are displayed. Silence does not prove that a provider is healthy. A disconnected output stream is labeled; Reconnect reloads saved public events without making a model request. Dashboard and console share the public-output stream. External-worker status is identified as worker-reported; Workroom cannot inspect that worker's internal model activity.

## Find and change limits

Open **Workspace controls → Limits & connections**. Every numeric control shows its allowed range and purpose. **Limits reference** provides current values, fixed safeguards, recovery instructions and searchable field constraints generated from the actual validators. For example, search `tasks[].title`, `context`, `timeout`, `retention` or `apiKey`. This reference contains schema rules, not credential values.

| Control                       | Default            | Allowed range  | What it changes                                                                                                                          |
| ----------------------------- | ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Active tasks                  | 1                  | 1–4            | Concurrent jobs across the workspace; shared-folder coding stays serial.                                                                 |
| Tasks per project             | 30                 | 1–100          | Main-plan tasks plus bounded internal follow-ups. Existing work is not discarded when limits change.                                     |
| Revisions per task            | 1                  | 0–20           | Human revisions and internal coordination rounds.                                                                                        |
| Format corrections            | 1                  | 0–2            | Additional calls for invalid planner/text-task/meeting replies. Native coding tool work is never replayed automatically.                 |
| Source retrieval rounds       | 2                  | 0–8            | Additional text-model calls for saved evidence, with up to three passages requested per round. A final checked result is still required. |
| Ollama context ceiling        | 32,768 tokens      | 8,192–131,072  | Local context request ceiling. Larger windows can require substantially more RAM and CPU; the model may support less.                    |
| Requests per rolling 24 hours | 30                 | 1–10,000       | Dispatch guard, including corrections/retrieval. Codex can make multiple internal model turns inside one recorded job.                   |
| Maximum input                 | 24,000 bytes       | 2,000–200,000  | Workroom's UTF-8 request budget, separate from tokens and saved history.                                                                 |
| Maximum output                | 2,000 tokens       | 256–16,000     | Local/API generation ceiling. Native Codex manages its output-token behavior.                                                            |
| API estimate budgets          | $2/day, $1/project | $0–$1,000 each | Conservative Workroom dispatch estimates; not provider-wide billing caps or Codex subscription allowance.                                |

**Edit plan → Request timeout (seconds)** applies to text and managed coding jobs: 60–3,600 seconds, default 900. Changing a setting does not retroactively extend an already dispatched request. Budget/request guards are checked before each dispatch.

Ollama's effective byte budget is the lower of Maximum input bytes and its configured context estimate after reserving output plus 1,024 protocol tokens. Errors show the effective and configured values. Raising only the byte budget cannot override the local context ceiling, available RAM or the model's actual context support. Supporting sources are excerpted with retrievable IDs; required instructions are not silently discarded.

## Fixed safeguards and retention

Input/response field bounds make records transportable and model formats checkable. For example, task labels are 100 characters, assignments 4,000, and acceptance descriptions 300 with up to 10 criteria. Full work-result deliverables have a separate 100,000-character bound; concise metadata limits do not require throwing away a useful deliverable. The reference lists these fields and model grammar uses the same validators.

Browser transport/export safeguards remain explicit: ordinary API bodies 1 MiB; portable JSON restore and source ZIP 25 MiB; source listing 2,000 files and 15 folder levels; file previews 256,000 bytes. Deep file trees now produce a clear error rather than a silently incomplete export. Use the local project folder or a stopped `.data` copy for larger workspaces. Hidden files, dependency folders, symlinks and key-file extensions are intentionally excluded from browser source exports.

Projects, tasks, conversations, ideas, meetings, approvals, memory, brief/instruction versions and usage have no count-based retention stop. The previous 50 instruction versions / 100 brief versions and backup-only collection caps were removed. Disk/RAM and browser-import size still matter. Recent dashboard windows and paginated history do not set the model's context limit.

Live console is a separate rolling log: 300 entries / 480,000 characters per project; 1,000 / 2,000,000 across the workspace; displayed entries up to 48,000 characters. Export logs before rollover when needed. Saved accepted work, decisions, messages, usage and database response checkpoints remain separate records. A JSON backup does not contain source folders or console history.

Provider account quotas, generation support and hardware limits are outside Workroom's control. They remain distinct from the app settings. The example external worker now honors supplied input/output/context and project-timeout settings; custom workers must implement their own enforcement and billing controls.

## Verification for this update · November 3, 2026

The production build and formatting checks passed. Unit/integration tests: 155 passed, 2 skipped, 0 failed. Chromium browser tests: all 38 passed. The dependency audit reported no known vulnerabilities.

Regression cases include the reported 134-character title in a twelve-task plan, precise validation errors and retained rejected replies, changed instructions before retry, configurable zero/four-round evidence retrieval, history beyond the former version-count stops, numeric editing, request/correction visibility, saved-project recovery and existing exports/connections/office workflows.

Model responses were controlled offline fixtures; no live model inference or paid API calls were used. The two skips are native sandbox tests: Codex rejects its reserved socket directory ownership/permissions on this host. The tests do not bypass that restriction. Live model quality, performance and native sandbox behavior on your Ubuntu or Windows machine still require a small local trial; see [Model evaluation](MODEL-EVALUATION.md).
