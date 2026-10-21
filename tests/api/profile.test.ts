import { expect, test } from 'vitest';
import request from 'supertest';
import { emptyProfile } from '../../packages/contracts/src';
import { resolveReview } from '../../apps/api/src/projects/profile';
import { createApp } from '../../apps/api/src/app';
import { MemoryProjectRepository } from '../support/projects';
import { analysisResult } from '../support/analysis';
const origin = 'http://localhost:3000';
test('confirms unknown/explicit-none and assigns only edited values to USER', () => {
  const result = resolveReview(null, null, { expectedVersion: 1, profile: { ...emptyProfile(), backend: [] } });
  expect(result.profile.database).toBeNull();
  expect(result.profile.backend).toEqual([]);
  expect(result.sources.database.source).toBe('UNKNOWN');
  expect(result.sources.backend.source).toBe('USER');
  const reopened = resolveReview(result, null, { expectedVersion: 2, profile: result.profile });
  expect(reopened.sources).toEqual(result.sources);
});
test('only explicitly accepted matching grounded candidates become DOCUMENT', () => {
  const draft = analysisResult();
  const patch = { expectedVersion: 1, profile: draft.profile, draftId: 'draft-1', draftVersion: 1 };
  const accepted = resolveReview(null, draft, { ...patch, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'ACCEPT' }] });
  expect(accepted.sources.backend.source).toBe('DOCUMENT');
  expect(accepted.sources.backend.evidence).toEqual(draft.candidates[0]!.evidence);
  for (const action of ['REJECT', 'DEFER'] as const) {
    const result = resolveReview(null, draft, { ...patch, profile: emptyProfile(), reviewDecisions: [{ itemId: 'backend-1', version: 1, action }] });
    expect(result.sources.backend.source).toBe('UNKNOWN');
  }
  const unchanged = resolveReview(accepted, analysisResult(), { expectedVersion: 2, profile: accepted.profile });
  expect(unchanged.sources).toEqual(accepted.sources);
});
test('rejects foreign/stale/duplicate candidates and accepted mismatches', () => {
  const draft = analysisResult();
  for (const decisions of [
    [{ itemId: 'other-project', version: 1, action: 'ACCEPT' as const }],
    [{ itemId: 'backend-1', version: 2, action: 'ACCEPT' as const }],
    [{ itemId: 'backend-1', version: 1, action: 'ACCEPT' as const }, { itemId: 'backend-1', version: 1, action: 'REJECT' as const }],
  ]) expect(() => resolveReview(null, draft, { expectedVersion: 1, profile: draft.profile, draftId: 'd', draftVersion: 1, reviewDecisions: decisions })).toThrow();
  expect(() => resolveReview(null, draft, { expectedVersion: 1, profile: emptyProfile(), draftId: 'd', draftVersion: 1, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'ACCEPT' }] })).toThrow();
  const ungrounded = analysisResult(); ungrounded.candidates[0]!.evidence = [];
  expect(() => resolveReview(null, ungrounded, { expectedVersion: 1, profile: ungrounded.profile, draftId: 'd', draftVersion: 1, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'ACCEPT' }] })).toThrow();
});
test('requires EDIT to agree with submitted value, and does not auto-pick conflicts', () => {
  const draft = analysisResult();
  draft.candidates.push({ ...draft.candidates[0]!, id: 'backend-2', proposedValue: ['FastAPI'] });
  const edited = resolveReview(null, draft, { expectedVersion: 1, profile: { ...emptyProfile(), backend: ['NestJS'] }, draftId: 'd', draftVersion: 1, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'EDIT', editedValue: ['NestJS'] }] });
  expect(edited.sources.backend.source).toBe('USER');
  expect(edited.sources.backend.evidence).toEqual([]);
  expect(() => resolveReview(null, draft, { expectedVersion: 1, profile: draft.profile, draftId: 'd', draftVersion: 1, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'EDIT', editedValue: ['NestJS'] }] })).toThrow();
});
test('profile PATCH saves once, rejects stale versions and retains confirmed data on new drafts', async () => {
  const projects = new MemoryProjectRepository();
  const project = await projects.create('alice', 'Profile');
  const app = createApp({ webOrigin: origin, projects, session: async () => ({ id: 'alice', name: 'Alice' }) });
  const profile = { ...emptyProfile(), backend: ['Express.js'] };
  const save = () => request(app).patch(`/api/projects/${project.id}/profile`).set('Origin', origin).send({ expectedVersion: 1, profile });
  const result = await save();
  expect(result.status).toBe(200);
  expect(result.body.version).toBe(2);
  expect(result.body.confirmedProfile.profile).toEqual(profile);
  expect((await save()).status).toBe(409);
  expect((await request(app).patch(`/api/projects/${project.id}/profile`).set('Origin', origin).send({ expectedVersion: 2, profile, draftId: 'missing-version' })).status).toBe(400);
  const stored = projects.records.get(project.id)!;
  stored.draft = { id: 'new-draft', version: 1, result: analysisResult() };
  expect((await request(app).get(`/api/projects/${project.id}`)).body.confirmedProfile.profile).toEqual(profile);
  expect((await request(app).patch(`/api/projects/${project.id}/profile`).set('Origin', origin).send({ expectedVersion: 2, profile, draftId: 'other-project', draftVersion: 1 })).status).toBe(409);
});
