# How Workroom agents work

Each role runs an assignment through the project's selected model. Roles share the saved project goal, decisions, relevant dependency results and (when enabled) the managed project folder. These are separate model requests with role instructions, not four permanently running models. The default concurrency is one assignment at a time to conserve allowance; the other agents can legitimately be waiting.

## See actual work

In **Workspace**, **Team at work** shows each agent's assignment and observed request, public reply or tool activity. Click an assignment to inspect its saved result, checks and retry controls. Click **Live output**, or a 3D character, to open that agent's console. The console shows actual public events; it cannot show private model reasoning. Some connections return the reply only when it finishes. A processing indicator is not a percentage or a claim that a result passed review.

Characters walk at a faster pace. Active agents read at their monitors and type when public replies or tool activity arrive. A saved dependency transfer sends its author to the receiving teammate's desk, with a labeled connection; clicking the connection opens the source task. These movements illustrate recorded work. Walking does not itself trigger another model request, delay task execution or create a conversation.

Explicit model-backed meetings gather the team in the meeting room. Only the current contributor speaks; saved contributions and the chair's decision guide later tasks. Start one from **Team discussions**, or explicitly enable automatic meetings in the plan. A normal meeting uses five requests, so automatic meetings stay off by default. Pausing office movement pauses animation while work continues.

## Roles and collaboration

Use **Your team** to edit roles, goals and desk assignments. **How this role works** displays the role procedure. Assignments also receive a procedure matched to their work type: implementation, independent review, tests or planning. The model receives the team roster and subsequent dependent assignments so it can request focused specialist follow-ups without duplicating planned work. Follow-ups, concurrency and revisions remain subject to Workspace controls.

A reviewer must inspect evidence and identify corrections; repeating a colleague's claims is not a review. An implementer must distinguish actual file changes and executed checks from a text proposal. A coordinator must reconcile owners, dependencies and blockers. Roles are instructions to a model, not a guarantee of competence: the selected model and available tools still determine what can be accomplished.

## Source reading and failed reviews

Long supporting outputs are excerpted to respect **Maximum input bytes**. Source passages use absolute Unicode character offsets into the original saved output. Retrieved passages keep these offsets even when shortened; repeated or overlapping requests are combined, and the initially supplied excerpts are retained during retrieval. The task's context report shows the actual supplied ranges.

The request states how many reading rounds remain. After the two allowed rounds, the final response schema requires a work result rather than another retrieval request. A reviewer that still lacks essential evidence should return useful partial findings and an explicit blocked result naming the missing source/range. It must not certify unread evidence. One bounded format correction is still available, within the existing four-request ceiling. No automatic API fallback is added.

Existing failed assignments and earlier outputs stay saved. After updating Workroom, open the failed task and retry it. The corrected protocol applies to that retry; you do not need to rewrite the project. Increase the input limit only if a useful review genuinely needs more evidence than fits, since larger requests can consume more allowance.

## A money-making experiment

Choose **Venture & opportunity validation** for a new project, or edit the roles and plan of an existing one. Give the team a financial goal and any real constraints you want it to respect. It should compare distinct routes, challenge the strongest option, check delivery and acquisition costs, and produce the smallest useful experiment with measurable success and stop conditions. Unknown resources remain assumptions. Documents should advance that experiment rather than serve as proof of progress.

A text-only connection can analyze supplied material and create requested assets. Codex public research requires the project's research option; actual coding requires its managed-workspace tools. Connection instructions are in [CONNECTIONS.md](CONNECTIONS.md). A 3D office is a visualization, not a browser, payment system or business account. Outreach, deployment, transactions and revenue cannot be treated as accomplished without the necessary authorized tools and evidence. Workroom does not have a general-purpose external-action integration for those activities.
