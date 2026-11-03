# Set up a useful team

## Select the model that will actually run

Open **Models & sign-in**. The blue **Selected** panel names the current project's connection and exact model ID. Choose a connection and model, then press **Use this model for this project**. A changed dropdown is a draft until you press that button. You can pause active project work from this page.

A green beacon means the connection was checked. Several connections can be available, while one connection/model is selected for this project. **Default for new projects** is a separate choice. Saved projects keep their own selection.

If your office says **Ollama processing**, that assignment is using a local Ollama model. Signing into ChatGPT does not switch an existing project. Select **ChatGPT · Codex** and your account's model ID to use that connection. Connect through the official Codex sign-in flow; no ChatGPT password belongs in project messages.

## Choose an office and specialists

New project offers **Studio (4)**, **Office (8)** and **Headquarters (12)**. Expand the specialist picker before creating a plan to choose the roles you want. Change an existing office under **Your team → Choose office & specialists**. Existing teammates with recorded work remain part of its history; use a new project/run when replacing a historical team.

Twenty profiles cover project management, coordination, supervision, architecture, software engineering, independent code review, testing, operations, data analysis, market research, commercial strategy, finance/risk, product/UX, product management, security/privacy, automation, customer success, technical writing, procurement and communications. You can edit each teammate's name, specialty, goal and desk, or use custom role instructions. Multiple teammates may share a specialty.

Every model request gets a shared operating template, the named specialist's instructions and goal, the assignment, project scope and relevant evidence. Planning and meetings identify their responsible agent too. **Edit role & desk → How this role works** shows the shared template and role procedure. Public requests in **Live console** show the context actually sent. Templates guide the selected model; they do not guarantee expertise or turn a text-only connection into a tool-using runtime.

Team size and concurrency are independent. The default runs one assignment at a time to conserve allowance and local RAM. A larger team supplies more specialties, rather than loading twelve separate models. Coding jobs in one managed folder stay serialized to avoid file conflicts.

## Conversation and shared evidence

Each project has its own **Project conversation**. Choose **Question for the coordinator** to ask for help, or **Standing direction for the team** to guide upcoming work. Requesting a reply queues a real, saved model assignment. It can ask specialists for focused internal help and answer while the main plan stays paused. These conversation assignments stay read-only and do not resume unrelated implementation. Saving direction alone makes no model call.

The conversation lives in Workroom's local database. Agents receive their identity again on each turn, recent project messages, verified memory, relevant teammate results and selected board approaches. This works across providers without depending on one vendor's permanent chat thread. Questions do not silently become standing instructions. Older saved work can be retrieved within the existing context limits. Messages live in an indexed SQLite journal without the old 100/500 stop. Use **Load older messages** to read earlier pages. All active standing directions remain required context until explicitly revoked or superseded; **Active standing directions** lists them. Portable backups include the conversation and board.

## The office reflects actual work

Planning specialists use the board while working on planning assignments. Implementation stays at a workstation; real commands, file changes and public replies appear in the console. Saved dependency transfers produce desk handoffs linked to the actual source result. Idle teammates stay at their desks.

The physical **Idea board** opens a real project board. Its notes come from saved model proposals, model-backed meeting contributions, or your input. Cards retain their author and source. **Select approach** informs later requests; it does not certify demand or implementation. **Investigate** assigns a real assessment to your chosen teammate and links its result. Duplicate model proposals are not added repeatedly. Cards live in an indexed journal; use **Load older ideas** for earlier pages. Saved rejections remain searchable by source ID so the team can check prior decisions.

Recent browser updates stay bounded while older messages/cards remain in SQLite and backups. Saved history, the browser display window and a model’s input budget are separate. More history uses disk and memory; it does not all go into every request.

**Team discussions** makes actual specialist contributions and a chair summary. Each participant receives prior public contributions. Decisions feed later work, and contributions can add source-linked board proposals. A meeting normally uses one request per participant plus one chair summary: 5, 9 or 13 requests for a full 4-, 8- or 12-person team, with bounded format corrections when needed. Select a relevant subset under **Meeting participants** for a manual meeting. Chair actions link to queued tasks as acceptance checks; only a finished task with matching evidence marks its action addressed. Proposed future actions remain unassigned. Automatic meetings include all teammates and remain an explicit option. Larger teams enter and leave the meeting room in order so occupied seats do not block the aisle.

Animation follows saved assignments, handoffs and meetings. It adds no model calls. Pausing animation does not stop work; **Pause project** does. Separate browser views do not control whether the backend can finish a job.

## Exploration, tools and timeouts

**Working style → Creative exploration**, in New project or Edit plan, encourages unconventional routes, challenges obvious choices and lets the team resolve routine internal work autonomously. **Focused delivery** prefers the smallest useful solution. Neither setting changes a provider's own rules, file permissions, network access, billing controls or result validation. Those are separate capabilities, not a creativity setting.

Text connections can analyze material and produce requested text/code proposals. Actual file implementation and command execution require a ready Codex managed workspace (or your separately implemented external worker). Enable the shared coding folder on the model page, and configure permitted dependency-download network access separately in Edit plan. Roles receive the actual capability limits and must report unavailable tools honestly.

Local CPU generation can spend several minutes processing a long prompt before producing output. Ollama now streams public reply text; private thinking fields are not forwarded. The office shows assignment elapsed time, and the console shows output as it arrives. **Request timeout (seconds)** in Edit plan controls each text request, from 60 to 3,600 seconds; new projects default to 900. Managed coding uses the same project Request timeout setting, default 900 seconds. Ollama's context window is sized from the request/output budget up to the Ollama context ceiling in Workspace controls (default 32,768 tokens); the byte budget is capped accordingly. This is an estimate because tokenization varies by model.

A timeout does not automatically repeat the request. Inspect the saved task and Usage, then retry, select another model, shorten the assignment or adjust its timeout. Previous rejected replies and earlier tool receipts remain labeled as history. Increasing a context/time limit can use more resources; it does not improve the underlying model's reasoning by itself.

## Restart without losing the previous run

Use **Restart project**. Choose a new model-generated plan or reuse the current assignments with empty results. You can choose a different office size; a smaller team requires a new plan so removed owners do not leave orphaned assignments. The new run keeps the current brief, remaining specialist profiles, model and approved team instructions. It gets new task IDs and a new managed folder when tools are enabled. Old outputs, decisions, conversation, board and files stay in the previous run, accessible with **Open previous run**.

Restart stops current work first and deduplicates repeated submissions. It does not erase rolling request/spending history, account quotas or uncertain usage. Reusing a plan makes no model request until you run it; replanning uses the selected model's allowance.

New software projects offer **Working software** or **Design only**. Working software requires implementation, independent review and downstream tests with matching evidence; Design only keeps file editing disabled. Plan/team/settings saves detect concurrent edits and retain stale drafts instead of replacing newer work. See [audit repairs](AUDIT-REPAIRS.md) and [model evaluation](MODEL-EVALUATION.md).

See [Model activity, limits and planning recovery](LIMITS-AND-MODEL-ACTIVITY.md) for visible request stages, the long-title repair, editable retrieval/correction/context settings, field-level diagnostics and removal of arbitrary record-count stops.
