# Reliability repairs from the November 1 audit

This pass fixes the twelve reproduced findings in the review of `b42ca4b`. Existing projects, results, model connections, offices and exports remain supported. No model connection is changed automatically, and no failed request falls back to a simulation or paid API.

## Update safely

Stop Workroom with Ctrl+C. Keep a stopped copy of `.data` if the saved work is valuable; a JSON backup does not contain source folders or console logs. Then run:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
npm run local
```

The launcher installs any required dependencies and builds the interface. Open its printed private browser link. Existing SQLite records migrate to schema 6, with a `before-upgrade` snapshot. Do not delete `.data` to repair a failed task.

The first connection from a browser uses a private code in that link's URL fragment. The launcher normally opens it automatically. If a bare localhost or Codespaces Ports link shows **Connect this browser**, paste the private link printed in the terminal. The page removes the fragment after pairing. This code is a Workroom browser credential, unrelated to ChatGPT sign-in. Keep the link private. `.data/browser-access-key` persists across server restarts; browser sessions expire and can be renewed with the link. Development on Vite uses the same pairing code. This remains a trusted, single-user application, not a public account system.

## What changed

| Audit                                           | Repair                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01: stale edits delete queued work             | Plans, teams, model/collaboration settings, instructions and economy limits have revision checks. A stale save keeps the browser draft and asks you to reload/merge. **Edit plan → Saved plan versions** retains original assignments and supports inspection/download. Model settings and instructions have independent revisions. Restoring a backup also invalidates open editor revisions, so an old tab cannot overwrite the restored state. |
| A02: renamed software folders fail              | The folder created for a project's immutable ID stays authoritative. Renaming changes the display title and retains files at their original path. Foreign project folders and unsafe paths remain rejected.                                                                                                                                                                                                                                       |
| A03: delegated tasks lose requirements          | Internal specialist tasks retain work type, read-only restrictions and acceptance criteria. Legacy follow-ups receive suitable minimum checks. Text-only workers cannot delegate their way into unavailable execution capabilities.                                                                                                                                                                                                               |
| A04: help output passes verification            | Help/version, listing, collection-only commands, zero-test runs and scratch-only changes cannot establish software completion. Relevant observed commands/file changes are still required. These receipts prove execution, not comprehensive correctness.                                                                                                                                                                                         |
| A05: a question blocks planning recovery        | Conversation jobs are distinct from the main plan. A failed planner can answer a question and then retry on the same saved brief.                                                                                                                                                                                                                                                                                                                 |
| A06: older directions/decisions vanish          | Every active standing direction remains required context until explicitly revoked or superseded. Selected approaches are retained; rejected decisions and older messages, ideas, tasks and meetings have searchable source IDs. **Project conversation → Active standing directions** shows what applies.                                                                                                                                         |
| A07: restart reuses the wrong dependency graph  | Reuse reconstructs the original plan, without execution-time specialist children or meeting checks that depended on the previous run. Original results, files and evidence stay in the old run. Document kinds are preserved.                                                                                                                                                                                                                     |
| A08: completed plans run forever                | Settings-only saves use the settings endpoint. Saving an all-done plan keeps it completed; adding real new work allows a new run.                                                                                                                                                                                                                                                                                                                 |
| A09: an old uncertain receipt is inaccessible   | **Workspace controls → Usage** filters unresolved/project receipts and loads older pages. Acknowledgement remains available for old blockers. Rolling totals use the full ledger, independent of the display window.                                                                                                                                                                                                                              |
| A10: unrelated work stops at a decision/meeting | Explicit dependencies control approval barriers. An independent ready task can continue while another awaits input. Meetings hold their own project's work; other projects can use spare concurrency. Coding jobs sharing a folder remain serialized.                                                                                                                                                                                             |
| A11: conversations/ideas hit hard storage caps  | Indexed SQLite journals replace the 100-per-project/500-per-workspace stop. Conversation and idea pages load older records; portable backups retain them. Browser updates contain recent records, not the whole journal.                                                                                                                                                                                                                          |
| A12: a local worker can obtain browser controls | Browser API reads and writes require a separately paired session; a fresh HTTP client cannot acquire one without the private browser capability. The capability is outside managed folders, explicitly denied in the coding permission profile, and not supplied to model workers. Mixed-case API routes receive the same access checks. The runner token remains a separate, restricted protocol.                                                |

## Real collaboration and delivery checks

A manual meeting can invite only relevant specialists. It normally costs `participants + 1` requests; automatic meetings include the full team. Only invited avatars enter the meeting room. The chair's actions are saved with owners and linked to existing queued assignments. Assigned actions become acceptance checks and are marked **Reported check met** only after the target task finishes with matching evidence. A proposed action without an applicable task remains visibly unassigned. A chair summary does not itself execute or complete actions.

New **Software delivery** projects distinguish **Working software** from **Design only**. A working-software plan must include implementation, independent review and executed verification downstream of each implementation, with the corresponding evidence criteria. Design-only work keeps file editing disabled. Legacy saved projects retain their existing delivery contract until explicitly changed.

Conversation replies waiting for internal specialist work show that dependency, its saved failure and a direct task link. Public requests, replies and tool receipts remain visible in Live console. Role labels and animations do not prove expertise; use the [model evaluation guide](MODEL-EVALUATION.md) to judge actual results.

## History is not the model's context window

Saving more than 1,000 events is reasonable. Activity, conversation, ideas, usage and plan history remain on disk. Loading older pages makes no model call. Browser windows and prompt budgets stay bounded separately. Full histories still consume disk/RAM and make backups larger; this is not unlimited storage or an unlimited model context.

Required brief, assignment, approved instructions and active standing directions are not silently discarded to fit a prompt. Supporting evidence is selected/excerpted with retrievable IDs. If active requirements alone exceed the budget, consolidate/revoke obsolete directions or adjust the input limit; the system reports the problem instead of forgetting a constraint. An archived rejected idea is a recorded decision, not proof that every later situation must be identical.

Restarting creates a fresh run, not a spending reset. Request/spending history, account allowance and uncertain usage remain. Acknowledging uncertainty authorizes retry after review; it does not refund or erase the earlier request.

## Verification and limits

Regression tests reproduce the audited failures in disposable databases and check stale saves, migration, archival pagination, backup/restore, receipt recovery, meeting actions and the private browser boundary. Browser tests exercise navigation, connection settings, model selection, planning recovery, drafts, exports and offices alongside the new paths.

No real Codex, Ollama or paid API requests are made by these tests. They establish application behavior, not a live model's usefulness or remaining allowance. Two native sandbox checks are host-dependent and skipped on this development host because Codex refuses its reserved socket directory ownership/permissions; native worker isolation still needs validation on a supported Ubuntu/Windows setup. The control API's independent pairing check is tested even when that native check is unavailable.

### Recorded repair validation

- `npm test`: 138 passed, 2 host-dependent native checks skipped, no failures. New regression cases include stale edits after restore, histories beyond the old limits, follow-up contracts and meeting accountability.
- Production TypeScript/Vite build: passed.
- Full Chromium suite: all 33 browser tests passed, including the existing 4/8/12 offices, sign-in/reconnect, documents/ZIP exports, backups, reviews, drafts and console flows.
- Prettier and `git diff --check`: passed. `npm audit --audit-level=high`: zero reported vulnerabilities.
- A separate portable temporary-directory check reran the new audit/key tests after removing Linux-specific test paths. Windows CI is configured; this host did not execute Windows or live model benchmarks.
