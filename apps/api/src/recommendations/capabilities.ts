import type { Capability, DeveloperProfile, ProjectProfile } from '@agentfit/contracts';
export function deriveCapabilities(profile: ProjectProfile, developer: DeveloperProfile | null): Capability[] {
  const capabilities: Capability[] = [];
  const work = (developer?.responsibilities ?? []).join(' ');
  const add = (id: string, name: string, reason: string, sourceFields: string[]) => capabilities.push({ id, name, reason, sourceFields });
  if ((profile.frontend ?? []).some(x => /^(React|Next(?:\.js)?)(?:\s|$)/i.test(x))) {
    add('framework-guidance', 'React·Next.js 구현 지침', '확인한 프론트엔드 기술에 맞는 비동기 처리·성능 지침이 필요합니다.', ['project.frontend']);
    if (!developer?.role || ['FRONTEND', 'FULL_STACK', 'DESIGNER'].includes(developer.role)) add('frontend-review', '화면 코드 검토', '화면 구현을 담당하므로 상태와 렌더링 오류를 검토합니다.', ['project.frontend', 'developer.role']);
    if (/컴포넌트.*(?:설계|구조|구성)|component.*architect/i.test(work)) add('component-architecture', '컴포넌트 구성', '입력한 업무에 컴포넌트 구조 설계가 포함되어 있습니다.', ['developer.responsibilities']);
  }
  if ((profile.backend ?? []).some(x => /prisma/i.test(x))) add('database-access', 'Prisma 쿼리·트랜잭션', '확인한 Prisma 기술의 쿼리와 트랜잭션 지침이 필요합니다.', ['project.backend']);
  if (/외부.*(?:API|문서)|API.*문서|documentation lookup/i.test(work)) add('documentation-reference', '외부 기술 문서 참조', '입력한 업무에 외부 API 문서 조회가 포함되어 있습니다.', ['developer.responsibilities']);
  return capabilities;
}

export function deriveWorkflowCapabilities(profile: ProjectProfile, developer: DeveloperProfile | null): Capability[] {
  const sourceFields: string[] = [];
  if (developer?.role && ['FRONTEND', 'BACKEND', 'FULL_STACK', 'AI'].includes(developer.role)) sourceFields.push('developer.role');
  for (const field of ['frontend', 'backend', 'ai'] as const) if (profile[field]?.length) sourceFields.push(`project.${field}`);
  const work = (developer?.responsibilities ?? []).join(' ');
  if (/개발|구현|코딩|디버깅|테스트|implementation|coding|debugging|testing/i.test(work)) sourceFields.push('developer.responsibilities');
  if (!sourceFields.length) return [];
  const result: Capability[] = [
    { id: 'implementation-planning', name: '구현 계획 작성', reason: '개발 요구사항을 작은 구현 단계와 검증 항목으로 나누는 Superpowers 지침을 선택할 수 있습니다.', sourceFields },
    { id: 'test-guidance', name: '테스트부터 구현하기 · TDD', reason: '코드 개발에서 실패하는 테스트부터 작성하고 구현·리팩터링하는 TDD 지침을 선택할 수 있습니다.', sourceFields },
    { id: 'completion-verification', name: '작업 완료 검증', reason: '코드 구현 결과를 테스트·빌드 등으로 확인하는 공통 개발 지침을 선택할 수 있습니다.', sourceFields },
    { id: 'systematic-debugging', name: '오류 원인 조사', reason: '개발 중 오류를 재현하고 원인을 좁히는 공통 디버깅 지침을 선택할 수 있습니다.', sourceFields },
  ];
  return result;
}
