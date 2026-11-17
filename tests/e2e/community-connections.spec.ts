import { test, expect } from './fixtures';
import { COMMUNITY_API_URL, COMMUNITY_EXAMPLE_MODEL } from '../../shared/community';

test('AI Horde is visible before setup, preserves existing settings until saved and can be selected explicitly (HTTP fixture)', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  let data = await (await request.get('/api/state')).json();
  let settings = await (await request.get('/api/connections/settings')).json();
  settings = { ...settings, compatible: { ...settings.compatible, hasKey: true } };
  const original = structuredClone(settings),
    originalProjects = structuredClone(data.state.projects);
  data = {
    ...data,
    revision: (data.revision || 0) + 1000,
    state: { ...data.state, provider: 'ollama' },
    runtime: { ...data.runtime, compatibleCommunity: false },
  };
  const saves: any[] = [],
    defaults: any[] = [];
  await page.route('**/api/state', (route) => route.fulfill({ json: data }));
  await page.route('**/api/connections/check', (route) => route.fulfill({ json: data }));
  await page.route('**/api/connections/settings', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: settings });
    const body = route.request().postDataJSON();
    saves.push(body);
    settings = {
      ...settings,
      revision: 'saved-community-fixture',
      compatible: { model: body.model, url: body.url, billing: body.billing, hasKey: true },
    };
    data = {
      ...data,
      revision: data.revision + 1,
      runtime: {
        ...data.runtime,
        compatibleCommunity: true,
        available: { ...data.runtime.available, compatible: true },
        models: { ...data.runtime.models, compatible: body.model },
        listedModels: { ...data.runtime.listedModels, compatible: [body.model] },
        connections: {
          ...data.runtime.connections,
          compatible: {
            state: 'connected',
            message: 'Fixture metadata check; not live inference.',
          },
        },
      },
    };
    return route.fulfill({ json: { settings, data } });
  });
  await page.route('**/api/runtime', (route) => {
    const body = route.request().postDataJSON();
    defaults.push(body);
    data = {
      ...data,
      revision: data.revision + 1,
      state: { ...data.state, provider: body.provider },
    };
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Models & sign-in', exact: true }).click();
  const horde = page.getByRole('article', { name: 'AI Horde connection', exact: true });
  await expect(horde.getByText('AI Horde · free community AI', { exact: true })).toBeVisible();
  await expect(horde).toContainText('Not configured');
  await expect(
    horde.getByRole('button', { name: 'Use for new projects', exact: true }),
  ).toBeDisabled();
  await horde.getByRole('button', { name: 'Configure AI Horde', exact: true }).click();
  await expect(horde.getByLabel('compatible default model ID', { exact: true })).toHaveValue(
    COMMUNITY_EXAMPLE_MODEL,
  );
  await expect(horde).toContainText('Volunteer workers can see prompts');
  await expect(horde.getByLabel('compatible API key', { exact: true })).toHaveCount(0);
  await expect(horde.getByLabel('compatible server URL', { exact: true })).toHaveCount(0);
  await horde.getByRole('button', { name: 'Close AI Horde setup', exact: true }).click();
  const compatible = page.getByRole('article', {
    name: 'OpenAI-compatible model connection',
    exact: true,
  });
  await compatible.getByRole('button', { name: 'Configure connection', exact: true }).click();
  await expect(compatible.getByLabel('compatible server URL', { exact: true })).toHaveValue(
    original.compatible.url,
  );
  await expect(compatible.getByLabel('compatible default model ID', { exact: true })).toHaveValue(
    original.compatible.model,
  );
  expect(saves).toHaveLength(0);
  await horde.getByRole('button', { name: 'Configure AI Horde', exact: true }).click();
  await horde
    .getByLabel('compatible default model ID', { exact: true })
    .fill('community-choice-fixture-not-live');
  await horde.getByRole('button', { name: 'Save AI Horde connection', exact: true }).click();
  await expect(horde).toContainText('Connection saved.');
  expect(saves).toEqual([
    {
      provider: 'compatible',
      revision: original.revision,
      model: 'community-choice-fixture-not-live',
      url: COMMUNITY_API_URL,
      clearKey: false,
      billing: 'community',
    },
  ]);
  expect(defaults).toHaveLength(0);
  expect(data.state.projects).toEqual(originalProjects);
  await expect(
    page.getByLabel('Project connection', { exact: true }).locator('option[value="compatible"]'),
  ).toHaveText('AI Horde · free community AI');
  await horde.getByRole('button', { name: 'Use for new projects', exact: true }).click();
  await expect.poll(() => defaults.length).toBe(1);
  // The normal server publishes this change over SSE; this HTTP fixture
  // exposes the updated snapshot through the explicit refresh action.
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(horde.getByRole('button', { name: 'Selected default', exact: true })).toBeVisible();
  expect(defaults).toHaveLength(1);
  expect(defaults[0].provider).toBe('compatible');
  await horde.getByRole('button', { name: 'Close AI Horde setup', exact: true }).click();
  await horde.getByRole('button', { name: 'Configure AI Horde', exact: true }).click();
  await expect(horde.getByLabel('compatible default model ID', { exact: true })).toHaveValue(
    'community-choice-fixture-not-live',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('horde-connection-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Model connections', exact: true })).toContainText(
    'AI Horde',
  );
});
