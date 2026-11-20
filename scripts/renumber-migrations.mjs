#!/usr/bin/env node
/**
 * Renames collision-prefixed migrations (#262).
 *
 * Usage:
 *   node scripts/renumber-migrations.mjs --apply-db    # rename rows in _prisma_migrations
 *   node scripts/renumber-migrations.mjs --apply-fs    # git mv migration folders
 *   node scripts/renumber-migrations.mjs --dry-run     # print the plan only (default)
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(import.meta.dirname ?? process.cwd(), '..');
const MAP    = JSON.parse(readFileSync(path.join(ROOT, 'prisma', 'migration-renames.json'), 'utf8'));
const dbUrl  = process.env.DATABASE_URL;

const applyDb = process.argv.includes('--apply-db');
const applyFs = process.argv.includes('--apply-fs');
const dryRun  = !applyDb && !applyFs;

const renames = MAP.filter(r => r.from !== r.to);

if (renames.length === 0) {
  console.log('No renames required; all prefixes are already unique.');
  process.exit(0);
}

console.log(`${dryRun ? '[dry-run] ' : ''}${renames.length} migration(s) to rename:\n`);
for (const r of renames) {
  console.log(`  ${r.from}  →  ${r.to}`);
}

// ---------------------------------------------------------------------------
// --apply-db: update _prisma_migrations in one transaction
// ---------------------------------------------------------------------------

if (applyDb) {
  if (!dbUrl) { console.error('DATABASE_URL is required for --apply-db.'); process.exit(1); }

  // Refuse to touch unfinished or rolled-back migrations.
  const checkSql = renames
    .map(r => `'${r.from}'`)
    .join(', ');
  const guardSql = `
    SELECT migration_name FROM "_prisma_migrations"
    WHERE migration_name IN (${checkSql})
      AND (finished_at IS NULL OR rolled_back_at IS NOT NULL);
  `;
  let unsafe;
  try {
    unsafe = execSync(`psql "${dbUrl}" -t -c "${guardSql}"`, { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error('Failed to query _prisma_migrations:', e.message);
    process.exit(1);
  }
  if (unsafe) {
    console.error('Refusing to rename unfinished or rolled-back migrations:\n' + unsafe);
    process.exit(1);
  }

  // Build a single-transaction UPDATE for each rename (idempotent).
  const updates = renames.map(r => `
    UPDATE "_prisma_migrations"
    SET migration_name = '${r.to}'
    WHERE migration_name = '${r.from}'
      AND NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '${r.to}'
      );
  `).join('');

  const sql = `BEGIN;\n${updates}\nCOMMIT;`;
  try {
    const out = execSync(`psql "${dbUrl}" -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    console.log('\nDB rename result:\n' + out);
  } catch (e) {
    console.error('DB rename failed:', e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// --apply-fs: git mv the migration folders
// ---------------------------------------------------------------------------

if (applyFs) {
  for (const r of renames) {
    const src  = path.join(ROOT, 'prisma', 'migrations', r.from);
    const dest = path.join(ROOT, 'prisma', 'migrations', r.to);
    console.log(`git mv ${r.from} → ${r.to}`);
    try {
      execSync(`git mv "${src}" "${dest}"`, { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error(`git mv failed for ${r.from}:`, e.message);
      process.exit(1);
    }
  }
  console.log('\nFS renames complete. Stage and commit the result.');
}
