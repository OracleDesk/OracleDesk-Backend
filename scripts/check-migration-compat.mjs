#!/usr/bin/env node
/**
 * Expand/contract migration linter (#144).
 *
 * Flags statements that break old code during a rolling deploy:
 *   DROP TABLE/COLUMN, ALTER COLUMN ... TYPE, RENAME, SET NOT NULL without a
 *   default, and CREATE INDEX without CONCURRENTLY.
 */
import fs from 'node:fs';
import path from 'node:path';

const RULES = [
  { name: 'drop-table', re: /\bDROP\s+TABLE\b/i, message: 'DROP TABLE breaks running code' },
  { name: 'drop-column', re: /\bDROP\s+COLUMN\b/i, message: 'DROP COLUMN breaks running code' },
  { name: 'alter-type', re: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i, message: 'ALTER COLUMN TYPE needs a backfill or a maintenance window' },
  { name: 'rename', re: /\bRENAME\s+(?:COLUMN|TO)\b/i, message: 'RENAME breaks old queries' },
  { name: 'set-not-null', re: /\bSET\s+NOT\s+NULL\b/i, message: 'SET NOT NULL without a default can fail on existing rows' },
  { name: 'non-concurrent-index', re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?![\s\S]*?\bCONCURRENTLY\b)/i, message: 'CREATE INDEX should use CONCURRENTLY' },
];

export function checkSql(sql) {
  const withoutComments = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  const statements = withoutComments.split(';').map((s) => s.trim()).filter(Boolean);
  const findings = [];
  for (const statement of statements) {
    for (const rule of RULES) {
      const match = rule.re.exec(statement);
      if (!match) continue;
      // SET NOT NULL is safe when the same statement supplies a default.
      if (rule.name === 'set-not-null' && /\bDEFAULT\b/i.test(statement)) continue;
      findings.push({
        rule: rule.name,
        message: rule.message,
        snippet: match[0].replace(/\s+/g, ' ').slice(0, 160),
      });
    }
  }
  return findings;
}

function filesAt(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return filesAt(full);
    return entry.name.endsWith('.sql') ? [full] : [];
  });
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const allowBreaking = args.includes('--allow-breaking');
  if (targets.length === 0) {
    console.error('usage: check-migration-compat.mjs <file|dir> [--allow-breaking]');
    process.exit(2);
  }
  let failed = false;
  for (const target of targets) {
    for (const file of filesAt(target)) {
      for (const finding of checkSql(fs.readFileSync(file, 'utf8'))) {
        console.log(`${file}: ${finding.rule}: ${finding.message}`);
        console.log(`  ${finding.snippet}`);
        failed = true;
      }
    }
  }
  if (failed && !allowBreaking) {
    console.log('Mark the PR with `migration:breaking` and get approval before deploying.');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) main();

// ---------------------------------------------------------------------------
// Folder-name / prefix lint (#262)
// ---------------------------------------------------------------------------

const PREFIX_RE = /^(\d{14})_/;

/**
 * Validates migration folder names for a contribution.
 *
 * @param {string[]} names      - New folder names being added.
 * @param {string[]} baseNames  - All existing folder names on the merge base.
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function checkFolderNames(names, baseNames) {
  const errors = [];
  const allPrefixes = baseNames.map(n => { const m = PREFIX_RE.exec(n); return m ? m[1] : null; }).filter(Boolean);
  const maxBase = allPrefixes.length ? allPrefixes.sort().at(-1) : '00000000000000';

  for (const name of names) {
    const m = PREFIX_RE.exec(name);
    if (!m) {
      errors.push(`"${name}": folder name must start with a 14-digit timestamp prefix followed by '_'.`);
      continue;
    }
    const prefix = m[1];

    if (allPrefixes.includes(prefix) || names.filter(n => PREFIX_RE.exec(n)?.[1] === prefix).length > 1) {
      errors.push(`"${name}": prefix ${prefix} is already used by another migration folder.`);
    }
    if (prefix <= maxBase) {
      errors.push(`"${name}": prefix ${prefix} is not strictly greater than the current maximum (${maxBase}).`);
    }
    allPrefixes.push(prefix);
  }

  return { ok: errors.length === 0, errors };
}
