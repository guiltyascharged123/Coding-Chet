import { test, expect } from './fixtures';

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
  });
  const data = await (await request.get('/api/state')).json();
  await request.post('/api/policy', {
    data: {
      ...data.state.policy,
      maxConcurrent: 1,
      maxTasks: 30,
      maxRequests24h: 1000,
      maxFormatCorrections: 1,
      maxRetrievalRounds: 2,
      localContextTokens: 32768,
    },
  });
  await request.post('/api/runtime', { data: { provider: 'compatible' } });
});
async function create(request: any, brief: string) {
  return (
    await (
      await request.post('/api/projects', {
        data: { title: 'Planner recovery case', brief, workflow: 'venture', planning: 'ai' },
      })
    ).json()
  ).project;
}
async function open(page: any, id: string) {
  await page.goto('/');
  await page.evaluate((id: string) => localStorage.setItem('workroom-project', id), id);
  await page.reload();
}

test('the reported long planner title keeps twelve editable assignments and consumes only one request', async ({
  page,
  request,
}) => {
  const project = await create(
    request,
    'E2E overlong planner title: compare supplied evidence, retain complete requirements and do not invent transactions.',
  );
  await open(page, project.id);
  await page.getByRole('button', { name: 'Edit plan · 12 tasks', exact: true }).click();
  expect(
    (await page.getByLabel('Task 2 title', { exact: true }).inputValue()).length,
  ).toBeLessThanOrEqual(100);
  expect(await page.getByLabel('Task 2 assignment', { exact: true }).inputValue()).toContain(
    'Competitive and market research: competitor analysis, acquisition effort/cost, delivery cost, unit economics, time‑to‑first‑validation',
  );
  await expect(page.getByRole('dialog')).toContainText('/ 100 characters');
  const data = await (await request.get('/api/state')).json();
  expect(data.attempts.filter((attempt: any) => attempt.projectId === project.id)).toHaveLength(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Edit plan · 12 tasks', exact: true }),
  ).toBeVisible();
});

test('rejected planner details name the field and size, survive reload, export, and inform retry', async ({
  page,
  request,
}) => {
  const project = await create(
    request,
    'E2E invalid planner details: compare supplied prices, label missing evidence, keep this original brief.',
  );
  await open(page, project.id);
  await expect(page.getByRole('alert')).toContainText('Task 1 · acceptanceCriteria.0.description');
  await expect(page.getByRole('alert')).toContainText('301 characters');
  await page.getByText('Rejected plan · saved validation details', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download rejected plan', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('rejected-plan.json');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('301 characters');
  await page.getByText('Rejected plan · saved validation details', { exact: true }).click();
  await expect(page.locator('.planning-rejection pre')).toContainText('x'.repeat(301));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: 'Retry planning', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit plan · 1 tasks', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Rejected plan · saved validation details', { exact: true }),
  ).toHaveCount(0);
  const data = await (await request.get('/api/state')).json();
  expect(data.attempts.filter((attempt: any) => attempt.projectId === project.id)).toHaveLength(3);
  expect(data.state.projects.find((value: any) => value.id === project.id).brief).toBe(
    project.brief,
  );
});

test('limits reference shows actual rules and new operational controls persist without leading zeroes', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Limits reference', exact: true }).click();
  await page.getByLabel('Search limits', { exact: true }).fill('tasks[].title');
  await expect(page.locator('.limits-reference')).toContainText('1–100 characters');
  await page.getByLabel('Search limits', { exact: true }).fill('retention');
  await expect(page.locator('.limits-reference')).toContainText('No count-based cap');
  await page.getByRole('button', { name: 'Edit economy limits', exact: true }).click();
  for (const [name, value] of [
    ['Source retrieval rounds per task', '4'],
    ['Automatic format corrections per response', '2'],
    ['Ollama context ceiling (tokens)', '65536'],
  ]) {
    const field = page.getByLabel(name, { exact: true });
    await field.fill('');
    await expect(field).toHaveValue('');
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Workspace limits saved');
  const data = await (await request.get('/api/state')).json();
  expect(data.state.policy.maxRetrievalRounds).toBe(4);
  expect(data.state.policy.maxFormatCorrections).toBe(2);
  expect(data.state.policy.localContextTokens).toBe(65536);
  await page.reload();
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  await expect(page.getByLabel('Source retrieval rounds per task', { exact: true })).toHaveValue(
    '4',
  );
  // Keep later suite cases on their declared defaults.
  await request.post('/api/policy', {
    data: {
      ...data.state.policy,
      maxRetrievalRounds: 2,
      maxFormatCorrections: 1,
      localContextTokens: 32768,
    },
  });
});

test('planning shows the real actor, request, elapsed time and validation outcome across dashboard views', async ({
  page,
  request,
}) => {
  const project = await create(
    request,
    'E2E visible model progress: compare supplied $20 and $35 costs without inventing external work.',
  );
  await open(page, project.id);
  const activity = page.getByRole('region', { name: 'Model activity', exact: true });
  await expect(activity).toContainText('Waiting for public model output');
  await expect(activity).toContainText('Mira');
  await expect(activity).toContainText('Project manager');
  await expect(activity).toContainText('timeout 15:00');
  await expect(activity).toContainText('bytes');
  await activity.getByText('Request details', { exact: true }).click();
  await expect(
    activity.getByText(/The request has been sent\. The provider has not supplied/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Task board', exact: true }).click();
  await expect(activity).toContainText('Waiting for public model output');
  await expect(activity).toContainText('Plan saved', { timeout: 10000 });
  const data = await (await request.get('/api/state')).json();
  expect(data.attempts.filter((attempt: any) => attempt.projectId === project.id)).toHaveLength(1);
});

test('a visible format correction names its purpose without showing the previous reply as new output', async ({
  page,
  request,
}) => {
  const project = await create(
    request,
    'E2E visible correction: compare supplied prices, preserve this brief, and report only evidenced work.',
  );
  await open(page, project.id);
  const activity = page.getByRole('region', { name: 'Model activity', exact: true });
  await expect(activity).toContainText('format correction');
  await expect(activity).toContainText('Waiting for public model output');
  await expect(activity.getByText('Public reply received', { exact: true })).toHaveCount(0);
  await activity.getByRole('button', { name: 'Open live console', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Project live console', exact: true }),
  ).toContainText('acceptanceCriteria.0.description');
  await expect(activity).toContainText('Plan saved', { timeout: 10000 });
  const data = await (await request.get('/api/state')).json();
  expect(data.attempts.filter((attempt: any) => attempt.projectId === project.id)).toHaveLength(2);
});
