import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../packages/contracts/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('schema/profile.json', root), 'utf8'));
const properties = Object.entries(schema.properties).map(([field, property]) => {
  const definition = schema.definitions[property.$ref.split('/').at(-1)];
  const array = definition.anyOf.some(option => option.type === 'array');
  return `  ${field}: ${array ? 'string[]' : 'string'} | null;`;
});
writeFileSync(new URL('src/profile.generated.ts', root), '// Generated from schema/profile.json by tools/generate-contract-types.mjs.\nexport interface ProjectProfile {\n' + properties.join('\n') + '\n}\n');
