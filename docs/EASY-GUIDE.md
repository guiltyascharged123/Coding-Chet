# Workroom: easy start guide

Use this guide to run Workroom, try a project, and optionally connect your ChatGPT
account through Codex. Start with Demo if you just want to look around.

Already running? Jump to [Connect ChatGPT/Codex](#4-connect-your-chatgpt-account-through-codex)
or [Account access and costs](#5-understand-account-access-and-costs).

## 1. Understand what you have

You have the **full current open-source version**, which is still an early
prototype. Demo is a connection setting inside the app, not a separate edition.

- **Demo runtime:** scripted tasks and labeled template documents; no AI model calls.
- **Codex or another model connection:** real AI-generated documents and responses
  based on each agent's role, assignment, project brief, and supplied context.

The walking characters show activity in the office. Their movement does not itself
perform work. Built-in model connections draft documents; independent coding,
browsing, or other tools require a separately configured external worker.

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
start with Demo. The demo launcher selects Demo again on every restart; the local
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

2. Choose **Office document pack** and **Use the six-task starter plan**.
   Creating this plan makes no model call, even with Codex selected.
3. Click **Create project**, then **Run team**. With a model connection, this is
   when the agents start sending their assignments to it.
4. When **Review work** appears, read the proposal. Approve it or request a revision.
   Dependent tasks wait for your decision.
5. Open **Outputs** to read and download the brief, project plan, budget estimate,
   risk register, meeting template, and status report. Available formats include
   Word, Excel, Markdown, and the browser's Print / PDF option.

In Demo these are labeled samples. With a model, check its assumptions, totals,
and claims before using the documents. A meeting template does not mean a meeting
happened. **Pause office movement** pauses the animation; **Pause team** pauses work.

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
port. The document worker requests restricted permissions, but native sandbox
enforcement has not been verified on your computer. Workroom has not had an
independent security audit; use non-sensitive test projects first. A successful
connection check verifies sign-in, not an actual generation or remaining quota.

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

To retry an existing failed task, first acknowledge its uncertain attempt in
**Workspace controls → Usage**, then open the failed task and click **Retry task**.
If AI planning failed before a project was created, create the project again after
updating. Successful sign-in alone does not confirm model access or available quota.

For local models, API providers, or external workers, see the
[AI connection reference](AI-CONNECTIONS.md). For installation, backups, and moving
off Codespaces, see the [local setup reference](LOCAL-SETUP.md).
