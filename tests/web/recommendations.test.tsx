// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeveloperEditor } from '../../apps/web/src/components/DeveloperEditor';
import { EnvironmentEditor } from '../../apps/web/src/components/EnvironmentEditor';
import type { DeveloperProfile, EnvironmentProfile, ProfilePut } from '../../packages/contracts/src';
import { emptyProfile, type ProjectDto, type RecommendationDto } from '../../packages/contracts/src';
import { RecommendationPanel } from '../../apps/web/src/components/RecommendationPanel';
import { createApiClient } from '../../apps/web/src/lib/api';
afterEach(cleanup);

test.each([false, true])('saving environment refreshes recommendations with the saved version (failure=%s)', async failure => {
  const user = userEvent.setup(); let environment: { data: EnvironmentProfile; version: number; source: 'USER_DECLARED'; updatedAt: string } | null = null; let requests = 0;
  const recommendation: RecommendationDto = { id: 'auto-r', status: 'NO_ADDITIONS_NEEDED', basis: { projectVersion: 2, developerVersion: 0, environmentVersion: 1, catalogRevision: 'catalog' }, validity: 'CURRENT', capabilities: [], items: [], questions: [], reasons: ['추가 구성이 필요 없습니다.'], evidenceLevel: 'ENVIRONMENT_DECLARED', createdAt: '2026-10-06' };
  const client = createApiClient(async (path, init) => {
    const route = String(path);
    if (route.endsWith('/environment-profile')) {
      if (init?.method === 'PUT') { const patch = JSON.parse(String(init.body)); expect(patch.expectedVersion).toBe(0); environment = { data: patch.data, version: 1, source: 'USER_DECLARED', updatedAt: '2026-10-06' }; }
      return Response.json({ profile: environment });
    }
    if (route.endsWith('/developer-profile')) return Response.json({ profile: null });
    if (route.endsWith('/recommendations/latest')) return Response.json({ recommendation: null });
    if (route.endsWith('/recommendations')) { requests++; expect(JSON.parse(String(init?.body)).expectedVersions).toEqual({ project: 2, developer: 0, environment: 1 }); return failure && requests === 1 ? Response.json({ error: { code: 'NETWORK_ERROR' } }, { status: 500 }) : Response.json({ recommendation }); }
    return Response.json({ revision: 'catalog', items: [] });
  });
  render(<RecommendationPanel project={project} client={client} />);
  await user.selectOptions(await screen.findByLabelText('OS 종류'), 'WINDOWS'); await user.type(screen.getByLabelText('OS 버전'), '11'); await user.selectOptions(screen.getByLabelText('AI 개발 도구'), 'codex-desktop'); await user.selectOptions(screen.getByLabelText('기존 확장 상태'), 'none');
  await user.click(screen.getByRole('button', { name: /개발환경.*저장/ }));
  if (failure) { expect(await screen.findByRole('alert')).toBeTruthy(); await user.click(screen.getByRole('button', { name: '도구 추천 받기' })); }
  expect(await screen.findByText('추가 도구가 필요하지 않습니다')).toBeTruthy(); expect((screen.getByLabelText('OS 버전') as HTMLInputElement).value).toBe('11');
});
test('preserves edited responsibilities after a save failure and sends an independent version', async () => {
  const user = userEvent.setup();
  let payload: ProfilePut<DeveloperProfile> | undefined;
  render(<DeveloperEditor initial={null} onDirty={() => {}} onSaved={() => {}} onSave={async patch => { payload = patch; throw new Error('VERSION_CONFLICT'); }} />);
  await user.selectOptions(screen.getByLabelText('개발 역할'), 'FRONTEND');
  await user.click(screen.getByText('업무·경험 추가 입력 (선택)'));
  await user.selectOptions(screen.getByLabelText('주요 업무 상태'), 'known');
  await user.type(screen.getByLabelText('주요 업무 입력'), '컴포넌트 설계\n테스트');
  await user.click(screen.getByRole('button', { name: '역할·업무 저장' }));
  expect(payload).toEqual({ expectedVersion: 0, data: { role: 'FRONTEND', responsibilities: ['컴포넌트 설계', '테스트'], experienceLevel: null } });
  expect(screen.getByRole('alert').textContent).toContain('다른 변경');
  expect((screen.getByLabelText('주요 업무 입력') as HTMLTextAreaElement).value).toBe('컴포넌트 설계\n테스트');
});
const project: ProjectDto = { id: 'p1', name: '합성 프로젝트', version: 2, confirmedProfile: { profile: emptyProfile(), sources: {} as never, confirmedAt: '2026-10-06' }, draft: null, activeAttempt: null, createdAt: '2026-10-06', updatedAt: '2026-10-06' };
test.each([
  ['NEEDS_INFORMATION', '정보 확인이 필요합니다'], ['NO_ADDITIONS_NEEDED', '추가 도구가 필요하지 않습니다'], ['NO_COMPATIBLE_TOOLS', '호환되는 검증 후보가 없습니다'], ['RECOMMENDED', '프로젝트에 맞는 구성을 추천합니다'],
] as const)('displays %s honestly and blocks selection until explicit choice', async (status, label) => {
  const recommendation: RecommendationDto = { id: 'r1', status, basis: { projectVersion: 2, developerVersion: 0, environmentVersion: 0, catalogRevision: 'catalog' }, validity: 'CURRENT', capabilities: [], items: status === 'RECOMMENDED' ? [{ catalogItemId: 'react', catalogVersion: 'pin', supportMatrixId: 'checked', required: true, reason: '화면 구현 지침', permissionOptions: [], authenticationRequirements: [] }] : [], questions: status === 'NEEDS_INFORMATION' ? [{ id: 'env', field: 'environment.client', message: 'AI 개발 도구를 선택해 주세요.', required: true }] : [], reasons: status === 'RECOMMENDED' || status === 'NEEDS_INFORMATION' ? [] : ['확인한 조건의 결과입니다.'], evidenceLevel: 'PLAN_ONLY', createdAt: '2026-10-06' };
  const client = createApiClient(async (path) => {
    const route = String(path);
    const body = route.endsWith('/developer-profile') || route.endsWith('/environment-profile') ? { profile: null } : route.endsWith('/recommendations/latest') ? { recommendation } : route === '/api/tool-catalog' ? { revision: 'catalog', items: [{ id: 'react', name: 'React 지침', version: 'pin', risk: 'LOW', license: 'MIT', skillsUrl: 'https://www.skills.sh/vendor/repo/react', verificationStatus: 'VERIFIED' }] } : null;
    return Response.json(body);
  });
  render(<RecommendationPanel project={project} client={client}>{selection => <p>설정 선택 {selection.selectedIds.join(',')}</p>}</RecommendationPanel>);
  expect(await screen.findByText(label)).toBeTruthy();
  if (status === 'NEEDS_INFORMATION') expect(screen.getByText('AI 개발 도구를 선택해 주세요.')).toBeTruthy();
  if (status === 'RECOMMENDED') {
    const user = userEvent.setup();
    expect(screen.queryByText(/설정 선택/)).toBeNull();
    await user.click(screen.getByLabelText('vendor/repo 라이브러리 선택'));
    expect(screen.getByText('설정 선택 react')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('개발 역할'), 'FRONTEND');
    expect(screen.queryByText(/설정 선택/)).toBeNull();
    expect((screen.getByRole('button', { name: '도구 추천 받기' }) as HTMLButtonElement).disabled).toBe(true);
  }
});

test('editing the environment preserves a previously saved app version without asking for it', async () => {
  const user = userEvent.setup(); let payload: ProfilePut<EnvironmentProfile> | undefined;
  const data: EnvironmentProfile = { os: { family: 'WINDOWS', version: '10' }, client: { id: 'codex-desktop', version: '26.930.41038' }, runtimes: null, installedComponents: [], configurationKnowledge: 'UNKNOWN', authenticationReadiness: null };
  render(<EnvironmentEditor initial={{ data, version: 4, source: 'USER_DECLARED', updatedAt: '2026-10-06' }} catalog={[]} onDirty={() => {}} onSaved={() => {}} onSave={async patch => { payload = patch; return { data: patch.data, version: 5, source: 'USER_DECLARED', updatedAt: '2026-10-06' }; }} />);
  const os = screen.getByLabelText('OS 버전'); await user.clear(os); await user.type(os, '11');
  await user.click(screen.getByRole('button', { name: '개발환경 저장' }));
  expect(payload?.expectedVersion).toBe(4); expect(payload?.data.client).toEqual({ id: 'codex-desktop', version: '26.930.41038' }); expect(payload?.data.os?.version).toBe('11');
});
test('distinguishes explicitly empty environment lists from unknown and labels declaration as unverified', async () => {
  const user = userEvent.setup(); let payload: ProfilePut<EnvironmentProfile> | undefined;
  render(<EnvironmentEditor initial={null} catalog={[]} onDirty={() => {}} onSaved={() => {}} onSave={async patch => { payload = patch; return { data: patch.data, version: 1, source: 'USER_DECLARED', updatedAt: '2026-10-06' }; }} />);
  await user.selectOptions(screen.getByLabelText('OS 종류'), 'WINDOWS');
  await user.type(screen.getByLabelText('OS 버전'), '11');
  await user.selectOptions(screen.getByLabelText('AI 개발 도구'), 'codex-desktop');
  expect(screen.queryByLabelText('Codex 앱 버전')).toBeNull();
  await user.selectOptions(screen.getByLabelText('기존 확장 상태'), 'none');
  await user.click(screen.getByRole('button', { name: '개발환경 저장' }));
  expect(payload?.data).toEqual({ os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: null }, runtimes: null, installedComponents: [], configurationKnowledge: 'UNKNOWN', authenticationReadiness: null });
  expect(screen.getByText(/입력한 내용이며 PC 검사 결과/)).toBeTruthy();
});
