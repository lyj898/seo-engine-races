import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../../data');

/**
 * Shared, dependency-free data loader used by both Astro pages at build
 * time (Step 4) and by plain-Node scripts (validate-data.js and friends).
 * Deliberately has no Astro-specific imports so it works in both contexts.
 */
function readJsonDir(dirName) {
  const dir = path.join(DATA_ROOT, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON in data/${dirName}/${f}: ${err.message}`);
      }
      // __file is metadata for error messages / debugging -- strip it
      // before validating or rendering (schemas don't define it, so
      // zod's default .strict()-free objects would otherwise pass it
      // through silently).
      return { __file: `data/${dirName}/${f}`, ...parsed };
    });
}

export function loadEntities() {
  return readJsonDir('entities');
}
export function loadCategories() {
  return readJsonDir('categories');
}
export function loadRegions() {
  return readJsonDir('regions');
}
export function loadListicles() {
  return readJsonDir('listicles');
}

/** Strips the __file debug field before handing data to a schema or a page. */
export function stripMeta(item) {
  const { __file, ...rest } = item;
  return rest;
}

/**
 * Builds a region_id -> [region_id, ...all ancestor region_ids] map, so a
 * "Thailand" (country) listicle/hub filter can match races whose region_id
 * is the more specific "Nong Khai" (city, parent_region_id: "thailand")
 * without any vertical-specific geography logic.
 */
export function buildRegionAncestryMap(regions) {
  const byId = new Map(regions.map((r) => [r.region_id, r]));
  const map = new Map();
  for (const region of regions) {
    const chain = [region.region_id];
    let current = region;
    while (current.parent_region_id) {
      chain.push(current.parent_region_id);
      current = byId.get(current.parent_region_id);
      if (!current) break; // dangling parent_region_id -- validate-data.js should flag this
    }
    map.set(region.region_id, chain);
  }
  return map;
}
