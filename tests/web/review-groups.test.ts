import { expect, test } from 'vitest';
import { groupCandidates } from '../../apps/web/src/lib/review-groups';
import { analysisResult } from '../support/analysis';

test('duplicate and overlapping lists become one field group with unique values and all original candidate IDs', () => {
  const base = analysisResult().candidates[0]!;
  const groups = groupCandidates([{ ...base, id: 'all', field: 'ai', proposedValue: ['Solar', 'Embed', 'LangGraph'], evidence: [{ ...base.evidence[0]!, page: 3 }] }, { ...base, id: 'solar', field: 'ai', proposedValue: ['Solar'], evidence: [{ ...base.evidence[0]!, page: 5 }] }, { ...base, id: 'embed', field: 'ai', proposedValue: ['Embed'], evidence: [{ ...base.evidence[0]!, page: 5 }] }]);
  expect(groups).toHaveLength(1); expect(groups[0]?.values).toEqual(['Solar', 'Embed', 'LangGraph']); expect(groups[0]?.pages).toEqual([3, 5]); expect(groups[0]?.candidates.map(candidate => candidate.id)).toEqual(['all', 'solar', 'embed']);
});

test('case and whitespace duplicates consolidate while preserving every original source for review', () => {
  const base = analysisResult().candidates[0]!;
  const group = groupCandidates([{ ...base, field: 'frontend', proposedValue: ['React', ' react ', 'React'], evidence: [{ ...base.evidence[0]!, page: 3 }] }, { ...base, id: 'other', field: 'frontend', proposedValue: ['REACT'], evidence: [{ ...base.evidence[0]!, page: 7 }] }])[0]!;
  expect(group.values).toEqual(['React']); expect(group.pages).toEqual([3, 7]); expect(group.candidates).toHaveLength(2);
  expect(group.canAccept).toBe(false);
});

test('combined OAuth providers deduplicate against individual providers without merging distinct APIs', () => {
  const base = analysisResult().candidates[0]!;
  const group = groupCandidates([{ ...base, field: 'external_integrations', proposedValue: ['Google-Discord OAuth', 'Upstage Solar API', 'GitHub', 'Google OAuth', 'Discord OAuth', 'Upstage API', 'Upstage Embed API', 'GCP / Cloud Storage', 'Azure-AD OAuth'] }])[0]!;
  expect(group.values).toEqual(['Google OAuth', 'Discord OAuth', 'Upstage Solar API', 'GitHub', 'Upstage API', 'Upstage Embed API', 'GCP / Cloud Storage', 'Azure-AD OAuth']);
  expect(group.canAccept).toBe(false);
});

test('core feature review separates conditions and negation from main feature names without deleting sources', () => {
  const base = analysisResult().candidates[0]!;
  const group = groupCandidates([{ ...base, field: 'features', proposedValue: ['중요한 지원요건 경고를 제공한다', '중요한 지원요건 경고', '활동과 에피소드를 축적하고', '진행 중인 작업을 저장한 뒤 보완하도록 한다', '비공개 본문은 공개하지 않는다', '동일 버전에 동의하면 확정한다'] }])[0]!;
  expect(group.values).toEqual(['중요한 지원요건 경고', '활동과 에피소드를 축적']);
  expect(group.details).toEqual(expect.arrayContaining(['진행 중인 작업을 저장한 뒤 보완하도록 한다', '비공개 본문은 공개하지 않는다', '동일 버전에 동의하면 확정한다']));
  expect(group.candidates[0]?.proposedValue).toContain('중요한 지원요건 경고를 제공한다'); expect(group.canAccept).toBe(false);
});

test('business capabilities remain concise while layout, states and access rules move to details', () => {
  const base = analysisResult().candidates[0]!;
  const core = ['로그인', '관리자 승인', '프로젝트 생성', '멤버 추가·제외', '1:1 요청 전송', '알림', '근거 기반 자동 회신', '개발 계약 제안'];
  const details = ['승인 대기', '밝은 배경', 'PC 왼쪽 메뉴 · 넓은 본문', '모바일 메뉴', '상태 배지와 본문·처리 영역 분리', '요청 제목은 팀 공개', '본문은 송신자·수신자에게만 공개', '검토 대기', '확인 완료', '새 버전', '동일 버전 전원 동의', '원문·파일경로·상세 분석을 자동 공개하지 않습니다', '전송 버전은 불변'];
  const group = groupCandidates([{ ...base, field: 'features', proposedValue: [...core, ...details] }])[0]!;
  expect(group.values).toEqual(core); expect(group.details).toEqual(details); expect(group.canAccept).toBe(false);
  expect(group.candidates[0]?.proposedValue).toEqual([...core, ...details]);
});

test('display vocabulary is not enough to suppress an actual product capability', () => {
  const base = analysisResult().candidates[0]!;
  const features = ['식당 메뉴 관리', '모바일 메뉴 관리', '다크 테마 편집', '권한 관리', '문서 검색', '모바일 결제', '상품 주문', '배송 추적', '예약 취소', '코드 검토', '1:1 요청 전송', '팀 요청 전송'];
  expect(groupCandidates([{ ...base, field: 'features', proposedValue: features }])[0]?.values).toEqual(features);
});

test('reply capabilities with different business purposes or participants are not collapsed', () => {
  const base = analysisResult().candidates[0]!;
  const features = ['1:1 회신', '팀 회신', '팀 공개 회신', '견적 회신', '자동 회신', '공개 회신'];
  expect(groupCandidates([{ ...base, field: 'features', proposedValue: features }])[0]?.values).toEqual(['1:1 회신', '팀 회신', '견적 회신', '자동 회신', '회신']);
});

test('details-only extraction remains unknown rather than claiming there are explicitly no features', () => {
  const base = analysisResult().candidates[0]!;
  const group = groupCandidates([{ ...base, field: 'features', proposedValue: ['밝은 배경', '모바일 메뉴', '승인 대기'] }])[0]!;
  expect(group.values).toEqual([]); expect(group.details).toHaveLength(3); expect(group.proposed.mode).toBe('unknown'); expect(group.hasNone).toBe(false); expect(group.canAccept).toBe(false);
});

test('grouping does not permit acceptance of scalar conflicts, missing evidence or absence mixed with a value', () => {
  const base = analysisResult().candidates[0]!;
  expect(groupCandidates([{ ...base, field: 'database', proposedValue: 'MySQL' }, { ...base, id: 'db2', field: 'database', proposedValue: 'PostgreSQL' }])[0]).toMatchObject({ conflict: true, canAccept: false });
  expect(groupCandidates([{ ...base, field: 'ai', proposedValue: ['Solar'] }, { ...base, id: 'none', field: 'ai', proposedValue: [] }])[0]).toMatchObject({ conflict: true, canAccept: false, proposed: { mode: 'unknown' } });
  expect(groupCandidates([{ ...base, evidence: [] }])[0]?.canAccept).toBe(false);
});

test('comma-packed AI items deduplicate against individual items and require user confirmation', () => {
  const base = analysisResult().candidates[0]!;
  const group = groupCandidates([{ ...base, field: 'ai', proposedValue: ['Solar, Embed, LangGraph'] }, { ...base, id: 'embed', field: 'ai', proposedValue: ['Embed'] }])[0]!;
  expect(group.values).toEqual(['Solar', 'Embed', 'LangGraph']); expect(group.proposed.value).toBe('Solar\nEmbed\nLangGraph'); expect(group.canAccept).toBe(false);
});
