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
