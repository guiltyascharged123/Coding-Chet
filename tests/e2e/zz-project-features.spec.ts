import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';

async function prepare(request: any) {
  const data = await (await request.get('/api/state')).json();
  await request.post('/api/policy', {
    data: { ...data.state.policy, maxConcurrent: 1, maxTasks: 100, maxRequests24h: 300 },
  });
  await request.post('/api/runtime', { data: { provider: 'compatible' } });
}
async function savedProject(request: any, title: string) {
  await prepare(request);
  const { project } = await (
    await request.post('/api/projects', {
      data: {
        title,
        brief:
          'Compare supplied A at $20 and B at $35. Label unknown demand. No transactions are authorized.',
        workflow: 'office',
        planning: 'manual',
      },
    })
  ).json();
  const taskId = randomUUID();
  expect(
    (
      await request.put(`/api/projects/${project.id}/plan`, {
        data: {
          tasks: [
            {
              id: taskId,
              title: 'Compare supplied costs',
              description: 'Show the arithmetic and distinguish unknown demand from evidence.',
              agentId: 'mira',
              dependencies: [],
              requiresApproval: false,
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  return { project, taskId };
}
async function openProject(page: any, id: string) {
  await page.goto('/');
  await page.evaluate((id: string) => localStorage.setItem('workroom-project', id), id);
  await page.reload();
}

test('every economy number can be cleared and replaced without an inserted zero, including decimal rates', async ({
  page,
  request,
}) => {
  const { project } = await savedProject(request, 'Editable economy fields');
  await openProject(page, project.id);
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const fields = [
    ['Active tasks across the workspace', '2'],
    ['Tasks allowed per project', '40'],
    ['Revisions allowed per task', '3'],
    ['Requests in the last 24 hours', '350'],
    ['Maximum input bytes', '64000'],
    ['Maximum output tokens (API/local)', '4096'],
    ['API estimate budget, rolling 24 hours ($)', '3.25'],
    ['API estimate budget per project ($)', '2.75'],
  ];
  for (const [label, value] of fields) {
    const input = dialog.getByLabel(label, { exact: true });
    await input.fill('');
    await expect(input).toHaveValue('');
    await input.pressSequentially(value);
    await input.press('Tab');
    await expect(input).toHaveValue(value);
  }
  await dialog.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(dialog).toContainText('Workspace limits saved');
  const state = await (await request.get('/api/state')).json();
  expect(state.state.policy.maxTasks).toBe(40);
  expect(state.state.policy.dailyBudgetUsd).toBe(3.25);
  expect(state.state.policy.maxInputBytes).toBe(64000);
  const priceRow = dialog.locator('.price-row').first();
  await priceRow.getByRole('checkbox').check();
  for (const [name, value] of [
    ['inputPerMillion', '0.125'],
    ['outputPerMillion', '0.875'],
  ]) {
    const input = dialog.getByLabel(`openai ${name}`, { exact: true });
    await input.fill('');
    await expect(input).toHaveValue('');
    await input.pressSequentially(value);
    await input.press('Tab');
    await expect(input).toHaveValue(value);
  }
  await dialog.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/state')).json()).state.policy.rates.openai?.inputPerMillion,
    )
    .toBe(0.125);
});

test('the model page clearly selects the exact model used by this project without changing the new-project default', async ({
  page,
  request,
}) => {
  const { project } = await savedProject(request, 'Explicit model selection');
  await openProject(page, project.id);
  await page.getByRole('button', { name: 'Models & sign-in', exact: true }).click();
  const selection = page.getByRole('region', { name: 'Selected project model', exact: true });
  await expect(selection.locator('.selected-project-model')).toContainText(
    'workroom-browser-model',
  );
  await selection
    .getByLabel('Available project model', { exact: true })
    .selectOption('workroom-browser-model-variant');
  await expect(selection).toContainText('has not been applied');
  await selection
    .getByRole('button', { name: 'Use this model for this project', exact: true })
    .click();
  await expect(selection.locator('.selected-project-model')).toContainText(
    'workroom-browser-model-variant',
  );
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await page.getByRole('button', { name: /^(Run|Resume) team$/ }).click();
  await expect(page.getByRole('button', { name: 'View results', exact: true })).toBeVisible();
  const data = await (await request.get('/api/state')).json();
  expect(data.attempts.find((attempt: any) => attempt.projectId === project.id).model).toBe(
    'workroom-browser-model-variant',
  );
  expect(data.runtime.models.compatible).toBe('workroom-browser-model');
});

test('office and specialist selection supports eight and twelve actors, with a working board link and saved role templates', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await prepare(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill('Eight specialist office');
  await dialog
    .getByLabel('The brief')
    .fill(
      'Compare available approaches using supplied costs, actual evidence and the selected specialist team.',
    );
  await dialog.getByLabel('Task planning', { exact: true }).selectOption('manual');
  await dialog.getByLabel('Office space', { exact: true }).selectOption('8');
  await dialog.getByText('Choose 8 specialists from 20 role profiles', { exact: true }).click();
  await dialog
    .getByLabel('New project Mira specialist', { exact: true })
    .selectOption('Supervisor');
  await dialog.getByLabel('Working style', { exact: true }).selectOption('expansive');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Eight specialist office', exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.scene-agent-label')).toHaveCount(8, { timeout: 20000 });
  await page.getByRole('button', { name: 'Your team', exact: true }).click();
  await page.getByRole('button', { name: 'Choose office & specialists', exact: true }).click();
  await page.getByLabel('Office space', { exact: true }).selectOption('12');
  await page
    .getByLabel('Aria specialist', { exact: true })
    .selectOption('Senior technical architect');
  await page.getByRole('button', { name: 'Save office and team', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Office and specialists' })).toContainText(
    '12-desk office',
  );
  await page.getByRole('button', { name: 'Choose office & specialists', exact: true }).click();
  await expect(page.getByLabel('Office space', { exact: true })).toHaveValue('12');
  await expect(page.getByLabel('Aria specialist', { exact: true })).toHaveValue(
    'Senior technical architect',
  );
  await page.getByRole('button', { name: 'Close team setup', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.scene-agent-label')).toHaveCount(12, { timeout: 20000 });
  await page.screenshot({ path: '/tmp/workroom-headquarters-12.png', fullPage: true });
  await page.getByRole('button', { name: 'Open idea board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project idea board', exact: true })).toBeVisible();
  const data = await (await request.get('/api/state')).json();
  const project = data.state.projects.find((p: any) => p.title === 'Eight specialist office');
  expect(project.team).toHaveLength(12);
  expect(project.team[0].role).toBe('Supervisor');
  expect(project.exploration).toBe('expansive');
  expect(project.officeCapacity).toBe(12);
});

test('fresh restart keeps the previous results and creates a clean independent plan', async ({
  page,
  request,
}) => {
  const { project } = await savedProject(request, 'Restartable source project');
  await openProject(page, project.id);
  await page.getByRole('button', { name: /^(Run|Resume) team$/ }).click();
  await expect(page.getByRole('button', { name: 'View results', exact: true })).toBeVisible();
  const before = await (await request.get('/api/state')).json();
  await page.getByRole('button', { name: 'Restart project', exact: true }).click();
  await page.getByLabel('New run name', { exact: true }).fill('Clean restarted office');
  await page.getByLabel('Restart starting plan', { exact: true }).selectOption('reuse');
  await page.getByRole('button', { name: 'Create fresh run', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Clean restarted office', exact: true }),
  ).toBeVisible();
  const after = await (await request.get('/api/state')).json();
  const fresh = after.state.projects.find((p: any) => p.title === 'Clean restarted office');
  expect(fresh.restartedFrom).toBe(project.id);
  expect(after.state.tasks.find((t: any) => t.projectId === fresh.id).output).toBe('');
  expect(after.state.tasks.find((t: any) => t.projectId === project.id).output).toContain(
    'Cost comparison',
  );
  expect(after.attempts.length).toBe(before.attempts.length);
  await page.getByRole('button', { name: 'Open previous run', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Restartable source project', exact: true }),
  ).toBeVisible();
});

test('project conversation and the idea board execute real model assignments and retain source links', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { project, taskId } = await savedProject(request, 'Conversation and board workspace');
  await openProject(page, project.id);
  await page.getByRole('button', { name: 'Project conversation', exact: true }).click();
  await page
    .getByLabel('Message your project team', { exact: true })
    .fill('Explain the supplied cost difference and what remains unverified.');
  await page.getByRole('button', { name: 'Send to coordinator', exact: true }).click();
  await expect(page.locator('.project-chat-reply')).toContainText('Cost comparison');
  let data = await (await request.get('/api/state')).json();
  expect(data.state.projects.find((p: any) => p.id === project.id).status).toBe('paused');
  expect(data.state.tasks.find((t: any) => t.id === taskId).status).toBe('queued');
  await page.getByRole('button', { name: 'Idea board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Project idea board', exact: true });
  await board.getByRole('button', { name: 'Ask specialist for proposals', exact: true }).click();
  await expect(board.locator('.idea-card')).toHaveCount(1);
  await board.getByRole('button', { name: 'Select approach', exact: true }).click();
  await expect(board.locator('.idea-card')).toContainText('selected');
  await board.getByRole('button', { name: 'Investigate · uses model', exact: true }).click();
  await expect(board.locator('.idea-evaluation')).toBeVisible();
  await expect(board.locator('.idea-card .tag')).toHaveText('selected');
  await board.getByRole('button', { name: 'Source task', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Respond to project conversation');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Idea board', exact: true }).click();
  await expect(page.locator('.idea-card')).toHaveCount(1);
  data = await (await request.get('/api/state')).json();
  expect(
    data.state.ideas.find((idea: any) => idea.projectId === project.id).investigationTaskId,
  ).toBeTruthy();
});
