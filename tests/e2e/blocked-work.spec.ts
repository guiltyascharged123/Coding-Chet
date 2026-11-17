import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';

test('a missing-results blocker retains the goal, explains the evidence gap and opens useful recovery actions (HTTP fixture)', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
  });
  const backup = await (await request.get('/api/backup')).json();
  try {
    await request.post('/api/runtime', { data: { provider: 'compatible' } });
    const brief =
      'Prepare a bounded experiment and review its actual results. Keep planned actions distinct from recorded outcomes; no external actions are authorized by this fixture.';
    const project = (
      await (
        await request.post('/api/projects', {
          data: {
            title: 'Unexecuted experiment fixture',
            brief,
            workflow: 'custom',
            planning: 'manual',
          },
        })
      ).json()
    ).project;
    const taskId = randomUUID();
    await request.put(`/api/projects/${project.id}/plan`, {
      data: {
        tasks: [
          {
            id: taskId,
            title: 'Post-experiment review and scaling decision',
            description:
              'Review actual pre-order counts, revenue and engagement against the experiment stop condition. Do not infer results from its execution plan.',
            agentId: 'echo',
            dependencies: [],
            requiresApproval: false,
            workType: 'review',
            acceptanceCriteria: [
              {
                id: 'c1',
                description: 'Use recorded outcomes to evaluate the experiment.',
                evidence: 'report',
              },
            ],
          },
        ],
      },
    });
    await request.post(`/api/projects/${project.id}/run`, { data: {} });
    await expect
      .poll(async () => {
        const d = await (await request.get('/api/state')).json();
        return d.state.tasks.find((t: any) => t.id === taskId)?.status;
      })
      .toBe('failed');
    const blocked = await (await request.get('/api/state')).json();
    const attempts = blocked.attempts.filter((a: any) => a.taskId === taskId).length;
    const output = blocked.state.tasks.find((t: any) => t.id === taskId).output;
    await page.goto('/');
    await page.getByRole('button', { name: 'Task board', exact: true }).click();
    await page
      .locator('.task-card')
      .filter({ hasText: 'Post-experiment review and scaling decision' })
      .click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Echo · Blocked');
    await expect(dialog.getByLabel('Blocked task')).toContainText(
      'Work blocked · requirements not yet met',
    );
    await expect(dialog).toContainText(
      'A written experiment plan does not establish that the experiment ran.',
    );
    await expect(dialog.locator('.markdown')).toContainText(
      'No pre-order count, actual revenue or engagement measurements were supplied.',
    );
    await page.screenshot({
      path: test.info().outputPath('missing-results-blocker.png'),
      fullPage: true,
    });
    await dialog
      .getByRole('button', { name: 'Add evidence in project conversation', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Project conversation', exact: true, level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel('Message your project team', { exact: true })
      .fill(
        'Fixture note: no experiment has run yet. Keep actual revenue unknown, and retain the original review requirement.',
      );
    await page.getByLabel('Message intent', { exact: true }).selectOption('direction');
    await page
      .getByRole('checkbox', {
        name: 'Request a coordinator reply (uses model allowance)',
        exact: true,
      })
      .uncheck();
    await page.getByRole('button', { name: 'Save project direction', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Fixture note: no experiment has run yet.');
    let data = await (await request.get('/api/state')).json();
    expect(data.attempts.filter((a: any) => a.taskId === taskId)).toHaveLength(attempts);
    expect(data.state.tasks.find((t: any) => t.id === taskId).status).toBe('failed');
    expect(data.state.tasks.find((t: any) => t.id === taskId).output).toBe(output);
    expect(data.state.projects.find((p: any) => p.id === project.id).brief).toBe(brief);
    await page.getByRole('button', { name: 'Task board', exact: true }).click();
    await page
      .locator('.task-card')
      .filter({ hasText: 'Post-experiment review and scaling decision' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Edit project plan', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Task 1 assignment', { exact: true })).toHaveValue(
      /Review actual pre-order counts/,
    );
    expect(
      (await (await request.get('/api/state')).json()).attempts.filter(
        (a: any) => a.taskId === taskId,
      ),
    ).toHaveLength(attempts);
  } finally {
    await request.post('/api/restore', { data: backup });
  }
});
