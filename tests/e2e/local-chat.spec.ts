import { test, expect } from './fixtures';

test('direct local model chat streams, persists conversation, stops inference and starts a new chat (HTTP fixture)', async ({
  page,
}) => {
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Local model chat' })).toBeVisible();
  await expect(page.getByLabel('Chat model')).toHaveValue('workroom-chat-fixture-not-live');
  await page.getByLabel('Message', { exact: true }).fill('What is 35 - 20?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByLabel('Chat messages')).toContainText('Fixture answer: 35 - 20 = 15.');
  await page.reload();
  await expect(page.getByLabel('Chat messages')).toContainText('Fixture answer: 35 - 20 = 15.');
  await page.getByLabel('Message', { exact: true }).fill('Explain again using our conversation.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByLabel('Chat messages')).toContainText('Conversation messages: 4.');
  await page.getByLabel('Message', { exact: true }).fill('Stop fixture reply');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByLabel('Chat messages')).toContainText('Partial fixture response');
  await page.getByRole('button', { name: 'Stop reply' }).click();
  await expect(page.getByRole('alert')).toContainText('Reply stopped');
  await expect(page.getByLabel('Chat messages')).toContainText('interrupted');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Stop fixture reply');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByLabel('Chat messages')).not.toContainText('Partial fixture response');
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible();
});

test('community chat requires explicit selection, preserves separate histories and keeps unavailable models visible (HTTP fixture)', async ({
  page,
}) => {
  let listCalls = 0,
    seen: any;
  await page.route('**/api/community-models', (route) => {
    listCalls++;
    return route.fulfill({
      json: {
        models: listCalls === 1 ? ['public-fixture-not-live'] : [],
        preferred: listCalls === 1 ? 'public-fixture-not-live' : '',
      },
    });
  });
  await page.route('**/api/community-chat', async (route) => {
    seen = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'done', text: 'Volunteer fixture response.' }) + '\n',
    });
  });
  await page.goto('/chat');
  await page.getByLabel('Message', { exact: true }).fill('Private local draft');
  expect(listCalls).toBe(0);
  await page.getByLabel('Chat connection').selectOption('community');
  await expect(page.getByLabel('Chat model')).toHaveValue('public-fixture-not-live');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await page.getByLabel('Message', { exact: true }).fill('Public problem');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByLabel('Chat messages')).toContainText('Volunteer fixture response.');
  expect(seen.messages).toEqual([{ role: 'user', content: 'Public problem' }]);
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(page.getByLabel('Chat model')).toHaveValue('public-fixture-not-live');
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByLabel('Chat connection').selectOption('local');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Private local draft');
});
