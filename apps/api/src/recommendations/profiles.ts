import { assertNoSecretsData, ContractError, validateDeveloperPatch, validateEnvironmentPatch, type DeveloperProfile, type EnvironmentProfile, type StoredProfile, type RecommendationBasis } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../http/errors';
export async function lockOwnedProject(tx: Prisma.TransactionClient, owner: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${id} AND "ownerId" = ${owner} AND "deletingAt" IS NULL FOR UPDATE`);
  if (!rows.length) throw new AppError('PROJECT_NOT_FOUND', 404);
  return tx.project.findUniqueOrThrow({ where: { id }, include: { developerProfile: true, environmentProfile: true } });
}
export function basisOf(project: { version: number; developerProfile: { version: number } | null; environmentProfile: { version: number } | null }, revision: string): RecommendationBasis {
  return { projectVersion: project.version, developerVersion: project.developerProfile?.version ?? 0, environmentVersion: project.environmentProfile?.version ?? 0, catalogRevision: revision };
}
function stored<T>(value: { data: Prisma.JsonValue; version: number; updatedAt: Date } | null): StoredProfile<T> | null {
  return value ? { data: value.data as T, version: value.version, updatedAt: value.updatedAt.toISOString(), source: 'USER_DECLARED' } : null;
}
export function validatePublic<T>(validator: (v: unknown) => T, input: unknown, secrets: readonly string[] = []): T {
  try { const value = validator(input); assertNoSecretsData(value, secrets); return value; }
  catch (e) { if (e instanceof ContractError) throw new AppError(e.code, 422); throw e; }
}
export class ProfileRepository {
  constructor(private readonly db: PrismaClient, private readonly secrets: readonly string[] = []) {}
  private async read(owner: string, id: string) {
    const project = await this.db.project.findFirst({ where: { id, ownerId: owner, deletingAt: null }, include: { developerProfile: true, environmentProfile: true } });
    if (!project) throw new AppError('PROJECT_NOT_FOUND', 404);
    return project;
  }
  async getDeveloper(owner: string, id: string) { return stored<DeveloperProfile>((await this.read(owner, id)).developerProfile); }
  async getEnvironment(owner: string, id: string) { return stored<EnvironmentProfile>((await this.read(owner, id)).environmentProfile); }
  async putDeveloper(owner: string, id: string, input: unknown): Promise<StoredProfile<DeveloperProfile>> {
    const patch = validatePublic(validateDeveloperPatch, input, this.secrets);
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, id);
      if ((project.developerProfile?.version ?? 0) !== patch.expectedVersion) throw new AppError('VERSION_CONFLICT', 409);
      return stored<DeveloperProfile>(await tx.developerProfile.upsert({ where: { projectId: id }, create: { projectId: id, data: patch.data }, update: { data: patch.data, version: { increment: 1 } } }))!;
    }, { timeout: 5000 });
  }
  async putEnvironment(owner: string, id: string, input: unknown): Promise<StoredProfile<EnvironmentProfile>> {
    const patch = validatePublic(validateEnvironmentPatch, input, this.secrets);
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, id);
      if ((project.environmentProfile?.version ?? 0) !== patch.expectedVersion) throw new AppError('VERSION_CONFLICT', 409);
      return stored<EnvironmentProfile>(await tx.environmentProfile.upsert({ where: { projectId: id }, create: { projectId: id, data: patch.data }, update: { data: patch.data, version: { increment: 1 } } }))!;
    }, { timeout: 5000 });
  }
  async getBasis(owner: string, id: string, revision: string): Promise<RecommendationBasis> { return basisOf(await this.read(owner, id), revision); }
}
