# Connecting real AI workers

New to Workroom? Follow the [easy guide](EASY-GUIDE.md) for basic startup,
ChatGPT/Codex sign-in, account safety, and your first project. This page is the
reference for all supported connections.

Workroom schedules work; a runtime supplies the intelligence behind each character.
Walking and meetings visualize activity. Assignments, documents, verified project
memory, and review decisions carry the actual collaboration.

| Connection        | What it uses                                            | Costs and setup                                                       |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Demo              | Labeled local templates                                 | No model or credentials                                               |
| Codex             | Codex CLI signed in with ChatGPT                        | Your account's Codex allowance; install CLI and sign in locally       |
| Ollama            | An installed local model                                | Your hardware and electricity; no automatic downloads                 |
| OpenAI-compatible | Chat Completions server, such as LM Studio or llama.cpp | Local hardware, or separate hosted billing                            |
| OpenAI / Gemini   | Provider APIs                                           | API key, quota, explicit paid-request permission and price estimates  |
| External worker   | Your independently running agent                        | Your worker's models, tools and billing; internal calls are unmetered |

One connection serves the team. Each task receives the character's role, specialty,
bounded goal, assignment, brief, feedback, dependency outputs and verified memory.
Separate models or subscriptions per character are unnecessary. Connections are
chosen per project; per-character model routing is not implemented.

## Start locally

See [Ubuntu/Windows setup and migration](LOCAL-SETUP.md). Use Node.js 24 and
`npm run local`. Copy `.env.example` to `.env`, edit locally, then restart after
changing environment settings. Keep credentials out of Git and browser inputs.

**Runtime settings** chooses the default for **new projects**. Existing projects
retain their provider and exact model. To change one, pause it, open **Workspace
controls → Limits & connections**, and explicitly set its project connection.
Changing it preserves existing task plans and outputs. Changes to model settings
in `.env` supply defaults for new projects. Existing projects retain their selected IDs. Click the project’s **Model: … · Change** control to select a provider and edit its exact model ID while paused. This saves a preference without generating or verifying access; paid pricing must match that exact ID.

New dashboard projects with a real direct connection default to **AI planning**, which uses allowance/budget. Choose **Editable task template** to make **no planning request**. Demo/external projects use templates. Choose office coordination, software delivery, research/decision support, venture validation, or a custom plan. Each project stores its own four-role team, so editing one team's roles does not change other projects. Add/remove tasks and change assignments, dependencies, approval gates and instructions through **Edit plan**. A 30-task default ceiling is configurable; six is not a workflow constraint.

AI planning is optional and uses allowance/budget. The project and brief are saved before dispatch; the saved project reports planning state and offers retry or an explicit template fallback. Duplicate submissions reuse a project ID. Uncertain planning receipts require acknowledgment before retry. Invalid model plans are not replayed from the text cache. Stopped/restarted planning becomes a visible failed plan without losing the brief.

Input limits are measured in UTF-8 bytes, not exact model tokens. Respect your model
server's context window too; raising the app's byte limit does not enlarge it.

## ChatGPT access through Codex

ChatGPT web access is not an API key. This adapter uses the official
[Codex SDK](https://developers.openai.com/codex/sdk/) and bundled CLI (0.163.0) with ChatGPT sign-in.
Your account must include Codex access; subscription limits still apply.

1. On the computer running Workroom:

   ```bash
   npx --no-install codex login
   npx --no-install codex login status
   ```

2. Choose **Sign in with ChatGPT**, not an API key. Use `npx --no-install codex` and its `/model`
   picker to find an exact model ID available to your account, then exit it.
3. In `.env`, replace the model value with that ID:

   ```dotenv
   WORKROOM_CODEX_ENABLED=1
   WORKROOM_CODEX_MODEL=your-exact-model-id
   ```

4. Restart Workroom, open Runtime settings, click **Check connections**, and select
   **Codex · ChatGPT sign-in**. Create an office project, or explicitly change a
   paused project's connection in Workspace controls.

The sign-in check requests no generation. The worker excludes API keys and custom
`CODEX_HOME` from its environment, forces ChatGPT authentication, and never falls
back to paid APIs. Sign in under the OS account running Workroom, using the CLI's
standard credential location.

The document worker requests a temporary read-only directory, denies other
filesystem access and tool network access in a named permissions profile, disables
shell/patch features and configured MCP servers/hooks, and stops on unsupported tool events. Explicitly enabled Codex research permits built-in web search for text tasks; file/command/MCP tools remain blocked.
Its supported `never` approval policy prevents approval escalation while retaining
the named permissions profile. Local AGENTS.md and skill instructions are not
loaded: the worker receives its document context explicitly from Workroom.
Unsupported restrictions fail the assignment, with no unrestricted retry. This remains the text-mode worker for office/research/custom projects and AI planning. Authentication and model traffic to OpenAI still occur. Tests check the bridge contract and run the native
CLI's offline prompt/configuration check with private, empty CLI state and no model
generation. Your live account and generation quota must be checked on your computer.

### Software delivery worker

For **Software delivery**, each task starts a Codex assignment in the same managed folder, with that role's goals, approved handoffs and relevant memory. The native shell and patch tools are enabled. The default scope task is an inspection task with read-only source access; implementation/review/test tasks can change files. Inspection tasks have a writable private scratch folder. Project tools can read system runtime directories and the native CLI package, not Workroom's `.env` or arbitrary home files. Approval escalation, MCP servers, hooks, nested Codex agents are disabled. Built-in read-only web search can be enabled explicitly for the project; it is separate from command-network access. `never` means deny escalation; it is not an unrestricted execution flag.

Tool network defaults off. The project-specific **Edit plan → Allow tool network** setting permits internet requests, including dependency downloads, for later tasks. This grants network access to executed code and installation scripts too. Do not put secrets in these project folders. Workroom does not automatically deploy, publish or push; those actions are outside the task instructions. The sandbox restricts filesystem/network scope, not every possible semantic action inside the writable folder.

Tasks stream actual command lines, exit codes and file-change events into their saved details. Production reports use the shared `complete`/`needs_input`/`blocked`/`continue` work result with a deliverable, acceptance evidence, handoff and optional internal assignments. No successful tool activity means the software task is blocked even if its text claims completion. A blocker pauses the project and retains files, report and tool history; the user can clarify and retry. Reports and a successful command are evidence, not proof that all requirements are met. Independent code review, testing and material human decisions remain useful. Routine scope work no longer imposes a mandatory approval gate.

Coding assignments have a 15-minute timeout, use no text-result cache, and run one at a time within a project even if the global concurrency limit is higher. Native Codex can make multiple model turns during one assignment. Request limits count assignments, not internal turns; subscription allowance is not a hard dollar budget. Task and revision limits still apply, and there is no unbounded self-generated task loop. Workers can request focused internal follow-ups through the structured work contract; project task, revision/coordination and request limits bound them. You can also add work in the plan editor.

**Check connections** runs an offline coding probe with private empty CLI state. It checks actual command execution, a write in a temporary project folder, and denial of a sibling probe file. Coding is unavailable if that probe fails. This is a targeted readiness check, not a complete sandbox/security audit. The Linux cloud host used for development rejects native command startup because its reserved Codex socket directory has incompatible permissions; the runtime check reports that and does not bypass it. Native configurations and mocked SDK/tool contracts are tested; live ChatGPT generation and a full native coding run remain to be validated on the user's computer. Windows users should use Ubuntu in WSL2 if the native check fails.

One job can include multiple internal model turns. The ledger records jobs and
reported tokens, not remaining subscription allowance. The API/local output-token
setting does not control Codex. Keep a single worker, low request limit and short
assignments while learning your account's usage.

### Troubleshoot Codex jobs

Older Workroom builds collapsed different failures into “Codex could not finish.”
One confirmed startup defect was `approval_policy="untrusted"`, which the bundled
CLI rejects. Update the `workroom-starter` source and restart to get the supported
policy and specific, sanitized error codes. File, tool, and network restrictions
remain in place; there is no unrestricted or paid-API fallback.

| Error code                                             | Next step                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_AUTH`                                           | Sign in through `npx --no-install codex login`, restart, and check connections.                                                                                           |
| `CODEX_MODEL`                                          | Choose an exact model ID offered by your ChatGPT Codex account. Set its exact ID using the project’s Model → Change control. `.env` remains the default for new projects. |
| `CODEX_QUOTA`                                          | Check account allowance/rate limits and wait before retrying.                                                                                                             |
| `CODEX_REASONING`                                      | Choose a supported reasoning effort in Edit plan or a model supporting that effort.                                                                                       |
| `CODEX_CONFIG`                                         | Update/restart Workroom. If it persists, report the code and app/CLI versions.                                                                                            |
| `CODEX_SANDBOX`                                        | Check local directory permissions and native sandbox support. Keep restrictions enabled.                                                                                  |
| `CODEX_NETWORK`                                        | Check network/proxy/certificate configuration.                                                                                                                            |
| `CODEX_INSTALL`                                        | Run `npm run local` to prepare dependencies and check any custom CLI executable override.                                                                                 |
| `CODEX_TIMEOUT`, `CODEX_CANCELLED`, `CODEX_NO_RECEIPT` | Review Usage before explicitly retrying; allowance may already have been consumed.                                                                                        |
| `CODEX_TOOL_BLOCKED`                                   | Text tasks disable file/command tools. Explicit Codex research permits built-in web search. Software delivery enables scoped file/command tools; MCP remains disabled.    |
| `CODEX_UNKNOWN`                                        | Report the code, selected model ID, and whether failure was immediate or delayed.                                                                                         |

Error messages never copy raw CLI response bodies, prompts, paths, or credentials.
Do not send `.env`, auth files, or login tokens when asking for help. After reviewing
an uncertain attempt, acknowledge it in **Workspace controls → Usage**, then open
the failed task and choose **Retry task**, or choose **Retry planning** on the saved project. **Use editable template** provides a no-model planning fallback. Older builds could lose a brief before saving the project; that unsaved content cannot be recovered by updating. Historical attempt counts and reservations remain; no work is automatically repeated.

## Ollama and other local servers

Install [Ollama](https://ollama.com/download), start its service and install a model
whose license and hardware needs suit you. `ollama list` shows exact installed tags.

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=your-installed-model:tag
```

Restart, check connections, select **Local model · Ollama**, and create a project.
The check lists installed models without downloading/running one. Generation uses
`/api/chat`, bounded output and an 8K context window. Supporting inputs are budgeted into labeled source excerpts;
adjust limits or reduce the assignment rather than assuming unlimited memory.

For LM Studio, llama.cpp or another OpenAI-compatible server:

```dotenv
COMPATIBLE_API_URL=http://127.0.0.1:1234/v1
COMPATIBLE_MODEL=your-exact-model-id
COMPATIBLE_BILLING=local
```

Start that server and load a model first. Workroom checks `/models` for the selected
ID and uses `/chat/completions`. Add `COMPATIBLE_API_KEY` if required. Local billing
mode accepts only loopback addresses; remote endpoints require HTTPS and default
to paid-API controls. JSON planning and generation compatibility are confirmed by
actual assignments, not just successful metadata checks. Other native protocols
need an external worker; support for different models is not universal API support.

On an i7-1185G7 with about 16 GB RAM and integrated Intel Xe, first evaluate a
quantized 3–4B instruct model. A quantized 7–8B model may fit but will leave less
headroom and run more slowly. Don't run multiple copies. Integrated graphics shares
system memory. No weights are bundled; choose after quality, RAM and license review.

## Paid APIs and spending controls

Set `OPENAI_API_KEY` / `GEMINI_API_KEY` and a model your API account supports
(`OPENAI_MODEL` / `GEMINI_MODEL`). OpenAI uses Chat Completions; Gemini uses
`generateContent`. Consumer chat subscriptions do not supply these API credentials.

Paid requests start **disabled**. In **Workspace controls → Limits & connections**,
explicitly enable them and enter current USD prices per million input/output tokens
for the exact project model. Enter zero only for a verified free quota/rate.

Defaults: one active task globally, 30 tasks per project, one revision per task,
30 requests per rolling 24 hours, 24,000 input bytes, 2,000 output tokens, estimated
API budgets $2 per rolling day / $1 per project. These are editable. Large existing
plans are preserved and blocked until you raise their task limit. Changing a limit
does not cancel an already dispatched request.

Before paid planning, execution or revisions, Workroom records a conservative
reservation using input bytes plus a protocol allowance and the output limit at
your supplied rates. Reported usage replaces it with a receipt estimate. Failures,
timeouts and lost receipts retain the reservation. Review **Usage** and acknowledge
uncertain attempts before retrying. Acknowledgment retains historical reservation
and request count. Cancellation cannot undo usage already incurred.

These are **application dispatch estimates, not provider billing guarantees**.
Prices/token accounting can change; other apps and external worker calls are outside
the cap. Use provider-side quotas too. Codex uses subscription allowance. Successful
documents are cached within the same project using the complete prompt, provider,
model and output limit. Revised context/instructions change the key. Restore clears
the cache and disables paid requests. Full original outputs are preserved.

**Check connections** queries model metadata without generation; that does not
prove billing/quota. Provider error bodies and credential values are not displayed.
Live calls require your account and are not performed by credential-free tests.
Official references: [OpenAI pricing](https://openai.com/api/pricing/),
[Gemini billing](https://ai.google.dev/gemini-api/docs/billing),
[Codex authentication](https://developers.openai.com/codex/auth/).

## Local memory and practical value

Use **Workspace controls → Project memory** to propose a requirement, decision or
constraint. Link a completed source document if applicable, check the evidence,
then verify it. Only verified, current records for that project enter assignments.
Changed/unapproved source documents make records stale and exclude them. You must
keep human-supplied records current. Memory is evidence storage, not model training
or a truth guarantee. There is no automatic memory extraction or unbounded
self-starting agent loop; goal prompts guide the tasks you authorize.

Normal tasks receive dependency documents; final status/handoff tasks receive
completed project documents. A useful first benchmark: supply real constraints,
request a useful deliverable, check assumptions/totals, and compare editing time
with your usual process. Track accepted documents, unresolved claims, human editing
time and usage. The documents and review process must earn their place in your work.

## Custom agents and tools

External workers preserve the authenticated lease protocol. OpenAI Agents SDK,
LangGraph, CrewAI and Google ADK are frameworks you could implement in a worker;
they are not bundled/tested plugins. Avoid a second scheduler conflicting with
Workroom's queue. Workers may use other model APIs, local services or tools.

Set a strong shared `RUNNER_TOKEN`, select External workers for a project, run the
team, and start `npm run worker` separately. `AGENT_ID=mira`, `sol`, `atlas` or `echo`
binds a process to one character. Assignments include task, role, project, relevant
context, verified memory, advisory limits and lease ID. Heartbeat every 30 seconds.
See the [endpoint reference](../README.md#embody-independently-running-agents).

Expired leases stop for explicit review; they are not automatically rerun. Workers
need their own idempotency, tool permissions, cost limits and approval before side
effects. The included example returns labeled samples without a key; with its own
OpenAI key it makes separately billed, unmetered calls. Prefer built-in controlled
adapters for document work.

This remains a trusted single-user app. Private Codespaces ports also require
platform authentication for remote workers; runner tokens don't bypass it. Add
dashboard authentication, worker isolation, distributed ownership and permissions
before public/multi-user deployment. The human gate holds dependent tasks; it cannot
undo a worker's earlier file changes or actions.

### Managed source files and backups

Software folders are named with a readable title and a stable project-ID hash under `projects/` beside the database (normally `.data/projects/`). Roles share files; project titles may repeat without sharing folders. Files are retained on failures, retries, restarts and record restores. Outputs includes a source browser and a real ZIP download. Hidden files, symlinks, dependency folders and private-key extensions are omitted from browser exports. File previews are limited to 256 KB, ZIPs to 25 MB and 2,000 files. Use the local folder directly for larger projects.

Portable JSON backups contain records, not source. Copy managed folders separately with workers stopped, or download source ZIPs. Record restores never revert file edits. Existing legacy projects, six-document packs, exports and external leases remain supported. Normal new workspaces start empty; the explicit demo launcher retains a sample fixture.

## Saved team meetings and specialist quality

Team discussions are persisted model conversations: four role-specific contributions, then a chair's proposed decisions, dissent, evidence gaps and owner-assigned next actions. Contributions are deliberate public summaries, not internal model reasoning. Later tasks receive excerpts of the latest two completed decision records alongside dependency outputs and verified memory. Full records remain in the dashboard and JSON backups. Meeting notes never override human-approved scope.

Optional automatic kickoff and milestone meetings hold the task queue, use the existing project's frozen connection/model, and normally count as five `meeting` requests against policy. Each malformed turn can add at most one correction request (ten requests maximum per full meeting). They run serially and do not repeat while idle, paused, awaiting approval or complete. Model turns inside a Codex request are not capped by the job count. A stopped/failed meeting retains completed speakers, marks interrupted usage uncertain, and resumes only the remaining speakers and chair after explicit retry. The user can skip it while retaining its record. Restarts/restores mark active meetings failed and never replay them automatically. Existing projects do not gain automatic calls until configured; new dashboard projects show the setting before creation. External workers retain their separate task protocol.

Codex effort is now project-configurable (`low`, `medium`, `high`), with medium used when unspecified. Effort is included in text-cache keys. High is an allowance/latency tradeoff, not a guarantee of expertise. The specialist library supplies concrete goals and verification duties for ten professions on four active desks. Venture validation requires competing approaches, buyer pain, distribution, AI-substitution checks, explicit economics assumptions and a falsifiable test; missing customer evidence is not treated as validation.

Read-only Codex web research is a separate opt-in for project tasks, including managed file/command workers. It enables the native web-search tool and saves query events in task details, with source URLs/dates requested in reports. Text workers keep shell and patch disabled, and all workers keep MCP disabled. Managed workers retain their explicitly enabled file/command tools. Search-enabled tasks bypass the text cache to avoid silently replaying stale research. Meetings and AI planning still use supplied information without search; software tool network remains a separate permission. This bridge is tested with SDK event fixtures; real account/model search access and research quality require live evaluation locally.

Feedback, retry direction, memory, plan and agenda drafts are written synchronously to browser localStorage on editing. They survive dialog closure, limit errors, settings navigation and reloads; confirmed saves clear them. Drafts are browser-local, not server facts or portable backup content. Memory remains explicitly proposed and verified. Blocked/full storage is reported.

## Structured collaboration and bounded context

Direct model text tasks validate a work-result contract before completion. Checks must all be marked met for `complete`; `needs_input` requires a concrete question, reason, distinct choices and recommendation. Answering resumes the task rather than accepting unfinished work. `continue` adds up to three internal assignments, inserts dependencies before the parent, and resumes it with their evidence. Native managed workers use the same contract plus tool receipts. Existing external worker protocol and explicit human gates remain compatible. Schema validity does not prove semantic correctness or source truth.

Malformed text responses receive at most one format correction; missing passages permit at most two source retrieval rounds, with at most four total model calls for that task turn. Every call reserves usage through existing controls. Provider failures and uncertain attempts never enter this correction loop. Only validated complete non-research text results are cached. Tool work, plans, meetings and research are not text-cached.

The context assembler budgets actual UTF-8 transport bytes. It retains required goal, assignment, retry feedback and current approved project instructions; supporting sources receive stable IDs and explicit excerpt metadata. Full records remain in SQLite. Text workers can request saved passages by ID and Unicode-character offset. Managed workers receive a temporary private source bundle in `.workroom-context` inside their project; it is removed after the request and excluded from browser exports. Symlinked context folders are rejected. If required instructions alone exceed the limit, no generation occurs and the minimum needed size is reported. This is not an enlargement of a model’s own context window.

Any Codex team can opt into **Enable managed project tools** in its project connection controls. This creates a managed folder without changing team roles or workflow; the existing native sandbox and serial file-task scheduling apply. Turning tools off preserves files and receipts. No role or model output can enable tools or increase budgets itself.

Project instructions have an append-only version history (up to 50 versions). Agent suggestions remain proposals until the user loads, edits and saves a version. Restoring an earlier text creates another version. They affect the next project assignments and are included in backups; they do not modify application code, model weights, authentication, permissions or cost policy.
