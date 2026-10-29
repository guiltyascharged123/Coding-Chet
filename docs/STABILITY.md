# Reliability, saved history and work evidence

This stabilization pass addresses the October 29, 2026 audit. Workroom remains a single-user local application. The browser request protections described here do not provide accounts, classroom permissions or multi-user project isolation.

## Activity history is not agent memory

The old implementation had two conflicting limits: ordinary saves retained only the latest 250 events, while the state/backup validator allowed at most 1,000. An oversized imported or in-memory history could fail validation; ordinary use usually discarded older events before reaching that limit.

Workroom now stores an indexed activity journal in SQLite. It keeps 250 recent events in dashboard updates, and **Activity → Load older activity** reads older records in pages of 100, with project and event-type filtering. There is no 1,000-event retention cap on the journal. Existing events still present in the database are migrated; events discarded by older versions cannot be reconstructed unless another backup contains them.

Keeping thousands of short events is reasonable. Sending thousands to every browser update or every model prompt is unnecessary. Activity is an operational timeline: a task started, a teammate handed off work, an error occurred. Agent context comes from the project brief, relevant saved task results, decisions, instructions and verified memory. Reducing the _recent display window_ therefore does not remove these sources or lower the model context limit. Longer histories use more disk space, and portable backups become larger.

Workspace JSON backups now include the complete retained activity journal and saved model response checkpoints, while preserving the version-2 envelope and accepting older backups. Export validates the backup before returning it. Browser restore accepts uncompressed JSON up to 25 MB. For larger workspaces, keep an offline copy of `.data` with Workroom stopped; this also preserves managed source files and console history. The JSON backup alone does not contain those source files or console history. Model weights and account credentials are separate; never put credentials in a shared backup.

## Interrupted work

A confirmed model receipt and its reply are committed together. Restarted in-flight tasks require review; Resume does not replay them. Open the failed task:

- **Recover saved result · no model call** validates and applies an available structured reply without another request. Invalid, truncated or insufficiently evidenced replies cannot be certified as completed work.
- Otherwise inspect the saved task, Live console, Usage and any managed files before explicitly choosing Retry. Unknown usage must still be acknowledged.
- Cancellation also holds dispatched work for review. Undispatched queue entries can resume normally.

Planning and meeting replies also receive response checkpoints. Interrupted planning/meetings remain explicitly failed; their contributions and confirmed usage remain saved. Automatic offline recovery currently applies to task work, not an interrupted planning or meeting conversation.

## Connections and startup

Provider reachability is separate from exact project-model availability. An installed project model can run even if the environment's unrelated default tag is missing. Check connections refreshes Ollama/compatible model lists without inference. Metadata does not prove generation quality, account quota or tool compatibility. A missing selected model blocks that project with its actual model name.

Startup compares the running server's code, effective configuration and database identity. If a previous server differs, stop its terminal with Ctrl+C and run `npm run local` again. The launcher reports the conflict before installation/downloads and does not terminate an unverified process. Codespaces uses the same launcher checks; use `npm run codespace:restart` for the helper-owned process. The health endpoint exposes fingerprints rather than keys or local database paths.

Edits to an idle project's plan and collaboration settings can proceed while another project works. Workroom preserves the active task objects. Shared team meetings still require the workspace's active work to stop; the error identifies the blocking project. The workspace-wide compute limit and prohibition on assigning one avatar to simultaneous tasks remain in effect.

## Completion evidence

For managed coding tasks, Edit plan exposes work type and acceptance evidence. Stable criterion IDs connect the assignment to returned checks. A reported check starts with its criterion ID and colon, such as `c1: Tests pass`.

- Implementation requires observed file-change events and a successful recognized verification command.
- Testing requires a successful verification command.
- Review requires independent file-inspection commands.
- Planning can produce an actionable report without artificial tool calls.
- Criteria requesting tool evidence must cite an observed exact command or file path. Report evidence remains a model assertion.

Recognized commands include common test/build/lint/type-check tools (Node, npm/pnpm/yarn, pytest/unittest, Cargo, Go and .NET), and common file-inspection tools. `pwd`, `ls` and `echo` do not count as substantive verification. Other toolchains may need an adapter; Workroom reports the evidence gap rather than pretending they passed. Receipts confirm tool events and exits, not that tests are comprehensive or that an entire business goal has succeeded. Independent review and real-world validation still matter. Existing assignments retain their saved results and can be given more specific evidence requirements in Edit plan.

## Browser boundary and maintenance

Untrusted Host values and cross-origin browser requests are rejected before body parsing. Browser writes require an expiring signed session cookie plus an anti-CSRF header; the browser obtains these automatically. Compressed request bodies are disabled. External runners continue to require their separate server-configured bearer token, also checked before parsing. A trusted reverse proxy must have an exact `WORKROOM_ORIGIN`; keep Codespaces ports private. These measures are not authentication for public hosting.

Production dependencies were updated to patched body-parser and Zod releases, including the Zod 4 migration. CI checks high-severity dependency advisories, unit/integration behavior and the browser flows. A clean dependency scan describes the advisories known at scan time.

## Acceptance testing that remains machine-dependent

Deterministic tests cover protocols, persistence, recovery, request guards and browser behavior without spending model allowance. Live model quality and native sandbox enforcement need a supported host. Before relying on an autonomous workflow, use a small opt-in benchmark:

1. A supplied-price office comparison: verify arithmetic, useful output and no invented external actions.
2. A planning/coordination task: verify dependencies, relevant handoffs and that routine work does not request human approval.
3. A managed Codex software task: implement a small function, run meaningful tests, independently inspect the files, introduce a failing check and verify that completion is blocked.

Record accepted deliverables, unsupported claims, unnecessary interruptions, corrections, latency and calls/tokens per accepted result. Run locally first with one active task and keep spending limits enabled. Do not treat a passing fixture or a model-size label as proof that a real model performs these tasks well.
