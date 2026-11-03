# Workroom functionality and interface audit

The main flow is **connect model → describe goal → review plan → run → inspect work → answer necessary questions → use verified results**. Screens should expose an action, evidence or a relevant state. An animation or a slogan is not evidence of work.

## Interface contract

| Control or screen                 | Purpose and actual destination                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workroom wordmark and W/tie icon  | Return to Workspace; retained as the home link.                                                                                                                 |
| Sidebar card                      | “Your agent workspace”; a plain label, without a second monogram or a pretend account selector.                                                                 |
| Project switcher / New project    | Switch saved records or create a durable brief.                                                                                                                 |
| Workspace                         | Project state, model, plan, real task/meeting activity and the 3D office.                                                                                       |
| Task board / task card            | Assignments, dependencies, actual results, checks, failures, saved rejected replies and retry.                                                                  |
| Outputs / View results            | Read and export deliverables; source files appear only when the project has a managed folder.                                                                   |
| Your team / profile               | Edit project-specific role instructions and desk assignment; inspect role procedures.                                                                           |
| Office & specialists              | Choose a 4-, 8- or 12-desk space and assign any of 20 specialist profiles before model planning; inspect the shared template and each specialist's method.      |
| Project conversation              | Save project-scoped direction or request a real specialist reply, including while the main task plan remains paused.                                            |
| Idea board                        | Save source-linked proposals, choose or reject approaches, and request an actual specialist investigation. The 3D board opens this same saved board.            |
| Team discussions                  | Start/read actual model-backed meetings; retry unfinished contributions or explicitly skip a failed meeting.                                                    |
| Activity                          | Saved engine events, decisions, model-result summaries and errors. No timer-generated motivation in normal work.                                                |
| Live console                      | Observe public requests, replies and tool receipts; filter, reconnect and export bounded retained logs.                                                         |
| Model → Change                    | Change the existing project's provider/model and optional Codex tools after pausing.                                                                            |
| Model connections                 | Check readiness, choose a default for future projects, and open a working setup guide for each provider. Unconfigured providers retain accessible instructions. |
| Selected project model            | Show the current project's exact provider and model ID. Explicitly apply a new choice without changing the default for future projects.                         |
| Restart project                   | Stop the old run, create fresh assignments or replan, and retain the previous run's results and files. Rolling usage limits remain in force.                    |
| Workspace controls                | Limits, usage, project memory/instructions, and backup/restore. Backup import is also available before the first project.                                       |
| Models & sign-in                  | Open Connections to check actual readiness, sign in or reconnect, and edit saved provider settings.                                                             |
| Notification bell                 | Open pending review or request browser notification permission; report unsupported/denied permission.                                                           |
| Run / Pause / Resume              | Start/stop actual model-backed task scheduling. Disabled while planning or without tasks; the planning error and edit-plan action explain the next step.        |
| Office movement / camera controls | Affect visualization only. Task scheduling continues when animation is paused.                                                                                  |
| Quick guide / Source code         | Open real instructions or the repository.                                                                                                                       |

## Conflicts corrected in this pass

- Removed the silent switch from an unavailable model to Demo. A saved unready connection remains visible and blocked. Legacy simulation project records remain intact, but normal startup cannot execute them.
- Normal startup and the old demo command now launch the same real workspace. Codespaces opens the workspace port, without launching canned sample projects. Automated tests retain an explicitly enabled, isolated simulation fixture.
- Replaced promotional headings and activity filler with screen names and factual runtime states. Removed the decorative account avatar and redundant sidebar project promotion.
- Completed projects now have a **View results** action instead of an inert disabled completion button.
- AI planning remains the default. The manual option and planning-failure recovery start with zero tasks, rather than inserting generic document stages. Existing saved plans are preserved.
- Codex-only creation options are shown only for Codex. Software workflows explain their Codex tool requirement. Automatic meetings default off; a full meeting normally uses one request per participant plus one chair summary.
- Provider setup remains clickable when a connection is unavailable. A failed provider change cannot leave the connection dialog permanently busy.
- Missing approval records no longer crash task-card navigation. A card can still open the task's saved details.
- The example external worker now calls a real model or fails. Missing API keys do not yield sample success text.
- An empty workspace can import backups instead of requiring a placeholder project first.

## Preserved functionality

Saved projects, briefs, task outputs, approvals, draft autosave, source folders, office movement, roles/desks, meetings, result validation, model choices, cost controls, usage receipts, exports and backup/restore remain supported. A new default does not rewrite an existing project's provider or model. Manual task editing is intentional user-authored work; it does not claim model-generated planning.

## Verification and limits

Regression checks cover browser navigation, project creation, real model-protocol fixtures, reviews, retries, exports, backup import, connection settings, office movement and the Live console. Local setup tests exercise installer/start/download ordering, installed-model reuse, explicit tag choice, environment preservation and failure behavior without modifying the host OS. Production build/type checks are required.

Fixtures establish protocol behavior, not model quality. This development environment cannot reach Ollama's download site, so the requested model still needs a live download and a useful end-to-end task on the user's machine. Native Windows/macOS installation and live Codex account access are not represented as verified on this Linux host. The classroom idea is deferred; it needs a separate privacy, permissions and model-policy design.

## Observable office work

Workspace now shows live assignment and public tool/reply activity, rather than a generic progress label. Characters open their agent console; task links open saved work. Recorded dependency transfers visit the receiving desk and link to the source result, while actual model-backed meetings use the meeting room. Animation does not create extra model calls. See [AGENT-WORK.md](AGENT-WORK.md) for roles, source retrieval and the limits of autonomous business experiments.

The [November audit repairs](AUDIT-REPAIRS.md) add protected plan/team/settings saves, inspectable plan history, full conversation/idea pagination, active standing directions, filtered usage recovery and private browser pairing. Meetings can select participants and track task-linked actions; software plans distinguish implementation from design-only work.

See [Model activity, limits and planning recovery](LIMITS-AND-MODEL-ACTIVITY.md) for visible request stages, the long-title repair, editable retrieval/correction/context settings, field-level diagnostics and removal of arbitrary record-count stops.
