# Real work, creative exploration and task-reply recovery

## Update and recover the November 12 failure

Stop Workroom with Ctrl+C, then run in your Coding-Chet folder:

```bash
git pull --ff-only origin main
npm run local
```

Select the existing project, click **See task**, inspect its saved response and use **Retry task**. You do not need to rewrite the brief or restart the project. Retry makes a new model request and uses its allowance. **Resume team** does not silently repeat a failed assignment.

The supplied log showed two completed Ollama requests, each taking about three minutes. Both replies were rejected because an optional handoff bullet was empty and the outcome/follow-up combination was inconsistent. The exported readable view hid those fields. It was a response-validation failure, not evidence of a lost Ollama connection. The reply also promised future documents instead of supplying the requested analysis; accepting its JSON alone would not fix that quality problem.

Text-task grammar now carries the real nested field bounds. Blank optional facts/assumptions can be removed locally, with a console notice, while the original provider reply remains saved. No substantive finding, acceptance check, outcome or specialist assignment is silently removed or rewritten. Invalid decisions, missing work, inconsistent delegation and unverified completion still fail or require the configured correction. Native coding tool work is not automatically replayed.

Live console now keeps **all public fields**, including outcome, facts, assumptions, decisions and follow-ups. Streaming text stays verbatim; finished JSON is indented rather than replaced with a shortened summary. **Raw replies** shows the original saved text. On a broken Ollama stream, the last received public text is flushed and labeled interrupted, even inside the UI update throttle interval. Private reasoning is not displayed.

## What these agents actually are

Workroom runs a task scheduler around a selected model connection. Each assignment sends the named agent's role, specialist procedure, current task, checks, project direction and selected saved evidence. Distinct roles can use the same model; they are not separately trained people or permanently running independent brains.

The full specialist procedure and working style are sent once in the app-generated `agentContext`, referenced by the shared system instruction. They are not duplicated in both messages. This leaves more of the configured input budget for meeting decisions and teammate evidence; the full methods remain intact. Context reports still identify included/omitted source text and preserve originals for retrieval.

The shared working instruction is a lean action loop: observe evidence, choose one useful action, execute through available tools, check the result, and continue or hand off. Reports, budgets, minutes and other human-facing documents are not default stages. They are appropriate only when requested or necessary for the next useful action. For software work, a concise receipt of changed files, executed checks and remaining gaps can be the work result; no extra document is required. Opening an editor suspends hidden 3D rendering to avoid spending CPU/GPU on a covered office, without stopping model jobs or saving.

A real internal handoff consists of a model requesting concrete assignments, the scheduler creating tasks for actual team members, those members making separate model calls, and the original task resuming with their saved results. A promise such as “we will make a matrix” creates no work by itself. Requests now include remaining delegation rounds/task slots and the actual team IDs; tool and task limits are still checked before scheduling. Office motion visualizes these events and does not execute the work.

The project card identifies its connection's capabilities:

- **Ollama, OpenAI, Gemini and compatible text connections:** generate from supplied evidence. Their built-in text adapter does not execute tools. A project can now explicitly select a separate Codex workspace executor for task roles while retaining this connection for planning and meetings.
- **Codex with managed workspace tools:** inspect/edit real project files and execute commands after readiness checks. Independent review and actual tests remain necessary.
- **Codex with optional web research:** read-only search for text tasks, with source verification still needed.
- **External workers:** capabilities depend on the separately implemented worker; inspect its reported receipts.

For building and running software, use **Models & sign-in**, select a ready Codex connection for this project, and enable its managed workspace. Use a Software team and a Working software outcome, or a venture project with workspace tools enabled. If needed, permit dependency downloads through **Edit plan → Allow tool network**. That setting is separate from creativity. See [Connections](CONNECTIONS.md), [AI connections and coding](AI-CONNECTIONS.md) and [model evaluation](MODEL-EVALUATION.md).

## Extremely creative work with useful experiments

Choose **Edit plan → Working style → Creative exploration** for an existing project. New venture projects default to it; an explicitly selected Focused delivery setting is retained.

Creative exploration permits challenging the initial plan, proposing unconventional mechanisms, combining specialties and pursuing reversible internal experiments. With working tools, agents are directed to implement a small useful experiment, run it, inspect results and seek independent critique. Without tools, they must produce useful analysis or an executable proposal and identify what cannot be tested. A workflow template is a starting method, not a fixed list of allowable ideas.

For a capital goal, search broadly: scoped bounties and open-source rewards, grants/prizes, crowdfunding and donations, unusual automation/data services, ownership-verified unclaimed assets, legitimate promotional rewards/airdrops, market research and paper-trading experiments. Unconventional, uncomfortable or speculative ideas can be investigated; the team should test their mechanism, fees, downside, eligibility and resource needs rather than dismissing them by taste. Distinguish revenue, grants/prizes, donations, pre-sales, investment and speculative gains. Do not fabricate causes or returns. Live trades, spending, asset transfers and fundraising require an actual configured connector and specific authorization; research/simulation alone does not authorize them. Ask the team to compare eligibility, funding incentives, effort, delivery obligations and financing terms using actual evidence. Missing customer or funding evidence must remain explicit. Spending, outreach, agreements, deployment and transactions require the relevant tools and authorization; a creative prompt cannot make those integrations exist. Provider rules and model ability also remain unchanged.

A useful brief might request: “Compare materially different ways to finance a small software experiment using my stated resources. Reject undifferentiated AI services. Show the strongest hypotheses, evidence gaps, cheapest tests and stop conditions. Build and test a prototype if the enabled tools support it. Ask me only for a consequential choice or missing authority.” Supply actual budget, skills, available hours and assets where relevant; do not ask the model to invent them.

## No mock work in a normal workspace

Fresh normal state contains no sample projects, tasks, outputs, approvals or activity. The seed helper defaults to empty state, and automated tests must explicitly opt into sample fixtures. The normal local/Codespaces launchers disable simulation and never substitute a canned result when a model fails. AI planning calls the model; manual planning starts with no assignments. Role profiles and editable task templates are configuration, not evidence of completed work.

Historical simulation records are retained as labeled history rather than silently deleting saved projects. They cannot run as real work in a normal workspace. Automated tests still use isolated fake model replies to exercise failures without consuming your allowance; those tests do not demonstrate live model intelligence.

Start with the small arithmetic and internal-handoff cases in [Model evaluation](MODEL-EVALUATION.md). A 4B model being connected does not establish that it can reliably plan a business or implement software. Evaluate accepted useful results, unsupported claims and cost per result before giving it a large autonomous project.

## Make a smaller model useful instead of asking it to do everything

The practical goal is a reliable system around the model, not an imaginary increase in its intelligence.

| Approach                                 | Current support and next step                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work in short, evidence-first milestones | Planner instructions now prefer the next verifiable result and immediate independent review over a speculative business launch checklist. Tasks can expand through bounded specialist follow-ups. No new fixed step count is imposed.                                                                                                                                                                     |
| Supply a shared evidence pack            | Use real costs, customer examples, sample data, constraints and links/excerpts. Saved outputs, verified memory and active directions are passed with provenance. Missing information remains missing; model-authored memory is not automatically trusted.                                                                                                                                                 |
| Let software verify measurable claims    | Managed Codex jobs can run calculations, tests and small experiments, with observed command/file receipts. Use the model for proposing and interpreting work; check exact arithmetic and behavior with programs and independent review. The built-in Ollama adapter does not yet execute these tools.                                                                                                     |
| Separate invention from criticism        | Let a strategist propose materially different mechanisms; have the reviewer challenge assumptions and identify the cheapest disproof. Give the coordinator actual findings before it selects or expands a route. Different roles sharing one model can still repeat the same error, so source evidence and executable checks matter.                                                                      |
| Spend strong-model effort selectively    | Today you can pause a project and change its exact model for difficult analysis or a coding/review milestone, retaining saved project evidence. Native Codex tool jobs need their configured workspace. A separate Codex workspace task executor is now an explicit saved project option, retaining local planning and meetings. Automatic confidence-based per-agent model selection is not implemented. |
| Learn from measured outcomes             | Use a small, repeatable acceptance set and record useful accepted results, unsupported claims, corrections, elapsed time and requests per result. Change prompts, model or task scope based on those results. More roles or meetings alone do not establish improvement.                                                                                                                                  |

A sensible hybrid direction is local generation for inexpensive candidate exploration and repetitive transformations, deterministic tools for facts that can be checked, and explicitly configured Codex for hard implementation/review. A future local tool adapter should give Ollama narrow, sandboxed, auditable tools rather than unrestricted shell access. Explicit local-planning/Codex-execution routing and project-owned software tools are included. A native Ollama shell/tool runtime and automatic confidence-based routing are not. The existing controls already let you test the milestone/evidence/review approach without paying for a new service.

For the execution setup, connector extension protocol, GitHub reuse, paced/cache-aware HTTP client, image downloader, crawl/search index and checked tool/core extension workflow, see [Project tools and internet access](PROJECT-TOOLS-AND-INTERNET.md).

## Verification of this update

- Production TypeScript/Vite build passed. Unit/integration suite: 181 tests, 179 passed and two native-sandbox checks skipped because this development host's reserved Codex socket directory had incompatible ownership/permissions. No unrestricted fallback was used.
- The full browser run exercised 40 scenarios: 38 passed; an initial-load timeout and one local connection reset passed on focused rerun. After the final role/context change, six affected browser scenarios passed again, including meetings, complete console output, rejected-reply recovery, explicit executor selection and creative project settings.
- Read-only live HTTP checks downloaded a real repository PNG with checksum receipts and crawled one public repository page into a searchable local index. Searching the saved index required no further site request.
- Model protocol and executor tests use isolated fixtures and actual temporary files/commands. They verify orchestration and failure handling; they do not establish live 4B model quality, earnings, or an authenticated trading/payment integration.
