import { writeFile } from 'node:fs/promises';
const text = { type: 'string', minLength: 1, maxLength: 200 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const list = items => nullable({ type: 'array', maxItems: 30, items });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const choice = values => ({ type: 'string', enum: values });
const developer = object({ role: nullable(choice(['FRONTEND', 'BACKEND', 'FULL_STACK', 'AI', 'DESIGNER'])), responsibilities: list(text), experienceLevel: nullable(choice(['BEGINNER', 'INTERMEDIATE', 'EXPERIENCED'])) });
const environment = object({
  os: nullable(object({ family: choice(['WINDOWS', 'MACOS', 'LINUX', 'OTHER']), version: nullable(text) })),
  client: nullable(object({ id: text, version: nullable(text) })),
  runtimes: list(object({ name: text, version: nullable(text) })),
  installedComponents: list(object({ catalogItemId: nullable(text), name: text, version: nullable(text) })),
  configurationKnowledge: choice(['UNKNOWN', 'USER_SAYS_EMPTY', 'HAS_EXISTING']),
  authenticationReadiness: list(object({ serviceId: text, state: choice(['READY', 'NOT_READY', 'UNKNOWN']) })),
});
const version = { type: 'integer', minimum: 0, maximum: 2147483646 };
const schema = { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'https://agentfit.local/schema/recommendations.json', definitions: {
  developer, environment,
  developerPatch: object({ expectedVersion: version, data: developer }),
  environmentPatch: object({ expectedVersion: version, data: environment }),
  recommendationInput: object({ expectedVersions: object({ project: { ...version, minimum: 1 }, developer: version, environment: version }) }),
} };
await writeFile(new URL('../packages/contracts/schema/recommendations.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
