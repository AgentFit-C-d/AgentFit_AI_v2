import { assertNoSecrets, assertNoSecretsData, validateCreateProject, validateProfilePatch, type ProfilePatch, type ConfirmedProfile, type ProjectDto } from '@agentfit/contracts';
import { AppError } from '../http/errors';
export interface ProjectRecord { id: string; ownerId: string; name: string; version: number; createdAt: Date; updatedAt: Date; confirmedProfile: ConfirmedProfile | null; draft?: ProjectDto['draft']; activeAttempt?: ProjectDto['activeAttempt'] }
export interface ProjectRepository {
  create(ownerId: string, name: string): Promise<ProjectRecord>;
  list(ownerId: string): Promise<ProjectRecord[]>;
  findOwned(ownerId: string, id: string): Promise<ProjectRecord | null>;
  saveProfile(ownerId: string, id: string, patch: ProfilePatch): Promise<ProjectRecord>;
}
export function projectDto(record: ProjectRecord): ProjectDto {
  return { id: record.id, name: record.name, version: record.version, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), confirmedProfile: record.confirmedProfile, draft: record.draft ?? null, activeAttempt: record.activeAttempt ?? null };
}
export class ProjectsService {
  constructor(private readonly repository: ProjectRepository, private readonly knownSecrets: readonly string[] = []) {}
  async createProject(userId: string, body: unknown): Promise<ProjectDto> {
    const { name } = validateCreateProject(body);
    assertNoSecrets(name, this.knownSecrets);
    return projectDto(await this.repository.create(userId, name.trim()));
  }
  async listProjects(userId: string): Promise<ProjectDto[]> { return (await this.repository.list(userId)).map(projectDto); }
  async getOwnedProject(userId: string, id: string): Promise<ProjectDto> {
    const record = await this.repository.findOwned(userId, id);
    if (!record) throw new AppError('PROJECT_NOT_FOUND', 404);
    return projectDto(record);
  }
  async saveConfirmedProfile(userId: string, id: string, body: unknown) {
    const patch = validateProfilePatch(body);
    assertNoSecretsData(patch, this.knownSecrets);
    return projectDto(await this.repository.saveProfile(userId, id, patch));
  }
}
