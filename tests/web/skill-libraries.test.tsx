// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { emptyProfile, type ProjectDto, type RecommendationDto, type RecommendationItem } from '../../packages/contracts/src';
import { RecommendationPanel } from '../../apps/web/src/components/RecommendationPanel';
import { createApiClient } from '../../apps/web/src/lib/api';
afterEach(cleanup);

const project: ProjectDto = { id: 'p1', name: '합성', version: 2, confirmedProfile: { profile: emptyProfile(), sources: {} as never, confirmedAt: '2026-10-07' }, draft: null, activeAttempt: null, createdAt: '2026-10-07', updatedAt: '2026-10-07' };
const tools = [
  { id: 'tdd', name: 'test-driven-development', version: 'pin', skillsUrl: 'https://www.skills.sh/obra/superpowers/test-driven-development' },
  { id: 'plans', name: 'writing-plans', version: 'pin', skillsUrl: 'https://skills.sh/obra/superpowers/writing-plans' },
  { id: 'react', name: 'React 지침', version: 'react-pin', skillsUrl: 'https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices' },
  { id: 'unknown', name: '개별 지침', version: 'pin', skillsUrl: 'https://example.invalid/obra/superpowers/guide' },
].map(tool => ({ ...tool, risk: 'LOW', license: 'MIT', verificationStatus: 'VERIFIED' }));
function show({ items, stale = false }: { items?: RecommendationItem[]; stale?: boolean } = {}) {
  const recommendation: RecommendationDto = { id: 'r', status: 'RECOMMENDED', basis: { projectVersion: 2, developerVersion: 0, environmentVersion: 0, catalogRevision: 'catalog' }, validity: stale ? 'STALE' : 'CURRENT', capabilities: [], items: items ?? tools.map(tool => ({ catalogItemId: tool.id, catalogVersion: tool.version, supportMatrixId: 'checked', required: tool.id === 'react', reason: `${tool.name} 업무에 적합`, permissionOptions: [], authenticationRequirements: [] })), questions: [], reasons: [], evidenceLevel: 'PLAN_ONLY', createdAt: '2026-10-07' };
  const client = createApiClient(async path => Response.json(String(path).endsWith('/recommendations/latest') ? { recommendation } : String(path) === '/api/tool-catalog' ? { revision: 'catalog', items: tools } : { profile: null }));
  render(<RecommendationPanel project={project} client={client}>{selection => <output data-testid="selection">{[...selection.selectedIds].sort().join(',')}</output>}</RecommendationPanel>);
}

test('a library is one atomic choice with no individual skill controls and other choices are preserved', async () => {
  const user = userEvent.setup(); show();
  const library = await screen.findByRole('checkbox', { name: 'Superpowers 라이브러리 선택' });
  expect(library).not.toBeChecked();
  expect(screen.queryByRole('checkbox', { name: 'test-driven-development 선택' })).toBeNull();
  expect(screen.queryByText(/포함 스킬.*개별 선택/)).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Vercel Agent Skills 라이브러리 선택' }));
  await user.click(library);
  expect(screen.getByTestId('selection')).toHaveTextContent('plans,react,tdd');
  expect(library).toBeChecked();
  await user.click(library);
  expect(screen.getByTestId('selection')).toHaveTextContent('react');
  await user.click(screen.getByLabelText('개별 지침 선택'));
  expect(screen.getByTestId('selection')).toHaveTextContent('react,unknown');
});

test('different evidence versions still recommend one library without claiming the entire library is verified', async () => {
  show({ items: [
    { catalogItemId: 'dynamic', catalogVersion: 'new-pin', supportMatrixId: 'package', category: 'PROJECT', required: false, reason: '프로젝트 구현', permissionOptions: [], authenticationRequirements: [], tool: { name: 'new-plan', skillsUrl: 'https://www.skills.sh/Obra/Superpowers/new-plan', license: 'MIT', risk: 'LOW', verification: 'PACKAGE_CHECKED', actualUse: 'NOT_RUN', checkedAt: '2026-10-07', expiresAt: '2027-01-01', artifactHash: 'hash' } },
    { catalogItemId: 'tdd', catalogVersion: 'pin', supportMatrixId: 'checked', required: false, reason: '테스트', permissionOptions: [], authenticationRequirements: [] },
  ] });
  await screen.findByRole('checkbox', { name: 'Superpowers 라이브러리 선택' });
  expect(screen.getAllByRole('checkbox', { name: 'Superpowers 라이브러리 선택' })).toHaveLength(1);
  const card = screen.getByRole('article', { name: 'Superpowers 추천 라이브러리' });
  expect(within(card).getByText(/라이브러리 전체.*미검증/)).toBeVisible();
  expect(card).toHaveTextContent('new-pin');
  expect(card).toHaveTextContent('pin');
  expect(screen.queryByRole('checkbox', { name: 'plans 선택' })).toBeNull();
});

test('an old recommendation does not borrow source or verification metadata from a newer catalog version', async () => {
  show({ stale: true, items: [{ catalogItemId: 'tdd', catalogVersion: 'old-pin', supportMatrixId: 'checked', required: false, reason: '테스트', permissionOptions: [], authenticationRequirements: [] }] });
  await screen.findByText('테스트');
  expect(screen.queryByRole('checkbox', { name: 'Superpowers 라이브러리 선택' })).toBeNull();
  const checkbox = screen.getByRole('checkbox', { name: 'tdd 선택' });
  expect(checkbox).toHaveAccessibleName('tdd 선택');
  expect(checkbox).toBeDisabled();
  expect(screen.getByText(/고정 버전 old-pin/)).toHaveTextContent('고정 버전 메타데이터 미확인');
  expect(screen.queryByRole('link', { name: '공급원·Skill 내용 확인' })).toBeNull();
});

test.each(['stale', 'edited'])('%s profiles disable both library and individual selection', async mode => {
  const user = userEvent.setup(); show({ stale: mode === 'stale' });
  const library = await screen.findByRole('checkbox', { name: 'Superpowers 라이브러리 선택' });
  if (mode === 'edited') {
    await user.click(library);
    expect(screen.getByTestId('selection')).toHaveTextContent('plans,tdd');
    await user.selectOptions(screen.getByLabelText('개발 역할'), 'FRONTEND');
    expect(screen.queryByTestId('selection')).toBeNull();
  }
  expect(library).toBeDisabled();
  expect(screen.queryByRole('checkbox', { name: 'test-driven-development 선택' })).toBeNull();
});

test('a single matched skill in another repository recommends that library itself', async () => {
  const user = userEvent.setup();
  show({ items: [{ catalogItemId: 'dynamic', catalogVersion: 'new-pin', supportMatrixId: 'package', required: false, reason: '결제 연동 테스트에 필요', permissionOptions: [], authenticationRequirements: [], tool: { name: 'payment-checks', skillsUrl: 'https://skills.sh/example/payment-tools/payment-checks', license: 'MIT', risk: 'LOW', verification: 'PACKAGE_CHECKED', actualUse: 'NOT_RUN', checkedAt: '2026-10-07', expiresAt: '2027-01-01', artifactHash: 'hash' } }] });
  const library = await screen.findByRole('checkbox', { name: 'example/payment-tools 라이브러리 선택' });
  expect(screen.queryByRole('checkbox', { name: 'payment-checks 선택' })).toBeNull();
  await user.click(library);
  expect(screen.getByTestId('selection')).toHaveTextContent('dynamic');
  expect(screen.getByRole('link', { name: 'example/payment-tools 공식 설치 안내' })).toHaveAttribute('href', 'https://github.com/example/payment-tools#readme');
});

test.each([70, 74, 75])('score%s displays its band without preselecting the library and supports explicit choice', async matchScore => {
  const user = userEvent.setup();
  show({ items: [{ catalogItemId: 'tdd', catalogVersion: 'pin', supportMatrixId: 'checked', matchScore, category: 'PROJECT', required: false, reason: '프로젝트 테스트 지침', permissionOptions: [], authenticationRequirements: [] }] });
  const choice = await screen.findByRole('checkbox', { name: 'Superpowers 라이브러리 선택' });
  expect(choice).not.toBeChecked(); expect(choice).toBeEnabled();
  expect(screen.getByText(`프로젝트 적합도 ${matchScore}점 · ${matchScore >= 75 ? '추천 기준 충족' : '추가 선택 후보 · 추천 기준 75점'}`)).toBeVisible();
  expect(screen.queryByTestId('selection')).toBeNull();
  await user.click(choice); expect(screen.getByTestId('selection')).toHaveTextContent('tdd');
});

test('a grouped library uses its best scored match while preserving all selected evidence IDs', async () => {
  const user = userEvent.setup();
  show({ items: [
    { catalogItemId: 'tdd', catalogVersion: 'pin', supportMatrixId: 'checked', matchScore: 70, category: 'PROJECT', required: false, reason: '테스트 보조', permissionOptions: [], authenticationRequirements: [] },
    { catalogItemId: 'plans', catalogVersion: 'pin', supportMatrixId: 'checked', matchScore: 90, category: 'PROJECT', required: false, reason: '계획 작성', permissionOptions: [], authenticationRequirements: [] },
  ] });
  const choice = await screen.findByRole('checkbox', { name: 'Superpowers 라이브러리 선택' });
  expect(screen.getByText('프로젝트 적합도 90점 · 추천 기준 충족')).toBeVisible();
  expect(screen.queryByText(/추가 선택 후보/)).toBeNull();
  await user.click(choice); expect(screen.getByTestId('selection')).toHaveTextContent('plans,tdd');
});
