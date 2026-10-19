import type { Agent, Project, Task } from '../shared/types.js';

// Demo documents are deliberately labeled. Dates, costs, and decisions must never
// look like observed facts just because a template happens to contain them.
export function officeDocument(project: Project, task: Task, agent: Agent): string {
  const owner = agent.name;
  const documents: Record<string, string> = {
    brief: `## Executive summary

${project.brief}

## Scope and deliverables

| Deliverable | Owner | Acceptance measure |
| --- | --- | --- |
| Project brief | Team lead | Sponsor confirms scope and success measures |
| Milestone plan | Planning lead | Each milestone has an owner and dependency |
| Resource estimate | Delivery lead | Assumptions reviewed against actual quotes |
| Risk register | Delivery lead | Each high priority risk has a mitigation |
| Kickoff pack | Reviewer | Agenda and action log ready to complete |
| Status report | Team lead | Open decisions and next actions are visible |

## Boundaries

This pack covers planning documents. Purchasing, implementation, staffing commitments, and publishing require separate authorization.

## Success measures

- A named owner accepts each deliverable.
- Scope, proposed timing, and a budget ceiling are approved by the sponsor.
- Unconfirmed assumptions remain visible until checked.

## Questions for the sponsor

1. What is the actual deadline and available budget?
2. Who approves scope changes and expenditure?
3. Which requirements are mandatory for the first release?`,
    project_plan: `## Proposed delivery approach

Use the brief to confirm scope, then validate resources before starting delivery. The schedule below is relative to an agreed kickoff date; it is a proposal.

## Milestone schedule

| Milestone | Owner | Target | Dependency | Acceptance |
| --- | --- | --- | --- | --- |
| Confirm scope | Mira | Day 1 | Sponsor availability | Brief approved |
| Approve delivery plan | Sol | Day 2 | Confirmed scope | Plan and owners approved |
| Validate estimate | Atlas | Day 3 | Approved plan | Quotes and capacity checked |
| Review delivery risks | Echo | Day 4 | Resource estimate | Mitigations assigned |
| Kick off implementation | Sponsor | To be agreed | Budget approval | Team authorized to begin |

## Action register

| Action | Owner | Due | Status |
| --- | --- | --- | --- |
| Confirm deadline and budget ceiling | Sponsor | Before kickoff | Open |
| Check team availability | Mira | Day 1 | Open |
| Replace illustrative prices with actual quotes | Atlas | Day 3 | Open |
| Agree on reporting cadence | ${owner} | Day 2 | Proposed |

## Decision needed

Approve this proposed plan or request changes. Approval authorizes the next planning task in Workroom; it does not authorize purchases or real-world implementation.`,
    budget: `## Estimate basis

**Currency: USD. All figures below are illustrative planning assumptions, not quotes, actual spending, or a recommendation to purchase.** Replace quantities and unit costs with verified inputs. Taxes and vendor subscriptions are excluded.

## Budget estimate

| Item | Quantity | Unit cost | Estimated total |
| --- | --- | --- | --- |
| Discovery and planning hours | 8 | $75.00 | $600.00 |
| Design and preparation hours | 12 | $85.00 | $1020.00 |
| Delivery and implementation hours | 24 | $95.00 | $2280.00 |
| Review and documentation hours | 6 | $75.00 | $450.00 |
| Contingency allowance | 1 | $652.50 | $652.50 |

## Funding summary

Illustrative subtotal before contingency: **$4,350.00**. A 15% contingency is **$652.50**, for a proposed envelope of **$5,002.50**. No expenditure has been recorded or approved.

## Verify before use

- Confirm currency, tax treatment, labor rates, and procurement rules.
- Replace illustrative quantities with estimates from the actual task owners.
- Get sponsor approval and real quotes before any spending.
- In Excel, line totals and the total estimate recalculate when quantity or unit cost changes. The contingency allowance is a fixed editable assumption.`,
    risk_register: `## Risk register

| ID | Risk | Likelihood | Impact | Owner | Mitigation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Scope expands before delivery | Medium | High | Mira | Approve scope and record change requests | Open |
| R02 | Estimates exceed funding | Medium | High | Atlas | Validate rates and agree a budget ceiling | Open |
| R03 | Dependencies delay kickoff | Medium | Medium | Sol | Confirm owners and availability early | Open |
| R04 | Deliverables miss accessibility needs | Medium | High | Echo | Review readable text, keyboard access, and user needs | Open |

## Decision log

| ID | Decision required | Decision owner | Status | Evidence |
| --- | --- | --- | --- | --- |
| D01 | Confirm project scope | Sponsor | Pending | Approved brief required |
| D02 | Authorize budget envelope | Sponsor | Pending | Verified estimate required |
| D03 | Set delivery start date | Sponsor | Pending | Capacity confirmation required |

## Review cadence

Review risks at kickoff and weekly. Escalate a high impact risk as soon as its trigger occurs. These are starter risks to validate, not a completed assessment.`,
    meeting_minutes: `## Meeting agenda

**Template only. No meeting has taken place.** Complete the following fields during the actual kickoff.

| Field | Value |
| --- | --- |
| Project | ${project.title.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |
| Meeting date | To be scheduled |
| Chair | To be assigned |
| Attendees | To be confirmed |
| Objective | Agree scope, resources, owners, and next steps |

| Agenda item | Facilitator | Minutes allocated |
| --- | --- | --- |
| Goals and scope | Team lead | 10 |
| Milestones and dependencies | Planning lead | 10 |
| Budget and risks | Delivery lead | 10 |
| Decisions and actions | Chair | 10 |

## Minutes and action log

| Discussion or decision | Owner | Due date | Status |
| --- | --- | --- | --- |
| Record actual discussion here | To be assigned | To be agreed | Not recorded |
| Record approved decisions here | Sponsor | To be agreed | Not recorded |
| Record follow-up actions here | To be assigned | To be agreed | Not recorded |

## Before circulating

Confirm attendees, decision wording, action owners, and deadlines. Remove unused placeholder rows and obtain the chair's review.`,
    status_report: `## Executive status

**Planning pack drafted; implementation status unverified.** This report describes document readiness. It does not claim that delivery, testing, purchases, or a meeting occurred.

## Deliverable register

| Document | Readiness | Next step |
| --- | --- | --- |
| Project brief | Draft template | Validate goals and scope |
| Milestone plan | Reviewed within Workroom | Confirm real dates and capacity |
| Budget estimate | Illustrative | Obtain quotes and sponsor approval |
| Risk register | Starter assessment | Validate and assign owners |
| Kickoff pack | Blank meeting template | Schedule and conduct the meeting |

## Open decisions

- Confirm the project deadline and budget ceiling.
- Validate every assumed labor rate and quantity.
- Assign actual delivery owners and approve the start date.

## Next reporting period

| Action | Accountable owner | Target |
| --- | --- | --- |
| Review the document pack with the sponsor | Team lead | Before implementation |
| Replace placeholder estimates | Delivery lead | Before budget approval |
| Schedule the kickoff | Project coordinator | After plan approval |

## Reporting note

Use this report as a starting point. Update it with verified progress and cite evidence before sharing it as a project status record.`,
  };
  const revision = task.feedback
    ? `## Revision requested\n\n${task.feedback}\n\nThis demo records your feedback. A person must edit the template to resolve it; no model has reasoned about the change.\n\n`
    : '';
  return `# ${task.title}\n\n**${project.title}** · Prepared by ${agent.name}, ${agent.role}\n\n> Demo template — no AI model call. Validate all assumptions before use.\n\n${revision}${documents[task.documentKind || 'brief'] || documents.brief}`;
}
