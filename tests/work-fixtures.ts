import type { WorkResult } from '../shared/work.js';

export function result(overrides: Partial<WorkResult> = {}): WorkResult {
  return {
    outcome: 'complete',
    summary: 'Produced the requested comparison and labeled the remaining assumptions.',
    deliverable:
      '# Comparison\n\nThe supplied figures show option A costs $20 and option B costs $35. Option A saves $15; customer demand remains unverified.',
    checks: [
      {
        criterion: 'Compare the supplied costs correctly',
        status: 'met',
        evidence: '$35 minus $20 equals $15; no demand claim is made.',
      },
    ],
    handoff: {
      facts: ['Supplied costs: A $20, B $35.'],
      assumptions: ['Demand has not been validated.'],
      next: 'Have the independent reviewer check the calculation and scope.',
    },
    decision: null,
    followUps: [],
    improvements: [],
    ...overrides,
  };
}
export function meetingResult(input: any, chair: boolean, label = 'Evidence-based decision') {
  return chair
    ? {
        decision: `${label}: compare a specific buyer alternative before spending.`,
        rationale:
          'A test of willingness to pay is more useful than producing unrequested sales documents.',
        dissent: 'Demand remains unverified; no interviews were conducted.',
        evidenceGaps: 'No buyer evidence or verified conversion data has been supplied.',
        actions: [
          {
            taskId: input.plannedWork?.[0]?.taskId || 'next-project',
            action:
              'Compare buyer alternatives, define a falsifiable experiment and report what evidence remains missing.',
          },
        ],
      }
    : {
        proposal: `${label}: test a specific buyer problem before building.`,
        rationale: 'A specific costly problem needs evidence of willingness to pay.',
        objection: 'Generic AI copywriting may have no advantage over ChatGPT.',
        alternative: 'Compare a workflow integration that saves measurable operating time.',
        evidenceGaps: 'Customer access and demand are still unverified.',
        nextAction: 'Assign the strategist to compare alternatives against the saved constraints.',
      };
}
