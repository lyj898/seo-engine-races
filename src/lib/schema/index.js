import {
  baseEntitySchema,
  categorySchema,
  regionSchema,
  listicleSchema,
} from './base.js';
import { getCoreFactsSchema } from './core-facts/index.js';

export * from './base.js';
export { getCoreFactsSchema, coreFactsRegistry } from './core-facts/index.js';

/**
 * Builds the full entity schema for a given vertical: universal fields +
 * that vertical's core_facts shape. This is what validate-data.js and
 * scripts/generate-summaries.js should import -- never baseEntitySchema
 * directly -- so core_facts actually gets validated instead of accepted
 * as an untyped blob.
 */
export function getEntitySchema(verticalKey) {
  return baseEntitySchema.extend({
    core_facts: getCoreFactsSchema(verticalKey),
  });
}

export { baseEntitySchema, categorySchema, regionSchema, listicleSchema };
