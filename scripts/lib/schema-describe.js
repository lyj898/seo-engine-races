/**
 * Turns a zod object schema into a human/LLM-readable field list, e.g.:
 *   - date (string, required)
 *   - distance_km (array of number, required)
 *   - primary_distance_km (number, optional)
 *   - registration_status (string, optional)
 *
 * This is what keeps prompts.js genuinely vertical-agnostic: it never
 * imports or hardcodes a specific vertical's field names. It introspects
 * whatever core-facts schema getCoreFactsSchema(verticalKey) returns (see
 * src/lib/schema/core-facts/*.js), so a hotels/courses/event-planning
 * instance gets an accurate prompt description automatically, with zero
 * changes to this file or to the discover/refresh/summary prompt builders.
 *
 * Deliberately defensive: zod's internal `_def` shape is undocumented API,
 * not covered by semver. If a future zod version changes it, a per-field
 * introspection failure falls back to a generic "(value)" description
 * instead of crashing the whole discovery/refresh run.
 */
function unwrap(zodType) {
  let current = zodType;
  let required = true;
  // Zod wraps .optional()/.default()/.nullable() around the base type.
  // Walk inward until we hit a type with no wrapper, tracking whether any
  // wrapper along the way makes the field non-required.
  while (current?._def) {
    const name = current._def.typeName;
    if (name === 'ZodOptional' || name === 'ZodDefault') {
      required = false;
      current = current._def.innerType;
    } else if (name === 'ZodNullable') {
      current = current._def.innerType;
    } else {
      break;
    }
  }
  return { base: current, required };
}

function describeBase(zodType) {
  const name = zodType?._def?.typeName;
  switch (name) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray': {
      const { base } = unwrap(zodType._def.type);
      return `array of ${describeBase(base)}`;
    }
    case 'ZodEnum':
      return `one of [${zodType._def.values.map((v) => `"${v}"`).join(', ')}]`;
    case 'ZodRecord':
    case 'ZodObject':
      return 'object';
    case 'ZodAny':
    case 'ZodUnknown':
      return 'any';
    default:
      return 'value';
  }
}

/** Returns a bullet-list string describing every field in a zod object schema. */
export function describeSchemaShape(zodObjectSchema) {
  const shape = zodObjectSchema?.shape;
  if (!shape) return '(schema shape unavailable)';

  const lines = [];
  for (const [field, zodType] of Object.entries(shape)) {
    try {
      const { base, required } = unwrap(zodType);
      lines.push(`- ${field} (${describeBase(base)}, ${required ? 'required' : 'optional'})`);
    } catch {
      lines.push(`- ${field} (value)`);
    }
  }
  return lines.join('\n');
}
