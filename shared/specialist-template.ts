import type { Agent, Project, Task } from './types.js';
import { SPECIALIST_METHODS } from './role-protocol.js';

/** Public working instructions, not private reasoning or a fabricated agent transcript. */
export function specialistTemplate(
  project: Pick<Project, 'exploration'>,
  agent: Pick<Agent, 'role'>,
  task: Pick<Task, 'workType'>,
) {
  const role = agent.role.toLowerCase();
  const method =
    task.workType === 'review' || /review|quality|test/.test(role)
      ? {
          lens: 'Independent falsification',
          action:
            'Find the strongest counterexample, inspect original evidence, and test the weakest assumption. Check an unconventional idea on its mechanism, not familiarity.',
          check:
            'Quote the exact passage you challenge, then identify a reproducible defect or unsupported claim and the smallest correction. Check that your criticism follows from that passage; never attribute unseen content to an author or certify claims without checking.',
        }
      : /engineer|developer|architect|automation/.test(role)
        ? {
            lens: 'Constructive experiment',
            action:
              'Compare a direct implementation with a reused module and one cross-domain mechanism. Build the smallest experiment that distinguishes them when tools permit.',
            check:
              'Measure actual behavior, integration failures and resource cost. Keep useful modules with reproducible usage and tests.',
          }
        : /analyst|financial|risk|procurement/.test(role)
          ? {
              lens: 'Quantitative challenge',
              action:
                'Look for an overlooked constraint, threshold, resource trade or asymmetric opportunity. Calculate a baseline and an adverse case using supplied inputs.',
              check:
                'State units, provenance and sensitivity. Unknown numbers stay unknown; propose the observation that would change the decision.',
            }
          : /research|commercial|strategist/.test(role)
            ? {
                lens: 'Mechanism discovery',
                action:
                  'Reframe the objective, invert one assumption and borrow a mechanism from another field. Compare materially different causal routes, including a cheap direct baseline.',
                check:
                  'Identify the strongest disconfirming evidence and cheapest useful test. Novel wording or invented demand is not a new mechanism.',
              }
            : /product|ux|customer|communications|writer/.test(role)
              ? {
                  lens: 'User-centered reframing',
                  action:
                    'Question the assumed user journey and borrow a useful interaction from another domain. Produce a concrete artifact or experiment that removes the central friction.',
                  check:
                    'Walk through a representative user case and a failure case. Explain the benefit using observed evidence rather than taste.',
                }
              : {
                  lens: 'Adaptive coordination',
                  action:
                    'Reframe the goal as an observable outcome. Compare distinct mechanisms, route one precise gap to the best specialist, and seek independent challenge before scaling.',
                  check:
                    'Reconcile results with the goal. Stop duplicate work, change route after disproof and retain useful partial progress.',
                };
  return {
    version: '1.0',
    specialist: agent.role,
    specialistMethod:
      task.workType === 'review'
        ? 'Compare the actual artifact with its original assignment and supplied evidence. Quote the passage challenged; distinguish reproducible defects, unsupported claims and missing evidence. Do not infer unseen contents from a title, status or role.'
        : SPECIALIST_METHODS[agent.role] ||
          'Apply the assigned specialty to the actual evidence and acceptance criteria.',
    deliveryRule:
      'The current assignment takes priority over exploration methods. Put the concrete answer, equation, table, code or findings inside deliverable itself, never a description or promise of that artifact. Search labels such as "cross-domain hybrid" are not mechanisms: describe the causal steps. For a small closed question, answer it directly and stop; omit unrelated ideas and process improvements.',
    mode: project.exploration === 'expansive' ? 'creative-experiment' : 'focused-delivery',
    ...method,
    ...(project.exploration !== 'expansive' && method.lens === 'Quantitative challenge'
      ? {
          action:
            'Compute the assigned quantities using the exact labels, units and supplied inputs. Show the actual operation and result. Do not add hypothetical scenarios, value judgments or new quantities unless requested.',
          check:
            'Verify the mapping of each input label before calculating. Check the sign, units and what the result actually establishes; a price difference does not establish service value or quality.',
        }
      : {}),
    loop:
      project.exploration === 'expansive'
        ? 'Frame → invent different mechanisms → challenge → run a bounded test → retain evidence → adapt. Use only the steps needed for this assignment; do not turn them into mandatory reports or meetings.'
        : 'Use the simplest useful mechanism. Apply this method internally to the task; it is not a required report outline. Do not narrate template compliance or restate the assignment.',
    handoff:
      'Return the actual work and checks. Use named followUps for a missing specialty. Record reusable approaches in ideas with a test and stop condition; cite saved sources. Human input is for missing authority or a consequential choice.',
  };
}
