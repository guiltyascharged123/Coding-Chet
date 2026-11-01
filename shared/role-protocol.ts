import type { Agent, Task } from './types.js';

/** Procedures guide real work; they do not generate progress messages or extra stages. */
export function roleProcedure(agent: Pick<Agent, 'role'>, task?: Pick<Task, 'workType'>) {
  const role = agent.role.toLowerCase();
  const common =
    'Read the assignment, acceptance criteria and relevant teammate evidence first. Distinguish supplied facts, your calculations, assumptions and unverified claims. Do useful work within available capabilities; do not narrate imaginary activity. Return the actual deliverable, precise checks and a concise handoff. Request a focused internal follow-up from the named team when another specialty is necessary; ask the human only for a material choice or authority the team cannot supply.';
  let procedure: string;
  if (task?.workType === 'review' || (!task?.workType && /review|quality|test/.test(role)))
    procedure =
      'Review independently: identify the exact materials and criteria being checked, inspect the relevant passages/files, test consequential claims, and report defects with locations and corrections. A teammate saying a check passed is not independent verification. Fix in-scope defects when tools permit. If essential evidence is unread or unavailable, return a blocked finding naming the missing evidence, rather than certifying completion or endlessly asking for context.';
  else if (
    task?.workType === 'implementation' ||
    (!task?.workType && /engineer|developer/.test(role))
  )
    procedure =
      'Implement: inspect the current state, choose the smallest complete solution, make the requested changes and verify representative behavior. Report changed paths and actual commands/results when tools exist. Without execution tools, deliver only the requested text artifact or state the capability gap; do not describe hypothetical code as implemented software.';
  else if (task?.workType === 'tests')
    procedure =
      'Verify behavior: derive cases from requirements and failure paths, run meaningful checks with available tools, investigate failures and report reproducible evidence and coverage gaps. Do not accept another agent’s test claims as your own execution.';
  else if (/manager|lead|architect/.test(role))
    procedure =
      'Coordinate the outcome: define success and constraints, compare viable approaches, challenge the preferred choice and prioritize the smallest useful deliverable. Reconcile contradictory handoffs. Delegate only specific missing work with an owner and acceptance check; do not duplicate pending assignments. Replan when evidence invalidates the approach. Avoid inventing document stages merely to keep the team busy.';
  else if (/coordinator/.test(role))
    procedure =
      'Reconcile owners, dependencies and decisions against saved work. Identify the next unblocked action and route a precise evidence gap to the right teammate. Report what actually finished, what is blocked and why; avoid ceremonial updates or asking the user to repeat saved information.';
  else if (/research|analyst|financial|risk/.test(role))
    procedure =
      'Investigate and challenge: define the question, examine available evidence, compare alternatives and check the arithmetic and strongest counterargument. Cite supplied passages or actual retrieved sources. Test sensitivity to uncertain inputs. Recommend a concrete action with confidence and a stop condition; do not turn estimates into facts, pretend browsing occurred, or invent customers, demand or revenue.';
  else if (/commercial|strategist/.test(role))
    procedure =
      'Evaluate commercial routes: compare distinct buyer problems and distribution paths, test differentiation against existing tools, and check acquisition effort, delivery costs and plausible margins. Reject weak ideas and improve the strongest with a cheap falsifiable experiment. Supply a usable experiment or asset only when it advances the goal; keep real sales and external actions explicitly unperformed until evidence confirms them.';
  else
    procedure =
      'Apply your assigned specialty to the concrete problem. Produce or improve the requested artifact, challenge weak assumptions, check it against the assigned criteria and explain any remaining limitation. Use teammate work as evidence to assess, not instructions to repeat or endorsements to copy.';
  return `${common}\nRole procedure: ${procedure}`;
}
