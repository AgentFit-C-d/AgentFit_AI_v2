// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationPanel } from '../../apps/web/src/components/RecommendationPanel';
import { createApiClient } from '../../apps/web/src/lib/api';
import { emptyProfile, type ProjectDto } from '../../packages/contracts/src';
afterEach(cleanup);
const project: ProjectDto = { id: 'p1', name: 'synthetic', version: 2, confirmedProfile: { profile: { ...emptyProfile(), features: ['결제 승인'] }, sources: {} as never, confirmedAt: '2026-10-07' }, draft: null, activeAttempt: null, createdAt: '2026-10-07', updatedAt: '2026-10-07' };
test.each([false, true])('shows actual discovery progress and package-level evidence, preserving old result on failure=%s', async failure => {
  let started = false; let polled = false; let recCalls = 0;
  const basis = { projectVersion: 2, developerVersion: 1, environmentVersion: 1, catalogRevision: 'catalog' };
  const old = { id: 'old', basis, validity: 'CURRENT', status: 'RECOMMENDED', capabilities: [], items: [{ catalogItemId: 'old-skill', catalogVersion: 'pin', supportMatrixId: 'checked', required: true, reason: '기존 추천', permissionOptions: [], authenticationRequirements: [] }], questions: [], reasons: [], evidenceLevel: 'ENVIRONMENT_DECLARED', createdAt: '2026-10-07' };
  const job = { id: 'd1', basis, status: 'SEARCHING', needs: [], checks: [], errorCode: null, createdAt: '2026-10-07', deadline: new Date(Date.now() + 180000).toISOString() };
  const client = createApiClient(async path => {
    const route = String(path);
    if (route.endsWith('/runtime')) return Response.json({ skillDiscoveryConfigured: true });
    if (route.endsWith('/developer-profile')) return Response.json({ profile: { data: { role: 'FULL_STACK', responsibilities: [], experienceLevel: null }, version: 1 } });
    if (route.endsWith('/environment-profile')) return Response.json({ profile: { data: { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: null }, installedComponents: [], runtimes: [], authenticationReadiness: [], configurationKnowledge: 'USER_SAYS_EMPTY' }, version: 1 } });
    if (route.endsWith('/recommendations/latest')) return Response.json({ recommendation: old });
    if (route.endsWith('/skill-discoveries/latest')) return Response.json({ discovery: null });
    if (route.endsWith('/skill-discoveries')) { started = true; return Response.json({ discovery: job }); }
    if (route.endsWith('/skill-discoveries/d1')) { polled = true; return Response.json({ discovery: { ...job, status: failure ? 'FAILED' : 'SUCCEEDED', errorCode: failure ? 'SKILL_AI_INVALID_RESPONSE' : null } }); }
    if (route.endsWith('/recommendations')) { recCalls++; return Response.json({ recommendation: { ...old, id: 'new', discoveryId: 'd1', basis: { ...basis, catalogRevision: 'dynamic' }, items: [{ ...old.items[0], catalogItemId: 'new-skill', category: 'PROJECT', required: false, reason: '결제 승인에 맞는 검증 지침', tool: { name: 'payment-checks', skillsUrl: 'https://skills.sh/o/r/payment-checks', license: 'MIT', risk: 'MEDIUM', verification: 'PACKAGE_CHECKED', actualUse: 'NOT_RUN' } }] } }); }
    return Response.json({ revision: 'catalog', items: [{ id: 'old-skill', name: 'old-skill', license: 'MIT', risk: 'LOW' }] });
  });
  render(<RecommendationPanel project={project} client={client} />);
  await userEvent.setup().click(await screen.findByRole('button', { name: '도구 추천 받기' }));
  await waitFor(() => expect(started).toBe(true)); await waitFor(() => expect(polled).toBe(true), { timeout: 3000 });
  if (failure) { expect(await screen.findByText(/새 후보 탐색에 실패/)).toBeTruthy(); expect(screen.getByText(/AI 응답이 필요한 형식이나 근거 조건을 충족하지 못했습니다/)).toBeTruthy(); expect(screen.getByLabelText('old-skill 선택')).toBeTruthy(); expect(recCalls).toBe(0); }
  else { expect(await screen.findByText(/추천 근거는 패키지 검사 범위입니다/)).toBeTruthy(); expect((screen.getByLabelText('o/r 라이브러리 선택') as HTMLInputElement).disabled).toBe(false); expect(screen.getByText('결제 승인에 맞는 검증 지침')).toBeTruthy(); }
});

test.each([false, true])('recovers a completed saved discovery exactly when recommendation is missing it: reflected=%s', async reflected => {
  let recCalls = 0;
  const basis = { projectVersion: 2, developerVersion: 1, environmentVersion: 1, catalogRevision: 'dynamic' };
  const old = { id: 'old', basis, discoveryId: reflected ? 'd1' : undefined, validity: reflected ? 'CURRENT' : 'STALE', status: 'NO_ADDITIONS_NEEDED', capabilities: [], items: [], questions: [], reasons: [], evidenceLevel: 'ENVIRONMENT_DECLARED', createdAt: '2026-10-07' };
  const client = createApiClient(async path => {
    const route = String(path);
    if (route.endsWith('/runtime')) return Response.json({ skillDiscoveryConfigured: true });
    if (route.endsWith('/developer-profile')) return Response.json({ profile: { data: { role: 'FULL_STACK', responsibilities: [], experienceLevel: null }, version: 1 } });
    if (route.endsWith('/environment-profile')) return Response.json({ profile: { data: { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: null }, installedComponents: [], runtimes: [], authenticationReadiness: [], configurationKnowledge: 'USER_SAYS_EMPTY' }, version: 1 } });
    if (route.endsWith('/recommendations/latest')) return Response.json({ recommendation: old });
    if (route.endsWith('/skill-discoveries/latest')) return Response.json({ discovery: { id: 'd1', basis, status: 'SUCCEEDED', needs: [], checks: [], errorCode: null, createdAt: '2026-10-07', deadline: new Date(Date.now() - 1000).toISOString() } });
    if (route.endsWith('/recommendations')) { recCalls++; return Response.json({ recommendation: { ...old, discoveryId: 'd1', validity: 'CURRENT', reasons: ['저장된 완료 결과 반영'] } }); }
    return Response.json({ revision: 'static', items: [] });
  });
  render(<RecommendationPanel project={project} client={client} />);
  if (!reflected) await screen.findByText('저장된 완료 결과 반영');
  else await screen.findByText('추가 도구가 필요하지 않습니다');
  expect(recCalls).toBe(reflected ? 0 : 1);
});

test('shows GitHub quota failure after reload without starting another paid discovery', async () => {
  let started = false;
  const client = createApiClient(async path => {
    const route = String(path);
    if (route.endsWith('/runtime')) return Response.json({ skillDiscoveryConfigured: true });
    if (route.endsWith('/developer-profile') || route.endsWith('/environment-profile')) return Response.json({ profile: null });
    if (route.endsWith('/recommendations/latest')) return Response.json({ recommendation: null });
    if (route.endsWith('/skill-discoveries/latest')) return Response.json({ discovery: { id: 'd1', basis: { projectVersion: 2, developerVersion: 0, environmentVersion: 0, catalogRevision: 'static' }, status: 'FAILED', needs: [], checks: [{ candidateId: 'org/repo/test', name: 'test', status: 'BLOCKED', code: 'SKILL_SOURCE_RATE_LIMITED' }], errorCode: 'SKILL_SOURCE_RATE_LIMITED', createdAt: '2026-10-07', deadline: new Date().toISOString() } });
    if (route.endsWith('/skill-discoveries')) started = true;
    return Response.json({ revision: 'static', items: [] });
  });
  render(<RecommendationPanel project={project} client={client} />);
  expect(await screen.findByText(/^GitHub 원본 조회 한도/)).toBeTruthy();
  expect(started).toBe(false);
});

test('restores saved AI timeout reason after reload without starting another request', async () => {
  let started = false;
  const client = createApiClient(async path => {
    const route = String(path);
    if (route.endsWith('/runtime')) return Response.json({ skillDiscoveryConfigured: true });
    if (route.endsWith('/developer-profile') || route.endsWith('/environment-profile')) return Response.json({ profile: null });
    if (route.endsWith('/recommendations/latest')) return Response.json({ recommendation: null });
    if (route.endsWith('/skill-discoveries/latest')) return Response.json({ discovery: { id: 'd1', basis: { projectVersion: 2, developerVersion: 0, environmentVersion: 0, catalogRevision: 'static' }, status: 'FAILED', needs: [], checks: [], errorCode: 'SKILL_AI_TIMEOUT', createdAt: '2026-10-07', deadline: new Date().toISOString() } });
    if (route.endsWith('/skill-discoveries')) started = true;
    return Response.json({ revision: 'static', items: [] });
  });
  render(<RecommendationPanel project={project} client={client} />);
  expect(await screen.findByText(/AI 모델이 제한 시간 안에 응답하지 않았습니다/)).toBeTruthy();
  expect(started).toBe(false);
});
