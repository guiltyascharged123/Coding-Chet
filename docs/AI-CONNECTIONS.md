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
in `.env` take effect for new projects, or when you explicitly reset a connection.

New projects normally use a six-task starter plan and make **no model request**.
Choose **Ask the selected model to plan** only when you want AI decomposition;
planning consumes allowance/budget too. Select **Office document pack** for a brief,
project plan, budget, risk register, meeting template and status report. Then
**Run team**, review its proposal, and inspect/export the results.

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
shell/patch features and configured MCP servers/hooks, and stops on tool events.
Its supported `never` approval policy prevents approval escalation while retaining
the named permissions profile. Local AGENTS.md and skill instructions are not
loaded: the worker receives its document context explicitly from Workroom.
Unsupported restrictions fail the assignment, with no unrestricted retry. This is
a document adapter, not an autonomous coding worker. Authentication and model
traffic to OpenAI still occur. Tests check the bridge contract and run the native
CLI's offline prompt/configuration check with private, empty CLI state and no model
generation. Those checks do not verify native sandbox enforcement or your live
account; check those on your own machine. Windows
users can use WSL2 if their native Codex CLI setup fails.

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

| Error code                                             | Next step                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_AUTH`                                           | Sign in through `npx --no-install codex login`, restart, and check connections.                                                                                        |
| `CODEX_MODEL`                                          | Choose an exact model ID offered by your ChatGPT Codex account. Update `.env`, restart, then explicitly reset the existing project's connection in Workspace controls. |
| `CODEX_QUOTA`                                          | Check account allowance/rate limits and wait before retrying.                                                                                                          |
| `CODEX_REASONING`                                      | The model rejected the worker's low reasoning setting; choose a model that supports it.                                                                                |
| `CODEX_CONFIG`                                         | Update/restart Workroom. If it persists, report the code and app/CLI versions.                                                                                         |
| `CODEX_SANDBOX`                                        | Check local directory permissions and native sandbox support. Keep restrictions enabled.                                                                               |
| `CODEX_NETWORK`                                        | Check network/proxy/certificate configuration.                                                                                                                         |
| `CODEX_INSTALL`                                        | Run `npm run local` to prepare dependencies and check any custom CLI executable override.                                                                              |
| `CODEX_TIMEOUT`, `CODEX_CANCELLED`, `CODEX_NO_RECEIPT` | Review Usage before explicitly retrying; allowance may already have been consumed.                                                                                     |
| `CODEX_TOOL_BLOCKED`                                   | Keep the assignment to document work; tools require a separately controlled external worker.                                                                           |
| `CODEX_UNKNOWN`                                        | Report the code, selected model ID, and whether failure was immediate or delayed.                                                                                      |

Error messages never copy raw CLI response bodies, prompts, paths, or credentials.
Do not send `.env`, auth files, or login tokens when asking for help. After reviewing
an uncertain attempt, acknowledge it in **Workspace controls → Usage**, then open
the failed task and choose **Retry task**. If planning failed before project creation,
create the project again after correcting the cause. Historical attempt counts and
reservations remain; no work is automatically repeated.

## Ollama and other local servers

Install [Ollama](https://ollama.com/download), start its service and install a model
whose license and hardware needs suit you. `ollama list` shows exact installed tags.

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=your-installed-model:tag
```

Restart, check connections, select **Local model · Ollama**, and create a project.
The check lists installed models without downloading/running one. Generation uses
`/api/chat`, bounded output and an 8K context window. Oversized inputs stop visibly;
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

Defaults: one active task globally, six tasks per project, one revision per task,
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
produce six office documents, check assumptions/totals, and compare editing time
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
