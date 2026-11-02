import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  // These checks exercise data and recovery, independent of software-rendered 3D startup.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: any,
      ...args: any[]
    ) {
      if (String(type).includes('webgl')) return null;
      return (original as any).call(this, type, ...args);
    } as any;
  });
});
async function project(
  request: any,
  title: string,
  planning = 'manual',
  brief = 'Compare supplied office costs A at $20 and B at $35; label customer demand unknown.',
) {
  const state = await (await request.get('/api/state')).json();
  await request.post('/api/policy', {
    data: { ...state.state.policy, maxRequests24h: 1000, maxTasks: 100, maxConcurrent: 1 },
  });
  await request.post('/api/runtime', { data: { provider: 'compatible' } });
  return (
    await (
      await request.post('/api/projects', { data: { title, brief, workflow: 'office', planning } })
    ).json()
  ).project;
}
async function open(page: any, id: string) {
  await page.goto('/');
  await page.evaluate((id: string) => localStorage.setItem('workroom-project', id), id);
  await page.reload();
}

test('a second browser editor cannot silently delete a newer saved assignment', async ({
  page,
  request,
}) => {
  const p = await project(request, 'Concurrent plan protection');
  const task = {
    id: randomUUID(),
    title: 'Original assignment',
    description: 'Compare the supplied costs and check the arithmetic.',
    agentId: 'mira',
    dependencies: [],
    requiresApproval: false,
  };
  expect((await request.put(`/api/projects/${p.id}/plan`, { data: { tasks: [task] } })).ok()).toBe(
    true,
  );
  await open(page, p.id);
  await page.getByRole('button', { name: 'Edit plan · 1 tasks', exact: true }).click();
  const other = await page.context().newPage();
  await open(other, p.id);
  await other.getByRole('button', { name: 'Edit plan · 1 tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByLabel('Task 2 title', { exact: true }).fill('Keep this newly saved task');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await other.getByLabel('Task 1 title', { exact: true }).fill('Second tab draft');
  await other.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('changed since this draft');
  await expect(other.getByLabel('Task 1 title', { exact: true })).toHaveValue('Second tab draft');
  const state = await (await request.get('/api/state')).json();
  expect(state.state.tasks.filter((task: any) => task.projectId === p.id)).toHaveLength(2);
  expect(state.state.tasks.some((task: any) => task.title === 'Keep this newly saved task')).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Edit plan · 2 tasks', exact: true }).click();
  await page.getByText('Saved plan versions', { exact: true }).click();
  await page.getByRole('button', { name: 'Load saved plan versions', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Keep this newly saved task');
  await other.close();
});

test('a failed planner can answer a project question and then retry the original saved brief', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const p = await project(
    request,
    'Recover planning after conversation',
    'ai',
    'E2E planning recovery: compare supplied office costs and produce useful evidence-based assignments.',
  );
  await expect
    .poll(async () => {
      const data = await (await request.get('/api/state')).json();
      return data.state.projects.find((project: any) => project.id === p.id).planningStatus;
    })
    .toBe('failed');
  let data = await (await request.get('/api/state')).json();
  for (const receipt of data.attempts.filter(
    (attempt: any) => attempt.projectId === p.id && attempt.status === 'uncertain',
  ))
    await request.post(`/api/attempts/${receipt.id}/acknowledge`, { data: {} });
  await open(page, p.id);
  await page.getByRole('button', { name: 'Project conversation', exact: true }).click();
  await page
    .getByLabel('Message your project team', { exact: true })
    .fill('Explain the supplied arithmetic before retrying planning.');
  await page.getByRole('button', { name: 'Send to coordinator', exact: true }).click();
  await expect(page.locator('.project-chat-reply')).toContainText('Cost comparison');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Retry planning', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit plan · 2 tasks', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Project conversation', exact: true }).click();
  await expect(page.locator('.project-chat-reply')).toContainText('Cost comparison');
});

test('an unpaired local client cannot obtain a session or read controls; a paired browser can reload normally', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
  });
  try {
    for (const path of ['/api/session', '/api/state', '/api/backup', '/api/connections/settings'])
      expect((await context.request.get(`http://127.0.0.1:3107${path}`)).status()).toBe(401);
    expect(
      (
        await context.request.post('http://127.0.0.1:3107/api/policy', {
          data: { maxConcurrent: 4 },
        })
      ).status(),
    ).toBe(401);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3107');
    await expect(
      page.getByRole('heading', { name: 'Connect this browser', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Browser connection code', { exact: true }).fill('b'.repeat(64));
    await page.getByRole('button', { name: 'Connect browser', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
    expect((await context.request.get('http://127.0.0.1:3107/api/state')).ok()).toBe(true);
  } finally {
    await context.close();
  }
});

test('receipt and conversation pagination keep old blockers and messages usable after newer work', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const initial = await (await request.get('/api/state')).json();
  // Previous runner scenarios leave pending projects; this receipt belongs only to this case.
  for (const project of initial.state.projects)
    if (['running', 'needs_input'].includes(project.status))
      expect((await request.post(`/api/projects/${project.id}/pause`, { data: {} })).ok()).toBe(
        true,
      );
  await request.post('/api/policy', {
    data: { ...initial.state.policy, maxRequests24h: 1000, maxTasks: 100, maxConcurrent: 1 },
  });
  await request.post('/api/runtime', { data: { provider: 'external' } });
  const old = (
    await (
      await request.post('/api/projects', {
        data: {
          title: 'Older external recovery',
          brief: 'Compare supplied A at $20 and B at $35. Keep unknown demand explicit.',
          workflow: 'office',
          planning: 'manual',
        },
      })
    ).json()
  ).project;
  const taskId = randomUUID();
  await request.put(`/api/projects/${old.id}/plan`, {
    data: {
      tasks: [
        {
          id: taskId,
          title: 'Saved external assignment',
          description: 'Compare the supplied figures and report evidence.',
          agentId: 'mira',
          dependencies: [],
          requiresApproval: false,
        },
      ],
    },
  });
  await request.post(`/api/projects/${old.id}/run`, { data: {} });
  const assignment = (
    await (
      await request.post('/api/runner/claim', {
        data: { agentId: 'mira' },
        headers: { Authorization: 'Bearer browser-test-token-not-a-real-secret' },
      })
    ).json()
  ).assignment;
  expect(assignment.task.id).toBe(taskId);
  await request.post(`/api/runner/tasks/${assignment.task.id}/fail`, {
    data: {
      leaseId: assignment.task.leaseId,
      error: 'Fixture interruption; preserve this uncertain receipt.',
    },
    headers: { Authorization: 'Bearer browser-test-token-not-a-real-secret' },
  });
  const newer = await project(request, 'Newer coordinator replies');
  for (let i = 0; i < 55; i++)
    expect(
      (
        await request.post(`/api/projects/${newer.id}/messages`, {
          data: {
            id: randomUUID(),
            content: `Newer question ${i}: compare supplied costs honestly.`,
            askCoordinator: true,
            kind: 'question',
          },
        })
      ).ok(),
    ).toBe(true);
  await expect
    .poll(
      async () => {
        const data = await (await request.get('/api/state')).json();
        return data.state.tasks.filter(
          (task: any) =>
            task.projectId === newer.id && task.conversationMessageId && task.status === 'done',
        ).length;
      },
      { timeout: 60000 },
    )
    .toBe(55);
  for (let i = 0; i < 65; i++)
    await request.post(`/api/projects/${newer.id}/messages`, {
      data: {
        id: randomUUID(),
        content: `Archived note ${i}`,
        askCoordinator: false,
        kind: 'question',
      },
    });
  await open(page, newer.id);
  await page.getByRole('button', { name: 'Project conversation', exact: true }).click();
  await expect(
    page.getByText('Newer question 0: compare supplied costs honestly.', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
  await expect(
    page.getByText('Newer question 0: compare supplied costs honestly.', { exact: true }),
  ).toBeVisible();
  await open(page, old.id);
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('The worker reported failure');
  await page.getByRole('button', { name: 'Acknowledge uncertain usage', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Acknowledge uncertain usage', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Receipt status', { exact: true }).selectOption('');
  await page.getByRole('checkbox', { name: 'Only this project', exact: true }).uncheck();
  await expect(
    page.getByRole('button', { name: 'Load older receipts', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load older receipts', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Older external recovery');
});

test('a specialist meeting assigns a visible task check that resolves only when the work completes', async ({
  page,
  request,
}) => {
  const p = await project(request, 'Tracked specialist actions');
  const taskId = randomUUID();
  expect(
    (
      await request.put(`/api/projects/${p.id}/plan`, {
        data: {
          tasks: [
            {
              id: taskId,
              title: 'Compare supplied costs and gaps',
              description: 'Compare the supplied $20 and $35 prices; label buyer demand unknown.',
              agentId: 'mira',
              dependencies: [],
              requiresApproval: false,
              workType: 'plan',
              acceptanceCriteria: [
                {
                  id: 'cost',
                  description: 'Calculate the supplied price difference.',
                  evidence: 'report',
                },
              ],
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  await open(page, p.id);
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  const participants = page
    .getByRole('group', { name: 'Meeting participants', exact: true })
    .getByRole('checkbox');
  await expect(participants).toHaveCount(4);
  await participants.nth(2).uncheck();
  await participants.nth(3).uncheck();
  await page
    .getByLabel('Meeting agenda', { exact: true })
    .fill('Compare the supplied prices and keep missing buyer evidence explicit.');
  await page.getByRole('button', { name: 'Start team meeting', exact: true }).click();
  await expect(page.locator('.meeting-record .eyebrow')).toContainText('manual · completed', {
    timeout: 20000,
  });
  await expect(page.locator('.meeting-contribution')).toHaveCount(2);
  await expect(page.locator('.meeting-actions')).toContainText('Assigned check');
  const state = await (await request.get('/api/state')).json(),
    meeting = state.state.meetings.find((meeting: any) => meeting.projectId === p.id);
  expect(meeting.participants).toHaveLength(2);
  expect(state.attempts.filter((attempt: any) => attempt.meetingId === meeting.id)).toHaveLength(3);
  expect(meeting.actions[0].status).toBe('assigned');
  await page
    .getByRole('button', { name: 'Open assignment: Compare supplied costs and gaps', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Compare supplied costs and gaps');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: /^(Run|Resume) team$/ }).click();
  await expect(page.locator('.meeting-actions')).toContainText('Reported check met');
  await expect(page.locator('.meeting-actions')).toContainText('Saved evidence:');
  await page.reload();
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  await expect(page.locator('.meeting-actions')).toContainText('Reported check met');
});
