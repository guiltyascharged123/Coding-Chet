import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { backupSchema } from '../../shared/schemas';

test('backup export renews an expired browser session and the downloaded populated backup restores intact', async ({
  page,
  request,
  context,
}) => {
  const original = await (await request.get('/api/backup')).json();
  try {
    const populated = structuredClone(original),
      task = populated.state.tasks[0];
    task.status = 'failed';
    task.output = '## Saved findings\n\n' + '測定結果は未確認。'.repeat(3000);
    task.error = 'Actual experiment measurements are missing.';
    task.result = {
      outcome: 'blocked',
      summary: task.error,
      deliverable: task.output,
      checks: [
        {
          criterion: 'c1: Actual results',
          status: 'unverified',
          evidence: 'No observed results supplied.',
        },
      ],
      handoff: {
        facts: [],
        assumptions: ['Execution unknown.'],
        next: 'Supply observed outcomes.',
      },
      decision: null,
      followUps: [],
      improvements: [],
    };
    const receipt = {
      id: randomUUID(),
      projectId: task.projectId,
      taskId: task.id,
      provider: 'compatible',
      billing: 'none',
      phase: 'task',
      status: 'completed',
      createdAt: Date.now(),
      reservedUsd: 0,
    };
    populated.attempts.push(receipt);
    populated.attemptResults ||= [];
    populated.attemptResults.push({ attemptId: receipt.id, text: JSON.stringify(task.result) });
    expect((await request.post('/api/restore', { data: populated })).ok()).toBe(true);
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = (() => null) as any;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Backup & restore', exact: true }).click();
    await context.clearCookies();
    const download = page.waitForEvent('download', { timeout: 7000 });
    await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
    const file = await download,
      bytes = await readFile((await file.path())!);
    const backup = backupSchema.parse(JSON.parse(bytes.toString('utf8')));
    expect(backup.state.tasks.find((t) => t.id === task.id)?.output).toBe(task.output);
    expect(backup.attemptResults?.find((r) => r.attemptId === receipt.id)?.text).toBe(
      JSON.stringify(task.result),
    );
    await dialog.getByLabel('Workspace backup file').setInputFiles({
      name: file.suggestedFilename(),
      mimeType: 'application/json',
      buffer: bytes,
    });
    await dialog
      .getByLabel('I understand this replaces the current projects and documents.')
      .check();
    await dialog.getByRole('button', { name: 'Restore workspace backup', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Workspace restored');
    const after = await (await request.get('/api/state')).json();
    expect(after.state.tasks.find((t: any) => t.id === task.id).output).toBe(task.output);
    // Real file size above the old decimal limit, below the server's 25 MiB
    // limit. Trailing whitespace keeps the downloaded JSON content unchanged.
    const padded = Buffer.concat([bytes, Buffer.alloc(25_000_001 - bytes.length, 0x20)]);
    await dialog.getByLabel('Workspace backup file').setInputFiles({
      name: 'large-valid-backup.json',
      mimeType: 'application/json',
      buffer: padded,
    });
    await expect(dialog.getByRole('status')).toContainText('Backup loaded for validation');
    await dialog
      .getByLabel('I understand this replaces the current projects and documents.')
      .check();
    await dialog.getByRole('button', { name: 'Restore workspace backup', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Workspace restored');
  } finally {
    const session = await (
      await request.get('/api/session', { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })
    ).json();
    expect(
      (
        await request.post('/api/restore', {
          data: original,
          headers: { 'X-Workroom-CSRF': session.token },
        })
      ).ok(),
    ).toBe(true);
  }
});

test('failed exports show the server error and never download an error document', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace controls', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Backup & restore', exact: true }).click();
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/backup', (route) =>
    route.fulfill({
      status: 500,
      json: { error: 'Saved workspace validation failed at tasks[0].contextReport.' },
    }),
  );
  await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved workspace validation failed');
  expect(downloads).toBe(0);
  await page.unroute('**/api/backup');
  await page.route('**/api/backup', (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Gateway failure</html>' }),
  );
  await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('502');
  expect(downloads).toBe(0);
  await page.unroute('**/api/backup');
  await page.route('**/api/backup', (route) =>
    route.fulfill({ json: { error: 'An error object is not a backup' } }),
  );
  await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('did not return a Workroom backup');
  expect(downloads).toBe(0);
  await page.unroute('**/api/backup');
  const healthyDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  const recovered = await healthyDownload;
  expect(JSON.parse(await readFile((await recovered.path())!, 'utf8')).format).toBe('workroom');
});
