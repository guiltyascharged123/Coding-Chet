# Run your saved office on Ubuntu or Windows

> **Local-first update:** Start with [the current local model/provider guide](LOCAL-MODELS.md). `npm run local` now sets up Ollama and the selected default model when needed; normal startup cannot run simulated work. Existing providers/projects are retained. New AI plans use the model; manual recovery starts empty. See that guide for current provider setup.

For a guided first project and ChatGPT/Codex sign-in, start with the
[easy guide](EASY-GUIDE.md). This page covers installation and migration in more detail.

The same browser app runs on both systems. Node.js runs the local server; SQLite
saves work on disk. A Python/desktop rewrite is unnecessary. Internet is needed
for installation and hosted models. After preparation, local inference runs
on your computer without Codespaces.

## First start

1. Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org), reopen your
   terminal (PowerShell on Windows), and check `node --version` reports v24 or newer.
2. For a fresh clone, with Git installed:

   ```bash
   git clone --branch workroom-starter https://github.com/guiltyascharged123/Coding-Chet.git
   cd Coding-Chet
   npm run local
   ```

   For an existing checkout, stop the old app and use:

   ```bash
   git pull --ff-only origin workroom-starter
   npm run local
   ```

3. The first run installs/builds automatically, then opens a browser or prints its
   address. Keep the terminal open. **Ctrl+C** stops it. Later starts need only
   `npm run local`.

If PowerShell blocks `npm.ps1`, use `npm.cmd run local` or Command Prompt; no
execution-policy change is necessary. A downloaded GitHub branch ZIP also works.

## Ports and saved data

`npm run local` opens port **3001** and `.data/workroom.sqlite` by default. `PORT` and `DATABASE_PATH` in `.env` select alternatives. The first local start configures Ollama and downloads the chosen missing model; existing provider choices and `.env` are retained. No model connection failure causes a simulation fallback.

The old `npm run demo` command is now a compatibility alias for the real workspace. If only the older `.data/demo.sqlite` exists, its records open automatically in real-model mode. If both databases exist, the current workspace takes precedence; import the older backup or deliberately set `DATABASE_PATH=.data/demo.sqlite` to open it. Legacy simulation projects need a real project connection before execution.

Use the address printed by the server. Codespaces now forwards **3001** by default and skips automatic cloud model installation; configure an available connection there. It cannot reach a laptop's Ollama through its own localhost.

## Bring existing work home from Codespaces

1. Update/restart your existing Codespaces app to get backup controls. Open the
   workspace containing the work you want to move.
2. Pause running projects, then **Workspace controls → Backup & restore → Download
   workspace backup**. Save the JSON file to your computer.
3. Start the laptop copy with `npm run local`. In the same controls, select the
   JSON file, acknowledge replacement of current content, and click **Restore**.
4. Check projects/documents/memory. Configure your model locally. Credentials and
   model weights do not move. Paid API calls are off after restore.
5. Once the local copy is verified, stop Codespaces to avoid continued compute
   usage. Retained Codespaces also consume storage allowance.

Backups contain projects, role/desk/goal settings, documents, review decisions,
memory, limits and request receipts. Restore validates first, writes a recovery
snapshot under `.data/backups`, retains existing receipts and clears cached answers.
Imported in-flight work is paused/failed for review. Recovery snapshots use the
same restore controls. Restore replaces content; it is not a merge. Backups contain
private project data. Don't copy an actively written SQLite file alone: its WAL
may contain new work.

Older workspaces migrate in place with a recovery snapshot before upgrade. Existing
plans and outputs stay intact. Historical requests from versions without a ledger
cannot be reconstructed or retroactively tracked.

## Your hardware and a useful first run

With about 16 GB RAM, i7-1185G7 and integrated Intel Xe, start with one quantized
3–4B instruct model through Ollama or another local server. Leave the single-task
default. A 7–8B quantized model may fit but will be slower; measure before buying
hardware. Pause office movement if you want less graphics load while generating.
No local speed/quality claim has been verified on your particular computer.

Alternatively connect Codex using your ChatGPT account's Codex allowance. It needs
local CLI sign-in, not a ChatGPT password pasted into Workroom. The
[connection guide](AI-CONNECTIONS.md) explains setup and limits. Models share the
same role/goal workflow, so changing models doesn't require rebuilding the office.

Try this brief: “Plan a small team's office move in six weeks. Budget ceiling
$5,000 USD. Identify missing quotes and approvals; don't invent confirmed dates,
purchases or completed work.” Select Office & project coordination, choose a real model using the project’s Model → Change control, edit the plan, run, then inspect the requested results and their acceptance evidence. Routine work proceeds without a mandatory review; material choices and explicit approval gates wait for you. Save verified constraints in Project memory. Its value depends on accuracy and time saved drafting/coordinating.

## Verification boundaries

Linux unit/build/browser checks cover documents, movement, approvals, backups,
limits, memory and mocked model protocols. CI runs unit/build checks on Ubuntu and
Windows; Windows execution isn't locally verified from this Linux environment.
Native Codex account use/restrictions, local-model speed and live billing must be
checked with your own account/hardware. WSL2 is an option if native Windows Codex
CLI restrictions cause trouble.

## Software delivery projects

Choose Software delivery, connect Codex and use Check connections to verify Coding tools readiness. Use Ubuntu in WSL2 for software delivery if Windows native sandbox checks fail. All roles share a managed folder under `.data/projects/<title>-<id>/` by default. Outputs shows its exact local path and source files. Keep the server and generated project on the same filesystem; large/generated dependency folders are accessed locally, not through the browser file export.

Copy managed source folders separately from JSON workspace backups, with workers stopped. JSON restores preserve records but never roll back source files. The source ZIP omits hidden/dependency files; a full local folder copy preserves those too.
