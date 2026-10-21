import { codePointLength, emptyProfile, PROFILE_FIELDS, profileArrayLimit, validateProfile, type ProfileField, type ProjectProfile } from '@agentfit/contracts';
import { normalizeProfileValues } from './profile-values';
export const labels: Record<ProfileField, string> = { project_name: '프로젝트 이름', project_type: '프로젝트 유형', domain: '분야', frontend: '프론트엔드', backend: '백엔드', ai: 'AI', database: '데이터베이스', deployment: '배포 환경', features: '기능', external_integrations: '외부 연동' };
export const arrayFields = new Set<ProfileField>(['frontend', 'backend', 'ai', 'features', 'external_integrations']);
export interface FieldForm { mode: 'unknown' | 'none' | 'value'; value: string }
export type ProfileForm = Record<ProfileField, FieldForm>;
export class ProfileInputError extends Error {
  constructor(readonly field: ProfileField, readonly detail: string) { super('INVALID_PROFILE'); }
}
export function toForm(profile: ProjectProfile = emptyProfile()): ProfileForm {
  return Object.fromEntries(PROFILE_FIELDS.map(field => {
    const value = profile[field];
    return [field, { mode: value === null ? 'unknown' : Array.isArray(value) && value.length === 0 ? 'none' : 'value', value: Array.isArray(value) ? value.join(', ') : value ?? '' }];
  })) as ProfileForm;
}
export function fromForm(form: ProfileForm): ProjectProfile {
  const profile = emptyProfile();
  for (const field of PROFILE_FIELDS) {
    if ((form[field].mode === 'none' && !arrayFields.has(field)) || (form[field].mode === 'value' && arrayFields.has(field) && !form[field].value.split(/[,\n]/).some(value => value.trim()))) throw new Error('INVALID_PROFILE');
    const value = form[field].mode === 'unknown' ? null : form[field].mode === 'none' ? [] : arrayFields.has(field) ? normalizeProfileValues(field, [form[field].value]) : form[field].value.trim();
    if (Array.isArray(value) && value.length > profileArrayLimit(field)) throw new ProfileInputError(field, `${value.length}개로 최대 ${profileArrayLimit(field)}개를 초과했습니다. 필요한 항목을 줄여 주세요.`);
    for (const [index, item] of (Array.isArray(value) ? value : value === null ? [] : [value]).entries()) {
      const length = codePointLength(item);
      if (length > 200) throw new ProfileInputError(field, `${Array.isArray(value) ? `${index + 1}번째 항목이 ` : ''}${length}자로 최대 200자를 초과했습니다. 한 줄에 하나씩 나누거나 짧게 수정해 주세요.`);
    }
    Object.assign(profile, { [field]: value });
  }
  return validateProfile(profile);
}
