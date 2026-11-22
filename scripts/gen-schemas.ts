/**
 * Thin CLI wrapper around `src/schemas/generate.ts`. All schema definitions
 * live in the source tree so the route and the CLI share one implementation
 * (see issue #234). This file keeps backwards-compat exports for tests and
 * CI scripts that still import from `scripts/gen-schemas`.
 */

export {
  TRACE_V1_SCHEMA,
  TRACE_V2_SCHEMA,
  QUESTION_V1_SCHEMA,
  QUESTION_V2_SCHEMA,
  REPORT_V2_SCHEMA,
  SCHEMA_TARGETS,
  jsonSchemaFor,
  generateSchemas,
} from '../src/schemas/generate';

import { generateSchemas as run } from '../src/schemas/generate';

if (process.argv[1]?.endsWith('gen-schemas.ts') || process.argv[1]?.endsWith('gen-schemas.js')) {
  const isCheck = process.argv.includes('--check');
  const ok = run({ check: isCheck });
  if (isCheck && !ok) {
    console.error('JSON schemas are out of date. Run `npm run gen:schemas` to regenerate.');
    process.exit(1);
  }
}
