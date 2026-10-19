import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

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
    .poll(
      async () =>
        page.locator('.scene-agent-label').evaluateAll(
          (labels, before) =>
            labels.some((label) => {
              const data = (label as HTMLElement).dataset,
                old = before.find((p) => p.id === data.agentId)!;
              return Math.hypot(Number(data.x) - old.x, Number(data.z) - old.z) > 0.5;
            }),
          initial,
        ),
      { timeout: 15000 },
    )
    .toBe(true);
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
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Operations planning');
  await page
    .getByLabel('The brief')
    .fill(
      'Prepare a practical office planning pack for a small team moving into a shared workspace. Identify assumptions, budget needs, owners, and next steps.',
    );
  await page.getByLabel('Deliverables', { exact: true }).selectOption('office');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
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
