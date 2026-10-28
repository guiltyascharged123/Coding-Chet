# Workroom

An open-source browser workspace for model-powered agent teams. Describe a goal, review a model-generated task plan, run the team, inspect real work and answer necessary decisions. A Three.js office visualizes task, handoff and meeting state.

## Run locally

Install **Node.js 24 LTS**, open a terminal in this repository, and run:

```bash
npm run local
```

First startup installs app dependencies, builds the interface, creates `.env` if missing, installs/starts Ollama as needed, and downloads **`huihui_ai/qwen3.5-abliterated:4B`**. Linux installation may request sudo permission; Windows requires winget or a separately installed Ollama application. The model download needs internet and several GB of disk space. Later starts reuse installed dependencies and weights. Existing environments and saved Codex/API/external defaults are preserved.

Open the URL printed in the terminal, normally **http://127.0.0.1:3001**. Keep the terminal open; Ctrl+C stops Workroom. Ollama may remain running for reuse. On Windows, the same command works in PowerShell or Command Prompt; use `npm.cmd run local` if PowerShell blocks npm scripts.

If local model setup needs attention:

```bash
npm run setup:local
```

[Local model and provider guide](docs/LOCAL-MODELS.md) explains Ubuntu/Windows installation, other model tags, OpenAI, Codex, Gemini/AI Studio, compatible servers, troubleshooting and costs. If the requested registry tag is unavailable, setup stops and reports the problem; it does not choose another model or simulate work. Live model download and quality could not be verified from this development host.

## Use it

1. **Model connections:** check readiness and choose the default for new projects.
2. **New project:** provide the goal, useful deliverables, constraints and evidence. Choose a team. AI planning uses the configured model; the manual option starts empty.
3. **Edit plan:** inspect tasks, owners, dependencies and acceptance criteria.
4. **Run team:** agents use the selected model with their role instructions and saved project context. The default permits one task at a time to control resource use.
5. **Task board / Live console:** inspect actual responses, checks, errors and public tool output. Retry saved failures without rewriting the brief.
6. **View results / Outputs:** read and export deliverables. A completed plan does not by itself prove an external goal was achieved; inspect the evidence.

Model-backed meetings are optional and off by default. A normal full meeting adds five model requests. A seated or moving avatar is not evidence of inference; the console and receipts show actual work.

The Workroom logo returns to Workspace. Sidebar pages, model settings and recovery actions are described in the [functionality audit](docs/UI-FUNCTIONALITY.md).

## Capabilities

- Project-specific teams, specialist instructions, roles and desks; a 3D office with purposeful movement, seated work, meetings and a WebGL fallback.
- Model-generated plans, editable task graphs, bounded specialist follow-ups, shared context, evidence-backed result records and source retrieval.
- Saved project briefs, task outputs, human decisions, draft autosave, retries and interrupted-work recovery.
- Optional model-backed meetings with proposals, critiques, decisions and saved contributions.
- Public request/response/tool console with filtering, local retention and downloads; private model reasoning is not exposed.
- Word, Excel, Markdown and print/PDF exports; source viewing and ZIP downloads for managed file projects.
- Ollama, ChatGPT-authenticated Codex, OpenAI, Gemini, OpenAI-compatible servers and authenticated external workers.
- Per-project provider/model choices, request limits, explicit paid API permission, estimates, usage receipts and no automatic paid fallback.
- Project memory with provenance, versioned instructions and portable backup/restore. An empty workspace can import a backup.

**Tool capabilities depend on the connection.** Ollama, OpenAI, Gemini and compatible adapters generate text from supplied material. Codex projects can explicitly enable managed file editing and commands after a sandbox readiness check; software teams require Codex. Optional Codex research enables built-in read-only web search. Role names alone do not grant tools or establish expertise.

Normal startup never runs canned work or falls back to Demo. Historical simulation projects and their outputs remain saved; choose a real project connection before running them. The old `npm run demo` command is a compatibility alias for the real workspace. Simulation is retained only as an explicitly enabled automated-test fixture.

## Configure and update

New empty workspaces default to local Ollama. `.env.example` supplies the model and endpoint defaults. An existing `.env` is never overwritten. Set `AGENT_PROVIDER` only when you want an explicit startup override; otherwise the saved default remains. **Model connections** changes future projects; **Model → Change** changes an existing project after pausing it.

Stop Workroom, then update from your repository directory:

```bash
git pull --ff-only origin workroom-starter
npm run local
```

Saved records normally live in ignored `.data/workroom.sqlite`; if only the older `.data/demo.sqlite` exists, the launcher opens it automatically to retain access to that work. When both exist, use backup/import or an explicit DATABASE_PATH. Managed project files live in `.data/projects/`. Portable backups include records and usage, not the actual source folders or console history. Back these up separately. See [the local setup/migration guide](docs/LOCAL-SETUP.md).

## Codespaces

Create a Codespace on `workroom-starter`. The container builds the app and opens the real workspace on forwarded port **3001**. It does not automatically install model weights in the cloud; configure a usable model connection and check readiness. A browser in Codespaces cannot directly use an Ollama service on your laptop's localhost. To run local models on your own hardware, clone this repository and use `npm run local` there.

Use `npm run codespace:restart` after pulling an update. Codespaces compute is billed according to your GitHub account; stop it when finished.

## External workers

Set a strong shared `RUNNER_TOKEN` on the server and worker, choose **External workers**, and run:

```bash
npm run worker
```

The example worker calls real local Ollama by default. Set `WORKER_PROVIDER=openai` explicitly for its API adapter. Missing models/keys fail the assignment; no sample success is returned. The authenticated runner API leases work, accepts heartbeats/events, and validates completion against the lease. Custom frameworks need a bridge to that protocol; they are not preinstalled integrations. External costs and tools are managed separately. See [AI connections](docs/AI-CONNECTIONS.md).

## Development and verification

```bash
npm ci
npm run dev
```

Vite serves port 5173 and proxies the server on 3001. `npm run local:prepare` builds without installing Ollama or downloading weights. `npm start` starts an already built server; manage the model separately or run `npm run setup:local` first.

```bash
npm run build
npm test
npm exec -- playwright test
```

Browser/model fixtures are deterministic tests of behavior, not evidence of live model quality. Native sandbox support depends on the host. Ubuntu/Windows CI is configured; platform-specific installation still needs evaluation on actual machines.

## Project scope

Workroom is a trusted local, single-user application. Classroom/multi-user use needs a separate design for privacy, permissions, supervision and model controls. The present work focuses on a clear project flow and useful model-backed output.

MIT license for the application. Model weights and third-party services retain their own licenses and terms.
