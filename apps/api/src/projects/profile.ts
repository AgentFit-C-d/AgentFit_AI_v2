import { validateProfilePatch, validateAnalysisResult, type AnalysisResult, type ConfirmedProfile, type ProfilePatch, type ProfileField, type AnalysisCandidate, type FieldSources, type ProjectDto } from '@agentfit/contracts';
import { AppError } from '../http/errors';
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function assertDraftMatch(draft: ProjectDto['draft'], patch: ProfilePatch) {
  if (patch.draftId && (!draft || draft.id !== patch.draftId || draft.version !== patch.draftVersion)) throw new AppError('DRAFT_VERSION_CONFLICT', 409);
}
export function resolveReview(previous: ConfirmedProfile | null, draft: AnalysisResult | null, input: ProfilePatch, now = new Date()): ConfirmedProfile {
  const patch = validateProfilePatch(input);
  if (draft) draft = validateAnalysisResult(draft);
  const sources = {} as FieldSources;
  for (const field of Object.keys(patch.profile) as ProfileField[]) {
    sources[field] = patch.profile[field] === null ? { source: 'UNKNOWN', evidence: [] }
      : previous && equal(previous.profile[field], patch.profile[field]) ? structuredClone(previous.sources[field]) : { source: 'USER', evidence: [] };
  }
  const seen = new Set<string>();
  const accepted = new Map<ProfileField, AnalysisCandidate[]>();
  const edited = new Set<ProfileField>();
  for (const decision of patch.reviewDecisions ?? []) {
    if (seen.has(decision.itemId)) throw new AppError('DUPLICATE_REVIEW', 400);
    seen.add(decision.itemId);
    const candidate = draft?.candidates.find(c => c.id === decision.itemId && c.version === decision.version);
    if (!candidate) throw new AppError('CANDIDATE_VERSION_CONFLICT', 409);
    if (decision.action === 'REJECT' || decision.action === 'DEFER') {
      if (decision.editedValue !== undefined) throw new AppError('INVALID_REVIEW', 400);
      continue;
    }
    const field = candidate.field;
    if (!field) throw new AppError('UNRESOLVED_FIELD', 400);
    if (decision.action === 'EDIT') {
      if (decision.editedValue === undefined || !equal(decision.editedValue, patch.profile[field])) throw new AppError('REVIEW_VALUE_MISMATCH', 400);
      edited.add(field);
      sources[field] = patch.profile[field] === null ? { source: 'UNKNOWN', evidence: [] } : { source: 'USER', evidence: [] };
    } else {
      if (decision.editedValue !== undefined || candidate.proposedValue === null || candidate.status === 'unknown' || !candidate.evidence.length) throw new AppError('UNGROUNDED_CANDIDATE', 400);
      accepted.set(field, [...(accepted.get(field) ?? []), candidate]);
    }
  }
  for (const [field, candidates] of accepted) {
    if (edited.has(field)) throw new AppError('CONFLICTING_REVIEW', 400);
    const values = candidates.map(c => c.proposedValue);
    const submitted = patch.profile[field];
    const matches = Array.isArray(submitted)
      ? values.every(Array.isArray) && equal([...new Set(values.flat() as string[])].sort(), [...submitted].sort())
      : values.every(value => equal(value, submitted));
    if (!matches) throw new AppError('REVIEW_VALUE_MISMATCH', 400);
    sources[field] = { source: 'DOCUMENT', evidence: candidates.flatMap(c => c.evidence) };
  }
  return { profile: patch.profile, sources, confirmedAt: now.toISOString() };
}
