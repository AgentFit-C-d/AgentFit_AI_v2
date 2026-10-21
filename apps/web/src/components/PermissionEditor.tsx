'use client';
import type { ConfigurationPolicy, RecommendationDto, PermissionPolicy } from '@agentfit/contracts';
export function PermissionEditor({ recommendation, selectedIds, policies, onChange, disabled }: { recommendation: RecommendationDto; selectedIds: string[]; policies: ConfigurationPolicy[]; onChange(value: ConfigurationPolicy[]): void; disabled: boolean }) {
  const items = recommendation.items.filter(x => selectedIds.includes(x.catalogItemId));
  return <fieldset disabled={disabled}><legend>선택한 구성의 권한</legend><p className="notice">현재 자연어 Skill은 실행 권한을 강제하지 않습니다. PC의 실제 권한·상위 정책은 미검증입니다.</p>{items.flatMap(item => item.permissionOptions.map(option => {
    const current = policies.find(x => x.catalogItemId === item.catalogItemId && x.key === option.key && x.resourceScope === option.resourceScope);
    return <label key={`${item.catalogItemId}-${option.key}`}>{option.key} · {option.resourceScope}<select aria-label={`${item.catalogItemId} ${option.key} 권한`} value={current?.policy ?? 'ASK_EACH_TIME'} onChange={event => onChange([...policies.filter(x => x !== current), { catalogItemId: item.catalogItemId, key: option.key, resourceScope: option.resourceScope, mappingId: option.mapping, policy: event.target.value as PermissionPolicy }])}>{option.supportedPolicies.map(policy => <option key={policy} value={policy}>{policy === 'ASK_EACH_TIME' ? '매번 확인' : policy === 'ALWAYS_ALLOW' ? '항상 허용' : '거부'}</option>)}</select>{item.required && current?.policy === 'DENY' && <p role="alert">필수 권한 거부로 생성이 중단됩니다.</p>}</label>;
  }))}</fieldset>;
}
