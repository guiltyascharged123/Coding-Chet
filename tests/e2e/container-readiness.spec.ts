import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';

test('workspace selection is saved before setup; unsupported isolation blocks execution without spending inference', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/state')).json();
  test.skip(
    !!before.runtime.container?.ready,
    'This negative case needs an unsupported Docker configuration.',
  );
  const original = await (await request.get('/api/backup')).json();
  try {
    await request.post('/api/runtime', { data: { provider: 'ollama' } });
    const { project } = await (
      await request.post('/api/projects', {
        data: {
          title: 'Unavailable execution prerequisite',
          brief:
            'Build and independently check a real local utility when the execution prerequisite is available.',
          workflow: 'custom',
          planning: 'manual',
        },
      })
    ).json();
    await page.goto('/');
    await page.evaluate((id: string) => localStorage.setItem('workroom-project', id), project.id);
    await page.reload();
    await page.getByRole('button', { name: 'Models & sign-in', exact: true }).click();
    const selector = page.getByRole('region', { name: 'Selected project model', exact: true });
    await selector.getByLabel('Use isolated Linux workspace', { exact: true }).check();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/runtime`) && r.request().method() === 'POST',
    );
    await selector
      .getByRole('button', { name: 'Use this model for this project', exact: true })
      .click();
    expect((await response).status()).toBe(200);
    const after = await (await request.get('/api/state')).json(),
      saved = after.state.projects.find((p: any) => p.id === project.id);
    expect(saved.workMode).toBe('container');
    expect(saved.provider).toBe(project.provider);
    expect(saved.model).toBe(project.model);
    expect(after.attempts.filter((a: any) => a.projectId === project.id)).toHaveLength(0);
    expect(
      (
        await request.put(`/api/projects/${project.id}/plan`, {
          data: {
            tasks: [
              {
                id: randomUUID(),
                title: 'Build and test a utility',
                description: 'Create and verify a real project utility.',
                agentId: 'sol',
                dependencies: [],
                requiresApproval: false,
                workType: 'implementation',
                acceptanceCriteria: [
                  { id: 'c1', description: 'Write an actual source file.', evidence: 'artifact' },
                ],
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    const run = await request.post(`/api/projects/${project.id}/run`, { data: {} });
    expect(run.status()).toBe(400);
    expect(await run.text()).toContain('Isolated execution unavailable');
    const blocked = await (await request.get('/api/state')).json();
    expect(blocked.attempts.filter((a: any) => a.projectId === project.id)).toHaveLength(0);
  } finally {
    expect((await request.post('/api/restore', { data: original })).ok()).toBe(true);
  }
});
