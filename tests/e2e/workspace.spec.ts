import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test('workspace limits, verified memory, backup downloads and validated restore work in the browser', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Enable separately billed API requests')).not.toBeChecked();
  await expect(dialog.getByLabel('Active tasks across the workspace')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('limits saved');
  await dialog.getByRole('tab', { name: 'Project memory', exact: true }).click();
  await dialog.getByLabel('Memory content').fill('The office budget requires human approval.');
  await dialog.getByRole('button', { name: 'Propose memory', exact: true }).click();
  await expect(dialog).toContainText('Awaiting your verification');
  await dialog.getByRole('button', { name: 'Verify memory', exact: true }).click();
  await expect(dialog).toContainText('Verified by you');
  await dialog.getByRole('tab', { name: 'Backup & restore', exact: true }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  const file = await pending,
    backup = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(backup.version).toBe(2);
  expect(backup.state.memory[0].status).toBe('verified');
  const invalid = structuredClone(backup);
  invalid.state.agents[0].desk = invalid.state.agents[1].desk;
  expect((await request.post('/api/restore', { data: invalid })).status()).toBe(400);
  await dialog.getByLabel('Workspace backup file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await dialog.getByLabel('I understand this replaces the current projects and documents.').check();
  await dialog.getByRole('button', { name: 'Restore workspace backup', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Workspace restored');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a project runs through revision, human approval, outputs, and persistent reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Good work starts with a little space.' }),
  ).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.scene-agent-label')).toHaveCount(4);
  await page.getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await page.getByRole('button', { name: 'Run team', exact: true }).click();
  await page.getByRole('button', { name: 'Pause team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume team', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume team', exact: true }).click();
  await page.getByRole('button', { name: 'Review work', exact: true }).click({ timeout: 15000 });
  await expect(page.getByRole('dialog')).toContainText('Recommended creative direction');
  await page
    .getByLabel('Your feedback')
    .fill('Use a more playful accent color while preserving accessible contrast.');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Review work', exact: true }).click({ timeout: 15000 });
  await expect(page.getByRole('dialog')).toContainText('Use a more playful accent color');
  await page.getByRole('button', { name: 'Approve & continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All done', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: /^Outputs/ }).click();
  await expect(page.locator('.output-card')).toHaveCount(6);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sunday-coffee-handoff.docx');
  const word = unzipSync(await readFile((await download.path())!));
  expect(strFromU8(word['word/document.xml'])).toContain('Set the direction');
  await page.reload();
  await expect(page.getByRole('button', { name: 'All done', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the studio stays usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(`
    const originalContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return originalContext.call(this, type, ...args);
    };
  `);
  await page.goto('/');
  await expect(page.locator('.office-fallback')).toBeVisible();
  await expect(page.locator('.fallback-desks button')).toHaveCount(4);
  await page.locator('.fallback-desks button').first().click();
  await expect(page.getByRole('dialog')).toContainText('Your studio teammate');
});

test('project creation, role assignment, desk swapping, and mobile navigation work', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('A small independent bookstore');
  await page
    .getByLabel('The brief')
    .fill(
      'Create a welcoming website and a practical launch plan for a neighborhood bookstore with accessible event discovery.',
    );
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A small independent bookstore', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Your team', exact: true }).click();
  await page
    .locator('.team-profile')
    .filter({ hasText: 'Mira' })
    .getByRole('button', { name: 'Edit role & desk' })
    .click();
  await page.getByLabel('Role', { exact: true }).fill('Research lead');
  await page.getByLabel('A place in the studio').selectOption('1');
  await page.getByRole('button', { name: 'Save teammate' }).click();
  await expect(page.locator('.team-profile').filter({ hasText: 'Mira' })).toContainText(
    'Research lead',
  );
  await expect(page.locator('.team-profile').filter({ hasText: 'Mira' })).toContainText('DESK 02');
  await expect(page.locator('.team-profile').filter({ hasText: 'Sol' })).toContainText('DESK 01');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run team', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Demo runtime No API key needed', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('External workers');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
});

test('runner endpoints require authentication and enforce leases', async ({ request }) => {
  expect((await request.post('/api/runner/claim', { data: {} })).status()).toBe(401);
  const headers = { Authorization: 'Bearer browser-test-token-not-a-real-secret' };
  expect((await request.post('/api/runner/claim', { headers, data: {} })).status()).toBe(200);
  expect((await request.post('/api/runtime', { data: { provider: 'external' } })).status()).toBe(
    200,
  );
  const { project } = await (
    await request.post('/api/projects', {
      data: {
        title: 'Runner integration',
        brief: 'Check external worker planning and review through the authenticated runner API.',
        documentPack: 'studio',
      },
    })
  ).json();
  await request.post(`/api/projects/${project.id}/run`);
  const { assignment } = await (
    await request.post('/api/runner/claim', { headers, data: {} })
  ).json();
  expect(assignment.task.title).toBe('Set the direction');
  expect(
    (
      await request.post(`/api/runner/tasks/${assignment.task.id}/complete`, {
        headers,
        data: { leaseId: '00000000-0000-4000-8000-000000000000', output: '# Unauthorized lease' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/runner/tasks/${assignment.task.id}/complete`, {
        headers,
        data: {
          leaseId: assignment.task.leaseId,
          output: '# External task completed through the authenticated API',
        },
      })
    ).status(),
  ).toBe(200);
  const after = await (await request.get('/api/state')).json();
  expect(after.state.tasks.find((t: { id: string }) => t.id === assignment.task.id).status).toBe(
    'done',
  );
  // Exercise the actual bridge, without model credentials or paid calls.
  const worker = spawn(process.execPath, ['examples/external-worker.mjs'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      WORKSPACE_URL: 'http://127.0.0.1:3107',
      RUNNER_TOKEN: 'browser-test-token-not-a-real-secret',
      AGENT_ID: 'sol',
      OPENAI_API_KEY: '',
    },
  });
  try {
    await expect
      .poll(
        async () => {
          const current = await (await request.get('/api/state')).json();
          return current.state.tasks.find(
            (t: { projectId: string; agentId: string }) =>
              t.projectId === project.id && t.agentId === 'sol',
          ).status;
        },
        { timeout: 15000 },
      )
      .toBe('review');
    const completed = await (await request.get('/api/state')).json();
    const output = completed.state.tasks.find(
      (t: { projectId: string; status: string }) =>
        t.projectId === project.id && t.status === 'review',
    ).output;
    expect(output).toContain('External worker connected successfully.');
    expect(output).toContain('Sample output — no model call was made.');
  } finally {
    worker.kill('SIGTERM');
  }
});

test('walking agents, readable surfaces, office documents, and native exports work together', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await request.post('/api/runtime', { data: { provider: 'demo' } });
  await page.goto('/');
  await expect(page.locator('.scene-agent-label')).toHaveCount(4);
  const initial = await page.locator('.scene-agent-label').evaluateAll((labels) =>
    labels.map((label) => ({
      id: (label as HTMLElement).dataset.agentId,
      x: Number((label as HTMLElement).dataset.x),
      z: Number((label as HTMLElement).dataset.z),
    })),
  );
  await expect
    .poll(async () => page.locator('.scene-agent-label[data-walking="true"]').count(), {
      timeout: 20000,
    })
    .toBe(0);
  await page.getByRole('button', { name: 'Pause office movement', exact: true }).click();
  await expect(page.locator('.scene-agent-label[data-walking="true"]')).toHaveCount(0);
  const paused = await page
    .locator('.scene-agent-label')
    .evaluateAll((labels) =>
      labels.map((label) => [(label as HTMLElement).dataset.x, (label as HTMLElement).dataset.z]),
    );
  await page.waitForTimeout(400);
  expect(
    await page
      .locator('.scene-agent-label')
      .evaluateAll((labels) =>
        labels.map((label) => [(label as HTMLElement).dataset.x, (label as HTMLElement).dataset.z]),
      ),
  ).toEqual(paused);
  await page.getByRole('button', { name: 'Resume office movement', exact: true }).click();
  expect(
    await page
      .locator('.page-heading p')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
    'dark',
  );
  // Legacy office packs remain exportable; new projects use purpose-driven plans.
  const created = await request.post('/api/projects', {
    data: {
      title: 'Operations planning',
      brief:
        'Prepare a practical office planning pack for a small team moving into a shared workspace. Identify assumptions, budget needs, owners, and next steps.',
      documentPack: 'office',
    },
  });
  const { project: officeProject } = await created.json();
  await page.evaluate((id) => localStorage.setItem('workroom-project', id), officeProject.id);
  await page.reload();
  await page.getByRole('button', { name: 'Run team', exact: true }).click();
  await page.getByRole('button', { name: 'Review work', exact: true }).click({ timeout: 15000 });
  await expect(page.getByRole('dialog')).toContainText('Milestone schedule');
  await page.getByRole('button', { name: 'Approve & continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All done', exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: /^Outputs/ }).click();
  await expect(page.locator('.output-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Read Budget & resource estimate', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('illustrative planning assumptions');
  let pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download document', exact: true }).click();
  let file = await pendingDownload;
  expect(file.suggestedFilename()).toBe('budget-resource-estimate.docx');
  const word = unzipSync(await readFile((await file.path())!));
  expect(strFromU8(word['word/document.xml'])).toContain('Budget estimate');
  await dialog.getByLabel('Download format').selectOption('xlsx');
  pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download document', exact: true }).click();
  file = await pendingDownload;
  expect(file.suggestedFilename()).toBe('budget-resource-estimate.xlsx');
  const book = unzipSync(await readFile((await file.path())!));
  expect(strFromU8(book['xl/worksheets/sheet2.xml'])).toContain('<f>B2*C2</f>');
  expect(strFromU8(book['xl/worksheets/sheet2.xml'])).toContain('<f>SUM(D2:D6)</f>');
  await dialog.getByLabel('Download format').selectOption('md');
  pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download document', exact: true }).click();
  file = await pendingDownload;
  expect(await readFile((await file.path())!, 'utf8')).toContain(
    'Demo template — no AI model call',
  );
  await dialog.getByRole('button', { name: 'Print / PDF', exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Print document"]')
      .getByRole('heading', { name: 'Budget estimate', exact: true }),
  ).toHaveText('Budget estimate');
  await expect(page.frameLocator('iframe[title="Print document"]').locator('table')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Demo runtime No API key needed', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'You do not need to build four separate AIs',
  );
  await expect(page.getByRole('dialog')).toContainText('API key');
  expect(errors).toEqual([]);
});

test('brief drafts survive close and reload, and a lost create response cannot duplicate a project', async ({
  page,
  request,
}) => {
  await request.post('/api/runtime', { data: { provider: 'demo' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Durable user brief');
  const brief =
    'Create a useful action plan from supplied constraints; retain this complete brief if planning or the network fails.';
  await page.getByLabel('The brief').fill(brief);
  await page.getByLabel('Team & workflow').selectOption('custom');
  await page.getByRole('button', { name: 'Save for later', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByLabel('The brief')).toHaveValue(brief);
  let submissions = 0;
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions++;
    if (submissions === 1) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is retained');
  await expect(page.getByLabel('The brief')).toHaveValue(brief);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Durable user brief', exact: true }),
  ).toBeVisible();
  const state = (await (await request.get('/api/state')).json()).state;
  expect(
    state.projects.filter((p: { title: string }) => p.title === 'Durable user brief'),
  ).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('workroom-project-draft-v1'))).toBe(null);
  await page.getByText('Saved project brief', { exact: true }).click();
  await expect(page.locator('.saved-brief')).toContainText(brief);
  await page.getByRole('button', { name: 'Edit plan · 1 tasks', exact: true }).click();
  await page.getByLabel('Task 1 title').fill('A purposeful assignment');
  for (let i = 0; i < 6; i++)
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit plan · 7 tasks', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Task board', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(7);
  await expect(page.locator('.task-card').first()).toContainText('A purposeful assignment');
});

test('failed AI planning remains visible after reload and retries the saved project after usage review', async ({
  page,
  request,
}) => {
  await request.post('/api/runtime', { data: { provider: 'compatible' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Recover a failed plan');
  const brief =
    'E2E planning recovery: preserve this brief and prepare only the useful deliverable requested by the user.';
  await page.getByLabel('The brief').fill(brief);
  await page.getByLabel('Task planning').selectOption('ai');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry planning', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.planning-banner')).toContainText('Your project and brief are saved');
  await expect(page.getByRole('button', { name: 'Resume team', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review usage', exact: true }).click();
  const usage = page.getByRole('dialog');
  await expect(usage.getByRole('tab', { name: 'Usage', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await usage
    .locator('.usage-list article')
    .filter({ hasText: 'Recover a failed plan' })
    .getByRole('button', { name: /Acknowledge/ })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Retry planning', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit plan · 2 tasks', exact: true }),
  ).toBeVisible();
  const state = (await (await request.get('/api/state')).json()).state;
  expect(
    state.projects.filter((p: { title: string }) => p.title === 'Recover a failed plan'),
  ).toHaveLength(1);
  expect(
    state.projects.find((p: { title: string }) => p.title === 'Recover a failed plan').brief,
  ).toBe(brief);
  await page.getByRole('button', { name: 'Server connected', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Coding tools');
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No model was run');
});

test('software projects expose actual source files and ZIPs, project roles, and a saved network choice', async ({
  page,
  request,
}) => {
  await request.post('/api/runtime', { data: { provider: 'demo' } });
  const created = await request.post('/api/projects', {
    data: {
      title: 'Browser source workspace',
      brief: 'Build a local utility and review and test its actual source files.',
      workflow: 'software',
    },
  });
  const { project } = await created.json();
  const { folder } = await (await request.get(`/api/projects/${project.id}/files`)).json();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${folder}/index.js`, 'export const actualSource = true;');
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('workroom-project', id), project.id);
  await page.reload();
  await page.getByRole('button', { name: 'Your team', exact: true }).click();
  await expect(page.locator('.team-grid')).toContainText('Implementation engineer');
  await expect(page.locator('.team-grid')).toContainText('Code reviewer');
  await page.getByRole('button', { name: 'Edit plan · 5 tasks', exact: true }).click();
  await page.getByLabel('Allow tool network for this project', { exact: false }).check();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await page.getByRole('button', { name: /^Outputs/ }).click();
  await page.getByRole('button', { name: /index.js/ }).click();
  await expect(page.locator('.file-preview')).toContainText('export const actualSource = true;');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source ZIP', exact: true }).click();
  const download = await pending;
  expect(strFromU8(unzipSync(await readFile((await download.path())!))['index.js'])).toBe(
    'export const actualSource = true;',
  );
  const state = (await (await request.get('/api/state')).json()).state;
  expect(state.projects.find((p: { id: string }) => p.id === project.id).toolNetwork).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an empty normal workspace welcomes the user and creates a real saved project', async ({
  page,
  request,
}) => {
  const backup = await (await request.get('/api/backup')).json();
  const empty = structuredClone(backup);
  empty.state.projects = [];
  empty.state.tasks = [];
  empty.state.activities = [];
  empty.state.approvals = [];
  empty.state.memory = [];
  expect((await request.post('/api/restore', { data: empty })).ok()).toBe(true);
  try {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your workspace is ready.', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name').fill('First meaningful project');
    await page
      .getByLabel('The brief')
      .fill(
        'Coordinate an actual project from supplied constraints, with a useful result and user decisions.',
      );
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'First meaningful project', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Edit plan · 4 tasks', exact: true }),
    ).toBeVisible();
  } finally {
    await request.post('/api/restore', { data: backup });
  }
});

test('review feedback and memory drafts survive rejection, settings navigation and a reload', async ({
  page,
  request,
}) => {
  await request.post('/api/runtime', { data: { provider: 'demo' } });
  const { project } = await (
    await request.post('/api/projects', {
      data: {
        title: 'Feedback retention',
        brief:
          'Prepare a useful scope with a human review so feedback can be corrected without losing it.',
        workflow: 'office',
      },
    })
  ).json();
  const current = await (await request.get('/api/state')).json();
  await request.post('/api/policy', { data: { ...current.state.policy, maxRevisions: 0 } });
  await request.post(`/api/projects/${project.id}/run`);
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('workroom-project', id), project.id);
  await page.reload();
  await page.getByRole('button', { name: 'Review work', exact: true }).click({ timeout: 15000 });
  const feedback =
    'Reject the generic proposal. Compare differentiated alternatives and explain why buyers would pay instead of using ChatGPT.';
  await page.getByLabel('Your feedback').fill(feedback);
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('revision limit');
  await page
    .getByRole('button', { name: 'Open Workspace controls · keep feedback', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Workspace controls');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Review work', exact: true }).click();
  await expect(page.getByLabel('Your feedback')).toHaveValue(feedback);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Project memory', exact: true }).click();
  await page
    .getByLabel('Memory content')
    .fill('Budget ceiling: $100. Require evidence before spending.');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Project memory', exact: true }).click();
  await expect(page.getByLabel('Memory content')).toHaveValue(
    'Budget ceiling: $100. Require evidence before spending.',
  );
  await expect(page.getByRole('dialog')).toContainText('Propose and verify');
  await request.post('/api/policy', { data: { ...current.state.policy, maxRevisions: 1 } });
});

test('team discussions record real model-protocol contributions and guide purposeful meeting-room movement', async ({
  page,
  request,
}) => {
  await request.post('/api/runtime', { data: { provider: 'compatible' } });
  const { project } = await (
    await request.post('/api/projects', {
      data: {
        title: 'Opportunity debate',
        brief:
          'Find a differentiated business experiment. No budget, customers or income may be invented.',
        workflow: 'venture',
      },
    })
  ).json();
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('workroom-project', id), project.id);
  await page.reload();
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  await page
    .getByLabel('Meeting agenda')
    .fill(
      'Challenge generic copywriting and compare specific buyer problems against existing AI alternatives.',
    );
  await page.getByRole('button', { name: 'Start team meeting', exact: true }).click();
  await expect(page.locator('.meeting-record')).toContainText('gathering');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.scene-agent-label[data-action="meeting"]')).toHaveCount(4);
  await expect(page.locator('.scene-zone-label').filter({ hasText: 'TEAM MEETING' })).toBeVisible();
  await page.screenshot({ path: '/tmp/workroom-meeting-room.png', fullPage: true });
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  await expect(page.locator('.meeting-contribution')).toHaveCount(4, { timeout: 25000 });
  await expect(page.locator('.meeting-decision')).toContainText('Agreed next actions');
  await expect(page.locator('.meeting-record')).toContainText('ChatGPT');
  await page.reload();
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  await expect(page.locator('.meeting-contribution')).toHaveCount(4);
  const state = await (await request.get('/api/state')).json();
  const meeting = state.state.meetings.find(
    (m: { projectId: string }) => m.projectId === project.id,
  );
  expect(
    state.attempts.filter((a: { meetingId?: string }) => a.meetingId === meeting.id),
  ).toHaveLength(5);
  expect(meeting.status).toBe('completed');
  await page.getByRole('button', { name: 'Meeting & reasoning settings', exact: true }).click();
  await page.getByLabel('Codex reasoning effort').selectOption('high');
  await page.getByLabel('Automatic team meetings', { exact: true }).check();
  await page.getByLabel('Completed tasks between meetings').fill('2');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.locator('.collaboration-panel')).toContainText('after every 2 completed tasks');
  await expect(page.locator('.collaboration-panel')).toContainText('reasoning: high');
  await page.getByRole('button', { name: 'Your team', exact: true }).click();
  await page
    .locator('.team-profile')
    .first()
    .getByRole('button', { name: 'Edit role & desk' })
    .click();
  await page.getByLabel('Specialist preset').selectOption('0');
  await expect(page.getByLabel('Role', { exact: true })).toHaveValue('Senior software engineer');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Team discussions', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/workroom-team-discussions.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: '/tmp/workroom-discussions-desktop.png' });
});
