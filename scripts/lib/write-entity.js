import fs from 'node:fs';

/**
 * Validates an entity against the vertical's schema and only then writes it
 * back to disk, returning whether the write happened.
 *
 * The ordering is the point: every pipeline stage is an AI call that can
 * return something structurally wrong, and a bad write is far more
 * expensive to notice and undo than a skipped one. Validating first means
 * a malformed result costs one skipped entity and a warning line, never a
 * corrupted data file that passes review because nobody re-read it.
 *
 * Note that the *validated* object is what gets written, not the input --
 * zod strips keys the schema doesn't declare. Any new field a stage wants
 * to persist has to be added to the schema first, or it will vanish here
 * silently.
 */
export function writeIfValid(filePath, updatedEntity, entitySchema, logPrefix = 'write-entity') {
  const validation = entitySchema.safeParse(updatedEntity);
  if (!validation.success) {
    console.warn(
      `[${logPrefix}] ${updatedEntity.slug}: updated entity failed schema validation, NOT writing: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
    return false;
  }
  // filePath is "data/entities/foo.json" (relative, from data.js's __file
  // metadata) -- resolve it the same way data.js does, from the repo root.
  fs.writeFileSync(new URL(`../../${filePath}`, import.meta.url), JSON.stringify(validation.data, null, 2) + '\n');
  return true;
}
