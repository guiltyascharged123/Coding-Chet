# Workroom: easy start guide

Use this guide to run Workroom, try a project, and optionally connect your ChatGPT
account through Codex. Start with Demo if you just want to look around.

Already running? Jump to [Connect ChatGPT/Codex](#4-connect-your-chatgpt-account-through-codex)
or [Account access and costs](#5-understand-account-access-and-costs).

## 1. Understand what you have

You have the **full current open-source version**, which is still an early
prototype. Demo is a connection setting inside the app, not a separate edition.

- **Demo runtime:** scripted tasks and labeled template documents; no AI model calls.
- **Office/research/custom teams with a model:** real work from each role, using its assignment, the brief, handoffs and verified memory. These connections generate text.
- **Software delivery with Codex:** real file editing, shell commands, code review and testing in a shared managed project folder. Check **Model connections → Coding tools** for readiness.

The walking characters visualize activity. Their movement does not itself perform work. Each role is a separate assignment to the selected model, with a shared project and distinct responsibilities. There are four desks; team presets change those roles. This is a bounded task workflow, not an indefinitely self-starting agent.

## 2. Start Workroom on your computer

Install **Node.js 24 or newer** from [nodejs.org](https://nodejs.org) if needed.
Reopen your terminal after installing it. Check with:

```bash
node --version
```

If you already have Workroom, open a terminal in your **Coding-Chet project folder**
and run:

```bash
npm run local
```

The first start installs dependencies and builds the app automatically. It opens
your browser or prints the address to open. Keep that terminal running while you
use Workroom. Press **Ctrl+C** in it to stop the app. Next time, use the same command.

If you need a fresh copy, install Git and run:

```bash
git clone --branch workroom-starter https://github.com/guiltyascharged123/Coding-Chet.git
cd Coding-Chet
npm run local
```

**Windows:** use the same commands in PowerShell or Command Prompt. If PowerShell
blocks `npm.ps1`, use `npm.cmd run local`. Likewise, use `npx.cmd` instead of `npx`
for the Codex commands below if PowerShell blocks that script.

| Command         | Default port | Where work is saved     |
| --------------- | ------------ | ----------------------- |
| `npm run local` | 3001         | `.data/workroom.sqlite` |
| `npm run demo`  | 3000         | `.data/demo.sqlite`     |

Both commands launch the same app, with **separate saved workspaces**. New installs
start with an empty workspace and Demo selected. The demo launcher includes an explicit sample project and selects Demo again on every restart; the local
launcher retains a configured default connection. You can choose a real connection
in either workspace. Always use the actual address printed in your terminal.

To change ports, edit `PORT` in `.env` for local mode or `WORKROOM_DEMO_PORT` for
the demo launcher, then restart. For moving projects between these workspaces or
from Codespaces, see [backup and migration](LOCAL-SETUP.md#bring-existing-work-home-from-codespaces).

## 3. Try your first project

1. Click **New project** and give it a name and brief. For example:

   > Plan a small team's office move in six weeks. Budget ceiling $5,000 USD.
   > Identify missing quotes and approvals. Do not invent confirmed dates,
   > purchases, or completed work.

2. Choose **Office & project coordination** and **Editable task template**. Creating a template makes no model call.
3. Click **Create project**, then **Edit plan**. Adjust assignments and acceptance criteria, choose owners, add/remove tasks, and set dependencies and human approval gates. There is no fixed number of steps. The default task ceiling is 30, adjustable under Workspace controls; older custom limits are retained.
4. Select a real model connection for this project under **Workspace controls → Limits & connections**. Click **Run team**. Demo only previews assignments; it does not do real work.
5. When **Review work** appears, read the proposal. Approve it or request a revision. Dependent tasks wait for your decision.
6. Open **Outputs** to inspect results and download useful reports as Word, Excel, Markdown, or Print / PDF. The team should create only material serving your goal, not a standard pile of unnecessary documents.

**Your writing is saved.** Unsubmitted briefs are retained in this browser when you close the dialog or reload. Once created, the project and original brief are saved on the server before AI planning begins. Expand **Saved project brief** to read or download it. AI planning runs in the background; a failure shows **Retry planning**, **Use editable template**, and **Review usage**. If usage is uncertain, review and acknowledge its receipt before another model attempt. No automatic paid fallback occurs. A same-submission retry does not create a duplicate project.

For a failed task, click **See task** or its task-board card, read its report and actual tool activity, add direction if useful, then **Retry task**. A blocked software task retains its report and files. A retry resumes from those files; cancellation does not undo changes. Add follow-up tasks with **Edit plan**, even after a project finishes.

**Software project:** choose **Software delivery** and connect Codex. The lead proposes scope using read-only source access, then waits for your approval. The engineer implements files, the code reviewer inspects/fixes them, and the test engineer runs checks. The team can iterate within an assignment for up to 15 minutes. A blocked result pauses the project. Open **Outputs → Project files** to inspect files, see the exact local folder, or download source ZIP.

Folders live in `.data/projects/<readable-project-name>-<unique-id>/` beside the active database. Identically named projects get different folders. All roles on one software project share that folder; software tasks run serially to avoid simultaneous file edits. **Edit plan → Allow tool network** enables dependency downloads for that project; it starts off. Without it, missing dependencies may block work. Inspection tasks can execute read-only checks but cannot write project source files; their scratch folder is writable.

The **Server connected** indicator reports the browser's connection to Workroom. Click it for model connection status. It does not mean an AI is running. **Pause office movement** pauses animation; **Pause team** stops work.

Old demo projects and six-document packs remain available with their original outputs. They are not imposed on new projects. Briefs lost by the old failed-planning bug were never saved and cannot be recovered by updating.

### Team discussions, specialists and reasoning

Open **Team discussions** to start a meeting with your own agenda. Each of the four specialists makes a public proposal or critique, then the chair writes a decision record with objections, evidence gaps, owners and next actions. Contributions appear as they finish and remain saved after reload. Upcoming tasks receive recent completed meeting decisions as context. These are requested public contributions, not a display of private model reasoning.

For automatic meetings, open **Edit plan**, enable **Automatic team meetings**, set the number of completed tasks between meetings, and **Save plan**. They run at kickoff and progress milestones when more work is ready. The queue waits during a meeting. A completed or paused project does not hold recurring meetings. New projects created in the dashboard offer this setting enabled; older projects retain their configuration until you change it. External workers do not use this built-in meeting protocol.

Each meeting adds **up to five model requests** (four contributions and a chair summary). Your existing request, concurrency and API budget controls apply. A failed meeting keeps completed contributions; review uncertain Usage, then **Retry remaining contributions**, or explicitly **Skip meeting**. Stop a running meeting from its discussion card or pause the team. Closing the page does not stop the server's work.

Characters now travel for assignments, reviews, handoffs and saved meetings. They stay at their desks during focused work and idle time. The glass meeting room shows the current speaker and listeners; the transcript carries the actual collaboration. Pausing office movement affects animation only.

**Edit plan → Codex reasoning effort** offers Economy (low), Balanced (medium, the new default), and Deep work (high). High can improve difficult work and use more allowance; choose an effort supported by your model. These settings do not change a non-Codex provider's reasoning configuration. Use **Your team → Edit role & desk → Specialist preset** for software engineering, architecture, project management, coordination, independent code review, testing, market research, commercial strategy, finance/risk, or product/UX. There are four active seats; presets supply role-specific goals and instructions, not separate trained models.

For broad money-making goals, choose **Venture & opportunity validation**. The team compares distinct approaches, identifies a buyer/problem and distribution route, challenges AI substitutes and weak differentiation, checks estimated economics, and proposes a low-cost test with go/stop criteria. Supply your budget, skills/assets, available time and success measures in the brief or verified project memory. Market demand and income cannot be assumed or guaranteed by stronger prompts.

**Allow Codex web research** enables built-in, read-only search for text tasks. Searches appear in task details; reports should cite direct URLs and dates and identify uncertainty. It starts off. Meetings use supplied context; they do not browse independently. Software command-network access is a separate setting. Other providers remain text-only. Live research depends on the Codex account/model; failures retain reports/usage and do not switch to a paid API.

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

Restart the workspace you were using (`npm run local` normally). If you were using
`npm run demo`, use that command again to keep the same saved workspace.

In Workroom:

1. Open **Runtime settings** by clicking the runtime card near the bottom of the
   sidebar; initially it says **Demo runtime**.
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

This signs the local Codex CLI out too. Restart Workroom and select Demo for any
project you want to keep testing. Projects retain their chosen connection until
you explicitly change it.

## 6. Update and troubleshoot

For a Git checkout, stop Workroom, then run from the project folder:

```bash
git pull --ff-only origin workroom-starter
npm run local
```

Use `npm run demo` instead if that is where your saved work lives. Refresh the
browser after restarting. For an existing Codespace's background demo, use
`npm run codespace:restart` after the pull instead of starting a second server.

| What you see                                    | What to check                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page will not load or Codespaces returns 502    | Keep the server running and use its printed port. In Codespaces, forward that actual port.                                                                                                  |
| `Missing script: local`                         | Check that you are in the Coding-Chet folder and have the current `workroom-starter` source.                                                                                                |
| `Unexpected token {` at the launcher's `import` | This terminal may be using old Node.js. Check `node --version`; Workroom requires 24+. If you use nvm, run `nvm install 24`, `nvm use 24`, and `nvm alias default 24`.                      |
| Projects seem to have disappeared               | Check whether you switched between `local` and `demo`; they use separate databases. Use backup/restore to move work.                                                                        |
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

If a request is marked uncertain, review and acknowledge it in **Workspace controls → Usage** before another model attempt. Open a failed task and choose **Retry task**; for a saved planning failure choose **Retry planning** or **Use editable template**. Older builds could fail before saving any project; updating cannot recover a brief that was never saved. Successful sign-in alone does not confirm model access or available quota.

For local models, API providers, or external workers, see the
[AI connection reference](AI-CONNECTIONS.md). For installation, backups, and moving
off Codespaces, see the [local setup reference](LOCAL-SETUP.md).

## Back up both records and source

**Workspace controls → Backup & restore** exports briefs, plans, roles, results, approvals, verified memory and usage receipts. That JSON does **not** contain managed source files. Copy `.data/projects/` separately (with the team stopped), or download each project's source ZIP. ZIP downloads omit hidden files, dependency folders, symlinks and private-key extensions; use a full local folder copy when you need everything. Browser exports are limited to 2,000 files and 25 MB. Restoring records never rolls back source-file changes.
