# Local, controlled agent office

Approved baseline: `594211e9fda3a8bdd9903ed4c3a65440316c65d2`.

Preserve the slate office, walking and interactions, readable labels, role/desk editing,
project switching, both document packs, approvals/revisions, persistence, all exports,
existing demo/API/external connections, and WebGL fallback.

Add, in reviewable commits:

1. Versioned portable backups, validation and recovery snapshots; Ubuntu/Windows
   browser launch with configurable port (normal workspace 3001, demo 3000).
2. Frozen project backends; no model calls on ordinary project creation; explicit AI
   planning; a persistent request ledger, conservative API reservations, economy
   limits, no unrequested billing fallback, and uncertain-attempt recovery.
3. A managed ChatGPT-authenticated Codex runtime and local Ollama connection.
   Preserve external workers as an explicitly unmetered integration.
4. Relevant dependency context, deterministic prompt caching, and curated project
   memory with human confirmation, source references, and stale-source detection.
5. Readiness diagnostics, settings/usage/backup/memory controls, tests, and operating
   instructions. Keep code execution out of the initial document worker.

One model can serve several role/goal instructions. It does not need separate model
weights for each agent. Workroom owns task scheduling; no second agent framework
or unbounded autonomous goal-generation loop is required.

Memory is evidence, not model training: store verified requirements and decisions,
keep full original outputs, retrieve relevant records, and flag changed sources.
Do not present generated claims as confirmed facts. Choose a distributable model
only after hardware, license, download size, and task-quality evaluation.

Paid APIs start disabled. A subscription worker uses its account's allowance, not
an unlimited free API. App limits do not cap unrelated account use or arbitrary
external workers, and cancelling a request cannot undo charges already incurred.
Model prices are user-configured estimates, not a provider billing guarantee.

Validation: existing unit and browser suites; legacy-state import and restore;
malformed backup rejection; restart/uncertain requests; budget reservations before
planning/execution/retries; no API calls in disabled mode; mocked Codex/local-model
contracts; memory provenance; native-format exports. Native Windows CI is configured,
but cannot be represented as locally tested on a Linux execution machine.

## Productive workflows and durable planning (requested October 22)

Preserve existing projects, exports, approval/revision behavior, cost controls, provider choices, memory, external leases, office movement and fallback. Add durable pre-planning project saves, browser brief drafts, idempotent creation, saved planning failures and explicit retry/template fallback. Replace normal sample projects and mandatory six-stage plans with empty normal workspaces, purposeful editable plans and project-specific team presets.

Add a distinct Codex software worker with a per-project managed folder, scope inspection before approval, implementation, independent review/fixes, executed tests, live tool records, blocked-result handling and useful handoffs. Retain the restricted text worker for other workflows and planning. Software jobs share files and serialize per project. Provide source viewing/download, explicit per-project tool network, local sandbox readiness checks and fail-closed behavior, without API/unrestricted fallback. Keep limits and clarify their scope. Document source backups separately from record backups.

## Visible productive collaboration and draft recovery

Preserve existing data and execution/export/cost controls. Add saved public specialist discussions, critical comparison and chair decision records that feed upcoming assignments. Offer optional automatic meetings at work milestones, with explicit request costs and recoverable partial contributions. Tie office travel, speaking/listening and a meeting room to these records; remove idle random wandering.

Provide concrete specialist instructions, project-selectable Codex effort, a venture validation workflow with AI-substitution/demand/economic checks, and separately opted-in read-only Codex web research. Never claim that stronger prompts validate a business or guarantee income. Persist feedback, retry, memory, agenda and plan drafts without automatically treating drafts as verified facts. Validate limit-error/settings/reload recovery, meeting cost receipts and failure resume, role assignment, native configuration contracts and physical meeting-room routing.
