import { expect, test } from '@playwright/test';
test('logout in another tab unmounts unsaved original input', async ({ page, context }) => {
  await context.addCookies([{ name: 'better-auth.session_token', value: process.env.E2E_SESSION_COOKIE!, url: 'http://localhost:3011' }]);
  const response = await page.request.post('/api/projects', { headers: { Origin: 'http://localhost:3011' }, data: { name: '세션 정리 검증' } });
  expect(response.ok()).toBe(true); const project = await response.json();
  await page.goto(`/projects/${project.id}`);
  await page.getByLabel('기획서 텍스트').fill('종료 시 해제할 합성 원문');
  const other = await context.newPage(); await other.goto('/projects');
  await other.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByText(/로그인이 종료되었습니다/)).toBeVisible();
  await expect(page.getByLabel('기획서 텍스트')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toHaveCount(0);
});
