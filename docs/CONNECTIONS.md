# Connect models, sign in, and edit projects

Start Workroom with `npm run local`, then open **Models & sign-in** at the top of the workspace. **Model connections** in the sidebar opens the same full page. Chrome is supported: the browser displays Workroom, while its local server connects to models on your Ubuntu or Windows computer.

## What the indicators mean

- **Connected, green:** the model service or official Codex sign-in check succeeded. API checks query model metadata, not generation.
- **Not checked, amber:** settings exist, but the selected model has not passed a connection check.
- **Unavailable:** the service, selected model, authentication or endpoint check failed. Read the reason on the card.
- **Disabled:** that provider is switched off or has no configured key.

The Workroom server being online is separate from model access. None of these checks prove remaining subscription allowance, API quota or output quality. Click **Check connections** after starting a local service or completing sign-in. Opening the page also refreshes readiness without generating work.

## ChatGPT / Codex on the same Ubuntu computer

If a saved project says Codex is disabled, its project records are still there. The project remembers its selected model, but the running Workroom server also needs Codex enabled. Signing into ChatGPT in Chrome alone does not sign the Codex CLI in.

1. Open **Models & sign-in → Codex → Set up / sign in**.
2. If you already ran `npx --no-install codex login`, click **Check status**. Workroom verifies the CLI sign-in and clears a stale attempt. Enable Codex and save if it is disabled.
3. Otherwise click **Sign in with ChatGPT**. Workroom uses the bundled CLI's normal browser login, equivalent to `npx --no-install codex login`. Finish in the browser tab it opens, or use **Open ChatGPT sign-in**.
4. Read **Codex CLI status** for the checked command, result, exit code and check time. This verifies authentication, not model quota or generation.
5. **Reconnect ChatGPT** stops the old attempt before opening a fresh browser login. **Reset sign-in** stops the attempt, releases its work hold and reloads saved form settings. It keeps CLI credentials, API keys, models and projects.

If you saw “Enable device code sign-in for Codex,” that was the optional device flow. Normal browser login does not require enabling it. Device login remains under **Terminal or remote sign-in** for remote machines. Unsupported device login, process failures and timeouts clear their hold instead of leaving the team blocked.

If you signed in successfully in another terminal while an attempt was pending, Workroom recognizes the new sign-in when status is refreshed or a project is started. An intentional reconnect from an already signed-in account stays pending until it finishes, is reset, or you explicitly accept the current account with **Check status**.

Terminal fallback, from Coding-Chet under the same OS user running Workroom:

```bash
npx --no-install codex login
npx --no-install codex login status
```

Choose **Sign in with ChatGPT**. Then return to Connections and click **Check status**. For exact model IDs, use the bundled CLI's `/model` picker. A detected sign-in is separate from the managed coding sandbox check. If coding tools fail that check, the page reports the sandbox blocker; it does not bypass restrictions or fall back to a paid API.

## OpenAI or Gemini / Google AI Studio

Open the provider card and click **Configure connection**. Follow its official API-key link, enter the key and exact model ID, then **Save connection**. These adapters use API keys; they do not take your account username and password. ChatGPT subscription access is separate from OpenAI API billing. Gemini API quota depends on your Google account and selected model.

Saved keys are not returned to the browser. A blank key field keeps the saved key; **Remove this saved API key** explicitly clears it. New keys exist only in the open form until saved and are not stored in browser drafts. Saving a connection does not enable paid requests, set price estimates or change a project's model. Paid API permission and budgets remain in Workspace controls.

## Ollama and other local models

Open **Ollama → Configure connection**. Its setup box includes installation instructions, the current model's download command and small-model examples. Models under **Installed / served models** were detected from your running server. Other examples are suggestions to install, not claims that they are already present.

1. Install [Ollama](https://ollama.com/download) for your OS, or use Workroom's existing setup script after saving the desired model ID:

   ```bash
   npm run setup:local
   ```

2. Start Ollama if its service is not already running:

   ```bash
   ollama serve
   ```

3. Download the exact tag you want, for example:

   ```bash
   ollama pull qwen3:4b
   ```

4. Set its exact model ID and server URL (normally `http://127.0.0.1:11434`), save, and check connections. To use it for an existing project, explicitly change that project's connection.

The previously requested default, `huihui_ai/qwen3.5-abliterated:4B`, remains available as the default configuration. Examples also include `qwen3:4b`, `gemma3:4b` and `llama3.2:3b`; their availability, licensing and hardware requirements belong to their publishers. Selecting an example ID does not download weights. On a computer with roughly 16 GB RAM, start with one small model and one active task; measure speed and useful output quality on your machine.

For LM Studio or llama.cpp, open **OpenAI-compatible model → Configure connection**. The page explains loading a model, starting its API server, selecting Local billing and entering the exact served model ID. Common URLs are `http://127.0.0.1:1234/v1` for LM Studio and `http://127.0.0.1:8080/v1` for a llama.cpp server started on port 8080. Local text connections do not gain file or command tools merely by assigning a coding role.

## Saving settings without configuration conflicts

**Save connection** writes only that provider's allowed fields into the server's `.env`, preserving unrelated settings and comments. Duplicate assignments for edited keys are consolidated. Saves use a file revision check and an atomic replacement, and are serialized across Workroom processes. Conflicting changes made in another tab or editor are rejected with the form retained. For Codex, **Reset sign-in** also reloads saved form settings. Other provider forms use **Reload settings**. Review conflicts before discarding unsaved inputs.

Normal UI saves apply to the running server immediately, so restarting is not normally necessary. If you edit `.env` manually, restart Workroom to load those edits. Shell-exported variables can override `.env` at the next startup; the page identifies mismatches with the running server when detectable. Keep keys in the ignored `.env`, not in briefs, Git commits or screenshots. Official Codex credentials stay in the CLI's normal credential storage, not in Workroom's `.env`.

Pause running projects and wait for workers to stop before changing credentials or accounts. Workroom holds new model work while settings or sign-in are changing. Provider defaults and the selected connection for each existing project remain separate.

## Edit the current project

On **Task board** (or any project view), click the current project's title and pencil icon. Edit the name and brief, add an optional explanation, then **Save project**. Closing keeps a browser draft; you can also download the edited brief. A stale draft cannot silently overwrite a newer project version.

Previous briefs are retained under **Previous project versions** and in backups. Project ID, tasks, outputs, model choice and managed source folder are preserved. Earlier outputs are flagged when the brief has changed; saving a brief does not regenerate the plan or certify old results against a new goal. Use the editor's **Edit tasks & dependencies**, **Change this project's model** and **Manage project team** buttons for those changes. Pause the project before saving while agents are working.
