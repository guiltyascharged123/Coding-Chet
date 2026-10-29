# Workroom: easy start guide

## 1. Understand what you have

Workroom is an early open-source agent workspace. Each role sends assignments to the project's selected model, with its brief, saved work and instructions. The 3D office visualizes real task and meeting state. An idle or moving avatar does not by itself mean inference is happening.

The default is a local Ollama model: **huihui_ai/qwen3.5-abliterated:4B**. Local text agents can plan, analyze and draft from supplied evidence. Codex can additionally edit files and execute commands after its sandbox readiness check. Normal workspaces cannot run simulated assignments or silently fall back to Demo.

## 2. Start Workroom on your computer

Install Node.js 24 LTS, open a terminal in Coding-Chet, and run:

```bash
npm run local
```

First startup installs app dependencies, builds the browser interface, creates `.env` if missing, installs/starts Ollama if needed, and downloads the selected model. The OS installer may ask for normal administrator permission; the model download needs internet and several GB of disk. Existing settings and saved provider choices are preserved. See [local model setup](LOCAL-MODELS.md) for installation problems, exact tags and alternative providers.

Open the printed URL, normally **http://127.0.0.1:3001**. Keep the terminal open; Ctrl+C stops Workroom. Ollama may continue running in the background. Windows uses the same command; if PowerShell blocks npm scripts, use `npm.cmd run local`.

Your data is in `.data/workroom.sqlite`, unless `DATABASE_PATH` selects another database. If only the older `.data/demo.sqlite` exists, its saved records open automatically. If both databases exist, import the older backup or select its DATABASE_PATH deliberately. The old demo command now opens the real workspace. Existing simulation records remain readable but require a real project connection before execution.

Already running? [Connect a model](LOCAL-MODELS.md), [connect ChatGPT/Codex](#4-connect-your-chatgpt-account-through-codex), or [review account access and costs](#5-understand-account-access-and-costs).

## 3. Try your first project

1. Click **New project** and give it a name and brief. For example:

   > Plan a small team's office move in six weeks. Budget ceiling $5,000 USD.
   > Identify missing quotes and approvals. Do not invent confirmed dates,
   > purchases, or completed work.

2. Choose **Office & project coordination**. With a real connection, **AI plan tailored to the brief** is selected by default and uses one model request. Choose **Write my own tasks** for an empty manual plan instead.
3. Click **Create project**, then **Edit plan**. Adjust assignments and acceptance criteria, choose owners, add/remove tasks, and set dependencies and human approval gates. There is no fixed number of steps. The default task ceiling is 30, adjustable under Workspace controls; older custom limits are retained.
4. Click **Model: … · Change** under the project brief. Select its connection and exact **Project model ID**, then **Set project connection**. Pause first when changing an active project. Click **Run team**. If a model is unavailable, setup must be completed before work can run.
5. Let routine planning, internal checks and specialist follow-ups proceed. When **Review work** appears for a model decision, read its specific question, why your answer is necessary, and the options. Choose or add direction. The agent resumes the unfinished task with your answer. Explicit approval gates you put in the plan still pause for review.
6. Open **Outputs** to inspect results and download useful reports as Word, Excel, Markdown, or Print / PDF. The team should create only material serving your goal, not a standard pile of unnecessary documents.

**Your writing is saved.** Unsubmitted briefs are retained in this browser when you close the dialog or reload. Once created, the project and original brief are saved on the server before AI planning begins. Expand **Saved project brief** to read or download it. AI planning runs in the background; a failure shows **Retry planning**, **Create tasks manually**, and **Review usage**. If usage is uncertain, review and acknowledge its receipt before another model attempt. No automatic paid fallback occurs. A same-submission retry does not create a duplicate project.

For a failed task, click **See task** or its task-board card, read its report and actual tool activity, add direction if useful, then **Retry task**. A blocked software task retains its report and files. A retry resumes from those files; cancellation does not undo changes. Add follow-up tasks with **Edit plan**, even after a project finishes.

**Software project:** choose **Software delivery** and connect Codex. The lead inspects scope using read-only source access, then implementation proceeds within the brief unless a real decision or an explicit approval gate requires you. The engineer implements files, the code reviewer inspects/fixes them, and the test engineer runs checks. The team can iterate within an assignment for up to 15 minutes. A blocked result pauses the project. Open **Outputs → Project files** to inspect files, see the exact local folder, or download source ZIP.

Folders live in `.data/projects/<readable-project-name>-<unique-id>/` beside the active database. Identically named projects get different folders. All roles on one software project share that folder; software tasks run serially to avoid simultaneous file edits. **Edit plan → Allow tool network** enables dependency downloads for that project; it starts off. Without it, missing dependencies may block work. Inspection tasks can execute read-only checks but cannot write project source files; their scratch folder is writable.

The **Server connected** indicator reports the browser's connection to Workroom. Click it for model connection status. It does not mean an AI is running. **Pause office movement** pauses animation; **Pause team** stops work.

Old demo projects and six-document packs remain available with their original outputs. They are not imposed on new projects. Briefs lost by the old failed-planning bug were never saved and cannot be recovered by updating.

### Useful work, evidence and recovery

Text responses and native Codex workers now return a checked work record: a plain-language result, the actual deliverable, acceptance checks with evidence, known facts, assumptions and a concrete next step. Open a task to see **Reported result**, outstanding checks and **Context used**. A schema check cannot certify that a model is right: read the evidence, independent reviews and actual tool receipts. **View results** becomes available when the planned tasks finished, not that customers paid, a product deployed, or a real-world goal was achieved.

Agents can request up to three focused internal specialist assignments before resuming their original task. These use the same project/model, permissions and cost controls; the parent waits for their results. Internal coordination rounds use the per-task revision limit (default one), and added assignments respect the project task ceiling. Failed checks or missing capabilities are saved as blockers rather than silently accepted as completed work.

Workroom fits accumulated teammate outputs, meeting decisions and verified memory into the configured input byte budget. Full saved sources remain intact. Labeled excerpts carry source IDs; text workers can request missing passages in at most two additional model requests. Software workers can inspect temporary copies of full saved evidence in their managed folder. The brief, assignment, retry direction and approved team instructions are not silently shortened. If those required instructions alone cannot fit, the task reports the minimum needed input size.

A malformed text response gets at most one automatic format correction. Corrections and retrieval requests count toward your request/usage limits. Network errors, unknown usage, exhausted budgets and unavailable tools are not automatically retried or switched to another paid connection.

**If you see “did not return a usable, checked work result”:** update and restart Workroom, then open the saved task and choose **Retry task**. You do not need to recreate the project. Codex document workers now use a structured response schema, and corrections receive the rejected reply along with the exact validation issues. Concise results and omitted empty optional lists are accepted; missing evidence, unresolved decisions and failed checks still prevent completion. If it happens again, open **Response needs correction · saved details**, then **Show rejected reply**, or the task's **Live console**. These show the specific problem instead of assuming your model is too weak. Previously failed replies can only be found in retained console history; the new task details apply to new attempts.

If the error specifically says **output token limit**, use **Workspace controls → Maximum output tokens (API/local)** to allow a longer response within your budget, or ask for a smaller deliverable. Workroom saves the partial reply and confirmed usage; it does not automatically repeat or cache a truncated response. Codex subscription workers use their own native output limits, rather than this API/local setting.

Agents sit in their assigned chairs when they are at their desks, type while a task is running, and stand to travel for real meetings, handoffs or review. An agent sitting quietly between tasks is not making model requests.

**For the old “Input exceeds the configured context limit” failure:** update Workroom, restart it, open the saved failed task and click **Retry task**. You should not need to rewrite the project or paste all previous work. Workroom now selects the supporting context. Only unusually long required instructions or a deliberately tiny input limit still need a settings change.

### Let any Codex team build useful files

A venture, research or office project can need implementation too. Pause it, click **Model: … · Change**, choose Codex, check **Enable managed project tools**, then **Set project connection**. All four roles share a managed project folder. Open **Outputs → Project files** for actual files and a source ZIP. Disabling tools retains those files. Software delivery uses these tools automatically.

The native coding sandbox must pass its offline check; otherwise work stops with the readiness message. File/command tools remain limited to the managed project and allowed system tooling. **Edit plan → Allow tool network** controls dependency downloads and network access by executed code. **Allow Codex web research** independently permits built-in read-only searches with cited sources, including for tool-enabled projects. Meetings do not browse or edit files. OpenAI, Gemini, Ollama and compatible text adapters do not acquire file tools from a role name.

### Improve project instructions with review

Open **Workspace controls → Team instructions**. Write clear working rules and a reason, then **Save instruction version** while paused. Each later model assignment receives the latest version. Agents may propose improvements with the observed problem, evidence and suggested wording. **Load proposal for editing** lets you inspect it; it is applied only when you save a new version. Load an earlier version and save it to roll back.

These are versioned project directions, not model training or unrestricted self-modifying software. They cannot grant tool permissions, authorize spending, change authentication or update Workroom code. Instructions, proposals and history travel with the JSON backup; source files still need a separate source ZIP or folder copy.

### Team discussions, specialists and reasoning

Open **Team discussions** to start a meeting with your own agenda. Each of the four specialists makes a public proposal or critique, then the chair writes a decision record with objections, evidence gaps, owners and next actions. Contributions appear as they finish and remain saved after reload. Upcoming tasks receive recent completed meeting decisions as context. These are requested public contributions, not a display of private model reasoning.

For automatic meetings, open **Edit plan**, enable **Automatic team meetings**, set the number of completed tasks between meetings, and **Save plan**. They run at kickoff and progress milestones when more work is ready. The queue waits during a meeting. A completed or paused project does not hold recurring meetings. New projects created in the dashboard offer this setting enabled; older projects retain their configuration until you change it. External workers do not use this built-in meeting protocol.

A normal meeting adds **five model requests** (four contributions and a chair summary). A malformed response can add one correction request for that turn, so the absolute maximum is ten; limits can stop it earlier. Your existing request, concurrency and API budget controls apply. A failed meeting keeps completed contributions; review uncertain Usage, then **Retry remaining contributions**, or explicitly **Skip meeting**. Stop a running meeting from its discussion card or pause the team. Closing the page does not stop the server's work.

Characters now travel for assignments, reviews, handoffs and saved meetings. They stay at their desks during focused work and idle time. The glass meeting room shows the current speaker and listeners; the transcript carries the actual collaboration. Pausing office movement affects animation only.

**Edit plan → Codex reasoning effort** offers Economy (low), Balanced (medium, the new default), and Deep work (high). High can improve difficult work and use more allowance; choose an effort supported by your model. These settings do not change a non-Codex provider's reasoning configuration. Use **Your team → Edit role & desk → Specialist preset** for software engineering, architecture, project management, coordination, independent code review, testing, market research, commercial strategy, finance/risk, or product/UX. There are four active seats; presets supply role-specific goals and instructions, not separate trained models.

For broad money-making goals, choose **Venture & opportunity validation**. The team compares distinct approaches, identifies a buyer/problem and distribution route, challenges AI substitutes and weak differentiation, checks estimated economics, and proposes a low-cost test with go/stop criteria. Supply your budget, skills/assets, available time and success measures in the brief or verified project memory. Market demand and income cannot be assumed or guaranteed by stronger prompts.

**Allow Codex web research** enables built-in, read-only search for tasks, including tool-enabled projects. Searches appear in task details; reports should cite direct URLs and dates and identify uncertainty. It starts off. Meetings use supplied context; they do not browse independently. Command-network access is a separate setting. Other providers remain text-only. Live research depends on the Codex account/model; failures retain reports/usage and do not switch to a paid API.

### Feedback and memory drafts

Review feedback, retry direction, meeting agendas, task-plan edits and memory drafts are saved **as you type in this browser**. Closing dialogs, opening settings, and reloading preserve them. A failed submission keeps the draft; a confirmed successful submission clears it. If feedback hits the revision limit, **Open Workspace controls · keep feedback** leads to limits, and reopening Review restores the text. Plan drafts can be explicitly discarded to reload the server's saved plan.

Drafts stay in this browser/origin and are not portable workspace backups. If browser storage is blocked or full, a warning appears when saving. A memory draft is not automatically a fact: **Propose memory**, check the evidence, then **Verify memory** before agents use it.

## 4. Connect your ChatGPT account through Codex

Your ChatGPT account must include Codex access. Workroom uses the official Codex
SDK and its bundled command-line app. You do not need to install a separate global
copy or buy an API key for this connection. Codex runs the model in the cloud,
so your laptop does not need to load a large model.

### Sign in

Stop Workroom with **Ctrl+C**. In the same project folder, run:

```bash
npx --no-install codex login
npx --no-install codex login status
```

Follow the browser sign-in using your ChatGPT account, rather than an API key.
The status should say you are logged in using **ChatGPT**. Use the same computer
and operating-system account that runs Workroom.

### Choose a model

Run:

```bash
npx --no-install codex
```

Enter `/model`, choose a model your account offers, and note its **exact model ID**.
Then enter `/quit`. Do not send a task yet if you only want to configure the connection.

On Ubuntu, you can print the selected model setting with:

```bash
grep -m1 '^model[[:space:]]*=' "$HOME/.codex/config.toml"
```

Use the value between the quotes. On Windows, you can open
`%USERPROFILE%\.codex\config.toml` in your text editor and find the `model` setting.

### Tell Workroom to use it

For an already configured connection, pause the project and use **Model: … · Change → Project model ID**. You can select a different exact model for each project without editing `.env`. The environment setting below remains the default for new projects; saving a model ID does not verify account access.

Open the `.env` file in the project folder. If it does not exist, make a copy of
`.env.example` and name the copy `.env`. Keep any existing settings.

On Ubuntu, these commands create the file only if missing and open it for editing:

```bash
[ -f .env ] || cp .env.example .env
nano .env
```

Add or update these two lines. Replace the placeholder with your model ID; remove
any leading `#` from these lines so the settings are active:

```dotenv
WORKROOM_CODEX_ENABLED=1
WORKROOM_CODEX_MODEL=REPLACE_WITH_YOUR_MODEL_ID
```

In Nano, save with **Ctrl+O**, press **Enter**, and exit with **Ctrl+X**. On Windows,
you can edit `.env` with your usual text editor; make sure it is not named `.env.txt`.

Restart with `npm run local`. If work lives in an older separate `.data/demo.sqlite`, import its backup or explicitly select that DATABASE_PATH.

In Workroom:

1. Open **Runtime settings** by clicking the runtime card near the bottom of the
   sidebar; it shows the selected default provider.
2. Click **Check connections**, then select **Codex · ChatGPT sign-in**.
3. Create a **new project** and follow the first-project steps above.

The default connection affects **new projects**. To change an existing one, pause
it, open **Workspace controls → Limits & connections**, choose Codex under
**Project connection**, and click **Set project connection**. This keeps its task
plan and existing documents.

## 5. Understand account access and costs

**Sign in only through the official OpenAI page opened by Codex.** Workroom does
not ask you to paste a ChatGPT password, browser cookies, or login tokens into the
app or `.env`.

Codex manages the saved login. Workroom launches it under your computer's user
account, so you are trusting Workroom and its dependencies with use of that
authenticated session. Project briefs and supplied context go to OpenAI for Codex
assignments. Workroom does not import your existing ChatGPT conversations.

Codex jobs consume your account's allowance and may involve several model turns.
Workroom cannot show your remaining subscription allowance. **Leave “Enable
separately billed API requests” unchecked** for this setup: it is not needed for
Codex. There is no automatic paid API fallback. Workroom's API dollar limits do
not govern Codex account usage. Keep the single-task default and start with one
small project while checking your account's usage. The paid-API checkbox is under
**Workspace controls → Limits & connections**.

**Keep the dashboard private.** It has no dashboard login. `npm run local` binds
to your computer; do not expose it through a public tunnel or public forwarded
port. Text workflows disable file and command execution; opted-in Codex research permits read-only web search. Software delivery allows file changes and commands in its managed folder, with read access to system tooling. Commands and dependency scripts can change or delete files inside that folder; keep copies of valuable work. Tool network is enabled only if you choose it in Edit plan. Keep credentials out of managed project folders.

The coding readiness check executes a tiny offline command, verifies a project write and denial of a sibling probe file, and makes no model call. Coding stays unavailable if it fails; there is no unrestricted fallback. That check is not a security audit or proof of model quality. It also does not verify generation access or remaining quota. For software delivery on Windows, use Ubuntu in WSL2 if native sandbox checks fail.

### Disconnect Codex

Stop Workroom and change this setting in `.env`:

```dotenv
WORKROOM_CODEX_ENABLED=0
```

From the project folder, run:

```bash
npx --no-install codex logout
```

This signs the local Codex CLI out too. Restart Workroom and select a configured Ollama model for local work. Projects retain their chosen connection until
you explicitly change it.

## 6. Update and troubleshoot

For a Git checkout, stop Workroom, then run from the project folder:

```bash
git pull --ff-only origin workroom-starter
npm run local
```

For a legacy separate database, set DATABASE_PATH explicitly or import a backup. Refresh the browser after restarting. For a Codespace's background workspace, use
`npm run codespace:restart` after the pull instead of starting a second server.

| What you see                                    | What to check                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page will not load or Codespaces returns 502    | Keep the server running and use its printed port. In Codespaces, forward that actual port.                                                                                                  |
| `Missing script: local`                         | Check that you are in the Coding-Chet folder and have the current `workroom-starter` source.                                                                                                |
| `Unexpected token {` at the launcher's `import` | This terminal may be using old Node.js. Check `node --version`; Workroom requires 24+. If you use nvm, run `nvm install 24`, `nvm use 24`, and `nvm alias default 24`.                      |
| Projects seem to have disappeared               | Check DATABASE_PATH and the active project. Earlier releases had a separate demo.sqlite; use backup/restore to move its records.                                                            |
| Codex option is unavailable                     | Run `npx --no-install codex login status`, check the two active `.env` settings and exact model ID, restart, then check connections again.                                                  |
| Existing project still says Demo                | Change that project's connection in Workspace controls, or create a new project after selecting Codex.                                                                                      |
| No model activity after creating a starter plan | Click **Run team**. Creating the starter plan does not request AI generation.                                                                                                               |
| Team stops at a review                          | Open **Review work** and approve or revise the proposal.                                                                                                                                    |
| A job fails or usage is uncertain               | Read its error and **Workspace controls → Usage** before retrying. Acknowledging uncertain usage permits retry but retains the recorded usage; the earlier job may have consumed allowance. |

If you see the older message **“Codex could not finish. Check its sign-in, allowance,
and restricted worker configuration”**, update and restart Workroom first. An older
worker used an approval setting the bundled CLI rejects. The corrected worker keeps
its restrictions and displays specific error codes; see
[Codex job troubleshooting](AI-CONNECTIONS.md#troubleshoot-codex-jobs).

If a request is marked uncertain, review and acknowledge it in **Workspace controls → Usage** before another model attempt. Open a failed task and choose **Retry task**; for a saved planning failure choose **Retry planning** or **Create tasks manually**. Older builds could fail before saving any project; updating cannot recover a brief that was never saved. Successful sign-in alone does not confirm model access or available quota.

For local models, API providers, or external workers, see the
[AI connection reference](AI-CONNECTIONS.md). For installation, backups, and moving
off Codespaces, see the [local setup reference](LOCAL-SETUP.md).

## Back up both records and source

**Workspace controls → Backup & restore** exports briefs, plans, roles, results, approvals, verified memory and usage receipts. That JSON does **not** contain managed source files. Copy `.data/projects/` separately (with the team stopped), or download each project's source ZIP. ZIP downloads omit hidden files, dependency folders, symlinks and private-key extensions; use a full local folder copy when you need everything. Browser exports are limited to 2,000 files and 25 MB. Restoring records never rolls back source-file changes.

## Watch the agents work

Open **Live console** in the sidebar, or open a task and click **Open live console for this task**.

- Watch public Codex messages, command output and exit codes, file changes, searches, and completion/error events. Planning and meeting jobs appear too.
- Enable **Show instructions & context** to inspect the Workroom instructions and selected project data prepared for a request. SDK/provider protocol instructions and authentication headers are not displayed.
- Filter by agent, task or phase. **Raw replies** shows the original response text; readable mode extracts the useful deliverable from structured results. Disable **Follow new output** while reading earlier entries.
- **Copy visible log** or **Download visible log** exports the currently visible entries. Including instructions can include project details, so review a log before sharing it.

This is a read-only viewer. Opening it makes no additional model request and does not feed logs into the agents’ context. Codex events appear when the SDK emits them, rather than simulated typing. Some jobs send no public message until their final response. OpenAI, Gemini, Ollama and compatible text adapters currently show their reply at completion. A generic model-activity notice can appear during Codex processing; private reasoning text is never displayed. Use **Team discussions** for the agents’ deliberate public proposals and critiques.

Recent console history survives reloads and server restarts in the same SQLite database. Reconnecting reloads the retained history. Old runs from before this feature cannot be reconstructed. History is bounded per project and workspace, and large entries are labeled excerpts. Known credentials are redacted; arbitrary project secrets may still appear in text or command output. Portable JSON project backups do not include console history—download logs separately when needed.

Demo entries explicitly say that no AI ran. External workers show assignment status and submitted results; Workroom cannot see their internal terminal unless their protocol is extended.

## Saved history and interrupted tasks

Activity keeps older events: use **Load older activity**. This does not consume model tokens. For a task interrupted during a restart, open it and use **Recover saved result · no model call** if available. Review Usage and existing work before choosing Retry. After updating, stop the old Workroom terminal with Ctrl+C, then run `npm run local` again. See [Reliability and work evidence](STABILITY.md) for details.
