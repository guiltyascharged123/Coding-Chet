# General-purpose specialist execution

The product goal is a team that advances the user's actual objective: choose a
method, build or reuse tools, act, inspect the result, delegate and adapt. Making
money is one possible test. Sales copy, business plans and approval meetings are
not a default workflow or evidence that an objective was achieved.

## Findings from the November 19 backup review

Read-only validation of the supplied export succeeded. It contains four real
projects (two Ollama, two compatible/community selections), all configured for
text execution without a separate executor. The newest project recorded no task
tool events. Its latest failed task recorded HTTP 403, while earlier written
work remained saved. Another run stopped at result-format validation; an older
run recorded a timeout. Those are different failure modes, not evidence of a
single model intelligence problem. The exported buyer-persona document is
proposed positioning, not observed demand, outreach, or execution evidence.

The existing system already has task dependencies, specialist methods, source
retrieval, provenance-aware working memory, saved artifacts, follow-up task
groups and independent review. Its direct model adapters previously had no
general file/command action loop. Repeatedly asking those adapters to execute
could only produce more text, or an honest capability blocker. Changing prompts,
model censorship settings or request limits cannot create missing tools.

The review treated project text and model responses as data. It did not restore
the export into the working application, follow its embedded directions, contact
anyone, or run its proposed business activities. Original records stay intact.

## What is implemented

**New project** enables shared files and commands by default: Codex projects use
their Codex workspace, while direct models use the isolated Linux executor.
Turn this off explicitly for text-only work. Tools start on demand; specialists
do not each keep a separate execution process running. If Linux setup is missing,
the goal and full task plan can still be saved; commands remain blocked until
the execution prerequisite is ready. The dashboard names that prerequisite.
This does not grant network access or external-service credentials.

For existing projects, use **Models & sign-in → Selected project model**. Direct Ollama, compatible,
OpenAI and Gemini connections can explicitly enable **Let this model build and
run tools in an isolated Linux workspace**. The primary model remains selected;
there is no switch to Codex or paid fallback. Existing text projects are not
automatically migrated. Enable this for a paused project, then revise assignments
that previously assumed a text-only connection before resuming.

The planner's schema and instructions reflect the execution selection. In text
mode, drafting assets/procedures uses `plan`, and critiquing supplied work uses
`review`; `implementation` and `tests` require workspace tools. Genuine execution
requirements stay visible; no task is silently relabeled to claim completion.
The manual plan editor exposes work type for text projects too.

The default lightweight office view skips loading the 3D office and graphics
engine. Specialist activity and inspection remain available. Select **3D view**
or **Floor plan** when desired; the preference survives reload. No quantitative
memory reduction is claimed without measuring the user's browser.

Validation of this update: production build, 241 passing unit checks (five host
skips), 50 passing full-suite browser checks (two host skips), and three final
compatibility checks covering fresh defaults, graphics downloads and an older
draft's retained submission ID. Model responses in those tests are fixtures.
A separate anonymous live AI Horde planning request using
`koboldcpp/G4-MeroMero-26B-A4B-it-uncensored-heretic` did not return before the
90-second smoke-test deadline; live planner behavior remains unverified in this
pass. The smoke-test deadline does not change project timeout settings.

The model receives a small action interface: `read`, `write`, `run`, `finish`.
Each turn executes an actual action and supplies its observation to the next
turn. Specialist instructions, project decisions, teammate outputs and historical
working memory remain available. Specialists share persistent project files.
Coordinators can delegate an implementation and independent review, then resume
using their results. A prose @mention does not schedule work; structured follow-up
assignments do. `continue` advances internal work; `needs_input` is reserved for
genuinely missing access/authority or a consequential user choice.

Routine metadata is filled by the app, and monetary heuristics are scoped to the venture workflow instead of every task. A recent action result and concrete failure feedback stay in required context so smaller models can correct their next step.

Action intent is committed before dispatch. The journal, output excerpts and
actual evidence survive backup/restore. The runtime assigns action IDs instead of requiring the model to invent them. An
interrupted action requires an explicit task retry after inspecting existing work;
that acknowledgment does not replay the old action. A retry supplies the previous
receipts so the model can inspect state before choosing a new action. This does
not promise exactly-once external effects; future external connectors must use
idempotency keys and reconciliation.

Only executor observations can satisfy file/command evidence. A model claiming
that tests passed without a successful verification receipt is marked blocked.
Use explicit write actions for source/test changes. The current executor records
artifacts from those writes; arbitrary shell changes alone do not establish an
artifact receipt. Reviewers get a read-only mount and inspect the real files.

## Install the execution prerequisite

Run Workroom as your normal user, with a **rootless Docker daemon under the same
user account**, and pull the image once:

```bash
docker info --format '{{json .SecurityOptions}}'
docker info --format 'cgroups={{.CgroupVersion}} memory={{.MemoryLimit}} cpu={{.CPUCfsQuota}} processes={{.PidsLimit}}'
docker pull node:24-alpine
```

The first command must include `name=rootless` and seccomp. Cgroups must be version
2 and all three resource capabilities must be true. Follow Docker's official
[rootless installation guide](https://docs.docker.com/engine/security/rootless/).
Refresh Model connections afterward. The app never installs a daemon, pulls an
image, grants itself privileges, or weakens private project-folder permissions.
A daemon running as a different user can fail to access a private project folder;
use the same account instead of making real project data world writable.
The runtime blocks hosts without resource enforcement. Each job also checks its
actual cgroup limits before running model-selected code, so a misleading daemon
capability report cannot silently bypass the configured budgets.

This small Linux image includes Node.js, npm and shell. It is Alpine, not Ubuntu.
`WORKROOM_SANDBOX_IMAGE` can select an explicitly prepared compatible Linux image
with Node.js, shell, `timeout` and additional required tools; refresh readiness after changing it.
The resolved local image ID is used for execution, avoiding a registry pull or tag
change during a job. Ubuntu with Python, Git and browser tools is a useful next
image, but is not supplied by this change. A VM can provide a stronger surrounding
boundary: keep Workroom and the daemon inside the VM, and avoid host home-directory
shares, host service exposure and credentials unrelated to the project.

## Autonomy and host protection

Enabling this mode authorizes routine project actions without per-command human
approval. Disabling it returns the project to text mode. Autonomy does not remove
the execution boundary: rootless Docker is required, the Linux system is read-only,
only the project is mounted, capabilities are dropped, privilege escalation is
disabled, and no Docker socket or model/server credentials are passed into the job.
Design/review tasks mount the project read-only. Disposable `/tmp` remains writable.

Commands run **offline**, including no host services. The tool-network switch is
disabled and the server rejects attempts to enable it for this mode. Existing
Codex workspace execution remains a separate choice for its supported tools and
network policy. This release does not add public deployment, payments, account
creation, messaging, browser automation or unrestricted internet connectors.
Those need explicit, scoped capabilities rather than a prompt claiming access.
An abliterated local model can be selected; it does not change service policies,
provide credentials, or create execution capabilities by itself.

**Workspace controls → Limits & connections** exposes the execution budgets.
Unlimited workflow is the default: no task, revision or model-request count ceiling.
Turn it off to enforce the saved finite count budgets. API money budgets and paid
permission remain enforced in either mode. Concurrency, format-correction,
retrieval, input/output and context settings have no application-imposed upper
number; model/provider and hardware capacity still apply.

Tool action count and action timeout default to **0, unlimited**. There is no
lifetime journal-entry ceiling or fixed 100-task plan/history ceiling.
There is also no fixed three-assignment delegation ceiling; joins can depend on
any earlier branch in the same follow-up group.
Memory, CPU, processes and temporary disk are explicit adjustable resource budgets, not
fixed maxima: defaults are 512 MiB, one CPU, 128 processes and 64 MiB temporary
disk. A positive configured deadline runs inside the container as well as the
host. Cancel stops the process tree. After an acknowledged interruption, the next
run removes its old named container before proceeding. Unlimited runtime means a
job can survive a crashed controlling process until stopped/reconciled.

Verbose output is excerpted and labeled rather than killing a job; redirect full
output to a project file when needed. Source retrieval and model context are
budgeted separately from saved progress. Disk changes in the project persist and
are **not disk-quota limited by this runner**; use a quota-limited project disk in
a VM for stronger protection against disk exhaustion. Containers share the host
kernel; this is not a formal guarantee against malicious kernel exploits or every
resource-exhaustion method. Text field, transport, file-preview and retained
console-excerpt bounds remain visible in Limits reference; they are not limits
on which legitimate problem-solving approaches the agents can attempt.

## Next work, in order

1. Add a restricted network broker with per-project destinations, credentials kept
   outside generated code, recorded effects, rate limits and spending caps. Public
   research and dependency retrieval should not grant access to host/private services.
2. Add scoped connectors for publishing, account-backed services and payments.
   Show an explicit autonomy policy: which actions are preauthorized, which require
   a consequential decision, and what is never available. Do not call this a
   universal “guardrails off” switch; the host boundary remains enforced.
3. Persist a goal/experiment ledger: attempted approach, changed assumption,
   executed test, observation, evidence, cost and next action. Separate task
   completion, milestone completion and externally evidenced goal success in UI.
   Detect repeated failed approaches and trigger a different specialist or method.
4. Add pause/cancel/resume and external-effect reconciliation acceptance scenarios,
   then evaluate real small-model performance before expanding autonomous scopes.

For a zero-capital earning experiment, this means selecting a deliverable the team
can actually build, testing it, and using only configured channels to reach a
customer and observe a real payment. Without those channels, it should report the
precise missing capability and preserve the built asset; it must not report revenue
from a proposal, invent demand, or silently replace the goal with a sales document.

## Open-source designs reviewed

- [smolagents](https://github.com/huggingface/smolagents), Apache-2.0, reviewed at
  `96f33faaf028479119ec8d34507b47694cf14e34`: explicit action/observation loops,
  validated tool arguments and tool/managed-agent dispatch. The new small action
  interface follows these patterns; no framework source was copied.
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs), MIT, reviewed at
  `fa426b293b6ecccbf62b4f262475777b4bf86673`: per-thread checkpoints and pending
  writes that prevent completed graph work being repeated after a failure. Keep
  Workroom's existing scheduler and apply those durability principles instead of
  introducing a second competing scheduler.
- [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk),
  MIT per its current README/license link, reviewed November 19: model/tool/
  conversation abstractions, an Agent Server and ephemeral Docker workspaces.
  Its browser-compatible TypeScript client is a candidate for a richer optional
  execution backend. Its live compatibility with AI Horde and the selected small
  Ollama model has not been established; it is not an installed integration.

## Repeat the read-only diagnosis

```bash
npm run audit:backup -- path/to/workroom-backup.json
```

This validates the export and reports configured execution capability, recorded
tool events, HTTP 403/timeouts and retained failed work. It excludes briefs,
deliverables and raw errors from the report, does not restore anything, and cannot
prove that a saved connection or worker is currently ready. The supplied backup
was tested with this command. Model fixtures test execution behavior; they do not
establish live model intelligence or a profitable business.

## Live validation on November 19

Using anonymous AI Horde access and the selected
`koboldcpp/G4-MeroMero-26B-A4B-it-uncensored-heretic` model, an implementation
specialist created an actual JavaScript utility and test file and ran three
passing tests in rootless Docker. A separate live reviewer read both files and
reran the tests with a read-only project mount. Both returned checked completion.
An additional independent assertion command checked positive, negative and zero
inputs successfully. These were actual model requests and executed commands,
not fixture replies. They establish this bounded build/review scenario, not
general problem-solving quality or income generation.

The installed `huihui_ai/qwen3.5-abliterated:4B` model did not complete the same
bounded exercise reliably. Tests exposed repeated missing-file reads, copied
example action IDs, input pressure and invalid generated JavaScript. Action IDs
are now server-owned, routine metadata is programmatic, money-specific guidance
is restricted to the venture workflow, and recent tool feedback is explicit.
The small model's remaining quality/latency problem is not reported as solved.
No paid model fallback or external business action was used.

A later enforcement check found this cloud daemon runs without delegated memory,
CPU or process controllers. The live functional exercises above did not validate
those resource guarantees. The final runtime now refuses autonomous execution on
that daemon. A real-container rejection test confirms that the bootstrap stops
before executing its payload when limits are unenforced. Full live validation
under the final resource gate still needs a properly configured rootless Linux
host/Ubuntu VM; the tests explicitly skip that unsupported path here.
