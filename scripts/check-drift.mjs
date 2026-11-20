#!/usr/bin/env node
/**
 * Schema/migration drift checker (#262).
 *
 * Runs `prisma validate`, then diffs in both directions using a shadow
 * database, filters known-exempt objects via prisma/drift-allowlist.json,
 * and exits 1 if any unexplained drift remains or any timed-out allowlist
 * entry has expired.
 *
 * Usage:
 *   node scripts/check-drift.mjs [--json]
 *
 * Environment:
 *   DATABASE_URL          — required; used to auto-create the shadow DB when
 *                           SHADOW_DATABASE_URL is absent.
 *   SHADOW_DATABASE_URL   — optional; if unset a shadow DB named
 *                           <db>_shadow_<pid> is created on the same server
 *                           and dropped on exit.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? process.cwd(), '..');
const ALLOWLIST_PATH = path.join(ROOT, 'prisma', 'drift-allowlist.json');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');
const SCHEMA_PATH    = path.join(ROOT, 'prisma', 'schema.prisma');
const JSON_MODE = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, { silent = false } = {}) {
  const result = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: ROOT });
  if (!silent && result.stdout) process.stdout.write(result.stdout);
  if (!silent && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function log(msg) {
  if (!JSON_MODE) console.log(msg);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));

const today = new Date().toISOString().slice(0, 10);
const expired = allowlist.filter(e => e.expires && e.expires < today);
if (expired.length) {
  for (const e of expired) {
    console.error(`drift-allowlist: entry for "${e.object}" expired on ${e.expires} (issue #${e.issue}). Remove the exemption or extend the deadline.`);
  }
  process.exit(1);
}

function isAllowed(sql) {
  return allowlist.some(e => sql.includes(e.match));
}

// ---------------------------------------------------------------------------
// Shadow database lifecycle
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) die('DATABASE_URL is required.');

let shadowUrl = process.env.SHADOW_DATABASE_URL;
let shadowCreated = false;

if (!shadowUrl) {
  const u = new URL(dbUrl);
  const shadowDb = `${u.pathname.slice(1)}_shadow_${process.pid}`;
  u.pathname = `/${shadowDb}`;
  shadowUrl = u.toString();

  log(`Creating shadow database ${shadowDb}…`);
  try {
    execSync(
      `psql "${dbUrl}" -c "CREATE DATABASE \\"${shadowDb}\\""`,
      { stdio: 'pipe' },
    );
    shadowCreated = true;
  } catch (err) {
    die(`Failed to create shadow database: ${err.message}`);
  }

  process.on('exit', () => {
    if (!shadowCreated) return;
    try {
      execSync(
        `psql "${dbUrl}" -c "DROP DATABASE IF EXISTS \\"${shadowDb}\\""`,
        { stdio: 'pipe' },
      );
    } catch { /* best-effort */ }
  });
}

// ---------------------------------------------------------------------------
// Step 1: prisma validate
// ---------------------------------------------------------------------------

log('\n── prisma validate ──');
const validate = run(`npx prisma validate --schema=${SCHEMA_PATH}`);
if (validate.status !== 0) process.exit(validate.status ?? 1);

// ---------------------------------------------------------------------------
// Step 2: migrations → schema  (what does applying all migrations give you
//          that the schema doesn't describe?)
// ---------------------------------------------------------------------------

log('\n── diff: migrations → schema ──');
const fwdResult = run(
  `npx prisma migrate diff \
    --from-migrations ${MIGRATIONS_DIR} \
    --to-schema-datamodel ${SCHEMA_PATH} \
    --shadow-database-url "${shadowUrl}" \
    --script`,
  { silent: true },
);

// ---------------------------------------------------------------------------
// Step 3: schema → migrations  (what does the schema declare that the
//          migrations don't create?)
// ---------------------------------------------------------------------------

log('\n── diff: schema → migrations ──');
const revResult = run(
  `npx prisma migrate diff \
    --from-schema-datamodel ${SCHEMA_PATH} \
    --to-migrations ${MIGRATIONS_DIR} \
    --shadow-database-url "${shadowUrl}" \
    --script`,
  { silent: true },
);

// ---------------------------------------------------------------------------
// Evaluate results
// ---------------------------------------------------------------------------

function filterStatements(sql) {
  return sql
    .split(/;/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && !isAllowed(s));
}

const fwdDrift  = filterStatements(fwdResult.stdout ?? '');
const revDrift  = filterStatements(revResult.stdout ?? '');
const anyDrift  = fwdDrift.length > 0 || revDrift.length > 0;
const anyError  = (fwdResult.status ?? 0) !== 0 || (revResult.status ?? 0) !== 0;

if (JSON_MODE) {
  console.log(JSON.stringify({ fwdDrift, revDrift, errors: anyError }, null, 2));
} else {
  if (fwdDrift.length) {
    console.error('\nDrift (migrations → schema): objects in DB not in schema:');
    fwdDrift.forEach(s => console.error(`  ${s.slice(0, 200)}`));
  }
  if (revDrift.length) {
    console.error('\nDrift (schema → migrations): objects in schema not in DB:');
    revDrift.forEach(s => console.error(`  ${s.slice(0, 200)}`));
  }
  if (!anyDrift && !anyError) log('\n✓ No schema/migration drift found.');
}

if (anyDrift || anyError) process.exit(1);
