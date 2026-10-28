# Connect a model and run Workroom

Workroom runs in your browser, with a Node.js server on your computer. The default model runs locally through Ollama. A model generates each new AI plan and work result; the office shows saved task and meeting events. An idle avatar makes no model requests. Text-only connections cannot edit files, run tests, browse or take external actions.

## Ollama

Install Node.js 24 LTS, open a terminal in Coding-Chet, and run:

```bash
npm run local
```

On first use this installs the application dependencies, builds the interface, creates an ignored `.env` if one does not exist, installs/starts Ollama as needed, and downloads **`huihui_ai/qwen3.5-abliterated:4B`**. Model setup makes no inference requests. The first download needs internet and several GB of disk space. Model weights are downloaded from their publisher, rather than included in Workroom's MIT-licensed source; consult the model's own license and description.

Ubuntu/Linux uses Ollama's official `https://ollama.com/install.sh` installer. It may request your normal administrator/sudo password in the terminal. Windows uses `winget install --id Ollama.Ollama --exact`; Windows may request installation permission. macOS automatic installation requires Homebrew. If the installer or package manager is unavailable, install Ollama from [ollama.com/download](https://ollama.com/download), reopen your terminal, and run:

```bash
npm run setup:local
npm run local
```

`setup:local` can be run again safely. It preserves `.env`, reuses installed weights, starts the standard local service when needed, and pulls only the selected missing model. Download or connection failures stop with an error; no other model, sample text or paid API is substituted. The exact requested tag must exist in the Ollama registry. If Ollama reports that it cannot find the tag, check its spelling/capitalization with the publisher, update `OLLAMA_MODEL`, and retry. This cloud development environment could not reach Ollama's download site, so the model's live availability and quality were not verified here.

Existing projects and provider choices are retained. If only the older `.data/demo.sqlite` database exists, the launcher opens those saved records automatically in real-model mode. If both databases exist, the current workspace takes precedence; use backup/import to move other records. A saved Codex/API/external default does not trigger an Ollama install. To use Ollama instead, set `AGENT_PROVIDER=ollama`, restart with `npm run local`, check connections, and explicitly change any existing project's model.

### Local settings

These defaults appear in `.env.example`; the launcher creates `.env` once and never overwrites an existing file:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=huihui_ai/qwen3.5-abliterated:4B
WORKROOM_LOCAL_SETUP=1
# Optional explicit override; otherwise the saved default is retained:
# AGENT_PROVIDER=ollama
```

Change `OLLAMA_MODEL` to another exact tag to install/use that model. For an already managed Ollama service, set `WORKROOM_LOCAL_SETUP=0` to skip automatic installation and downloads. A custom local endpoint is respected, but automatic service startup is limited to the standard localhost port 11434. If your CLI is outside PATH, set `WORKROOM_OLLAMA_BIN` to its absolute path. Ollama must support structured JSON output and the `/api/chat` endpoint.

The default connection for an empty workspace is Ollama. Existing projects keep their frozen model IDs; edit `.env`, restart, then use **Model → Change** on the project to switch an existing one. **Model connections** changes the default for future projects. Neither action runs inference just to check readiness.

Local requests disable separate thinking output, use an 8192-token context, and respect the configured output token limit. This reduces overhead on a laptop with roughly 16 GB RAM; speed and useful output quality still need evaluation on your hardware. Keep the default single active task initially. A small model is useful for bounded text tasks, but model size alone does not establish reasoning or coding competence.

After installation, local inference can run without an internet connection. Workroom still uses your CPU/GPU, RAM, disk and electricity. The interface defaults to `http://127.0.0.1:3001`; use the actual URL printed in the terminal if you changed the port.

### Stop and troubleshoot

- Stop Workroom with Ctrl+C. The Ollama service may remain running for reuse; its models unload after the configured keep-alive (two minutes for Workroom requests).
- Run `ollama list` to see installed tags and `ollama ps` to see loaded models. Use `ollama stop huihui_ai/qwen3.5-abliterated:4B` to unload this model manually. Installed weights remain available.
- If auto-start fails, inspect `.data/ollama.log`, open the Ollama application or run `ollama serve`, then retry setup. A system-managed service may already be running; do not start a second copy.
- If the model requires a newer Ollama version, update Ollama from its official download page or installer and retry setup. Workroom reuses an existing installation rather than forcing upgrades to it.
- If a task reaches its output limit, reduce the assignment or adjust **Workspace controls → Maximum output tokens (API/local)**. Workroom retains the partial reply and confirmed receipt.
- Normal startup never substitutes Demo when a model is unavailable. Older simulation projects retain their records; select a real model before running them. New manual plans start empty.

## Codex

Use the bundled official Codex CLI to sign in:

```bash
npx --no-install codex login
```

Set these in `.env`, using an exact model ID supported by your account:

```dotenv
AGENT_PROVIDER=codex
WORKROOM_CODEX_ENABLED=1
WORKROOM_CODEX_MODEL=your-account-model-id
```

Restart Workroom and click **Model connections → Check connections**. Codex uses the account's subscription allowance, not API credits; Workroom does not fall back to an API key. Managed file editing and command execution require a successful local sandbox check and an explicit project choice. Software teams require this connection. See [the full Codex guide](AI-CONNECTIONS.md) for sign-in, allowance, exact-model selection and sandbox troubleshooting. Private reasoning is not exposed in the Live console.

## OpenAI

Create an API key through your OpenAI API account and configure:

```dotenv
AGENT_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model-id
```

API billing is separate from ChatGPT subscriptions. Restart, check connections, then explicitly enable paid APIs and enter prices for the exact model in **Workspace controls**. Keys belong in `.env` on the server, never in a brief, browser field, screenshot or Git commit. This adapter generates text; it does not provide Codex file/command tools.

## Gemini

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and select a model your account can use:

```dotenv
AGENT_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=your-available-model-id
```

Restart and check connections. Quota and billing depend on your Google account and model; AI Studio's web UI access alone does not establish API quota. Workroom treats this as a separately billed API connection and requires its paid permission and exact-model estimates, even when your Google account has a free allowance. This adapter supports text work.

## Compatible

For LM Studio, llama.cpp or another Chat Completions server:

```dotenv
AGENT_PROVIDER=compatible
COMPATIBLE_API_URL=http://127.0.0.1:1234/v1
COMPATIBLE_MODEL=the-exact-served-model-id
COMPATIBLE_BILLING=local
# COMPATIBLE_API_KEY=only-if-your-server-requires-it
```

Start that server and load the model separately. Local billing exemptions apply only to loopback addresses. A remote provider requires HTTPS, the appropriate key, `COMPATIBLE_BILLING=api`, explicit paid permission and price estimates. Compatibility varies by server; Workroom uses Chat Completions with JSON mode, not every vendor's tool protocol.

## External

For independently running agents, configure a strong shared `RUNNER_TOKEN` and select **External workers**. The example `npm run worker` uses real local Ollama text generation by default. Set `WORKER_PROVIDER=openai` explicitly to use its OpenAI adapter with your API key. Missing connections fail the assignment; the worker never supplies a canned success response. External-worker costs and tools are managed separately from Workroom's internal adapters. See [the runner protocol](../README.md#external-workers).

## Everyday workflow

1. Open **Model connections**, complete setup, and check readiness.
2. Create a project with a concrete goal, requested result, evidence and constraints. AI planning uses the selected model; manual planning starts empty.
3. Inspect the task plan, edit it if necessary, then click **Run team**.
4. Follow real model requests in **Live console**. Read results, evidence and blockers in **Task board**. Meetings are optional and off by default; a full meeting normally adds five model calls.
5. Answer a concrete decision request when needed. Use **Retry task** after correcting a blocker; the brief and prior work stay saved.
6. Click **View results** to inspect outputs. Check acceptance evidence and actual tool receipts before relying on claims about execution.

The current app is for a trusted local single-user workspace. Classroom and multi-user deployments require a separate design for identities, permissions, privacy and model controls.
