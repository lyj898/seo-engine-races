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
 *
 * Every stage that writes an entity calls THIS, rather than keeping a private
 * copy. Two scripts had grown their own, and the copies had already drifted
 * in the one place it matters: this file lives in scripts/lib/ and resolves
 * `../../${filePath}`, while a copy sitting in scripts/ needs `../${filePath}`
 * -- so the resolution depth silently depends on where the copy happens to
 * live. Consolidating removes that class of bug rather than documenting it.
 */
export function writeIfValid(filePath, updatedEntity, entitySchema, logPrefix = 'write-entity', { dryRun = false } = {}) {
  const validation = entitySchema.safeParse(updatedEntity);
  if (!validation.success) {
    console.warn(
      `[${logPrefix}] ${updatedEntity.slug}: updated entity failed schema validation, NOT writing: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
    return false;
  }
  // A dry run still validates and still reports what it would have done --
  // it just stops short of the write. Returning true here means a caller's
  // counters read the same either way, so `--dry-run` previews the real run
  // rather than a differently-shaped one.
  if (dryRun) return true;
  // filePath is "data/entities/foo.json" (relative, from data.js's __file
  // metadata) -- resolve it the same way data.js does, from the repo root.
  fs.writeFileSync(new URL(`../../${filePath}`, import.meta.url), JSON.stringify(validation.data, null, 2) + '\n');
  return true;
}
