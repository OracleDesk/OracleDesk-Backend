import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { integrationEnv, skipReason } from './setup';

/**
 * #221: ensureAdminRbacSeeded only seeds an empty database, so the outbox
 * console permissions reach an already-seeded database through the
 * 20261120100000_outbox_console_permissions data migration.
 */

let db: Awaited<ReturnType<typeof integrationEnv>>;
let prisma: import('@prisma/client').PrismaClient;

const MIGRATION = path.resolve(
  __dirname,
  '../../../prisma/migrations/20261120100000_outbox_console_permissions/migration.sql',
);
const NEW_PERMISSIONS = ['chain.outbox.read', 'chain.outbox.operate'];

before(async () => {
  db = await integrationEnv('outbox-console');
  if (!db) return;
  prisma = (await import('../../src/lib/prisma')).prisma;
});
after(async () => {
  if (!db) return;
  await prisma.$disconnect();
  await db.drop();
});

/** Runs the migration file statement by statement, as `prisma migrate deploy` would. */
async function runMigration(): Promise<void> {
  const sql = fs
    .readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  for (const statement of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function grants(): Promise<Record<string, string[]>> {
  const rows = await prisma.adminRolePermission.findMany({
    where: { permissionKey: { in: NEW_PERMISSIONS } },
    orderBy: [{ roleName: 'asc' }, { permissionKey: 'asc' }],
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.roleName] ??= []).push(r.permissionKey);
  return out;
}

test('the migration adds the outbox console permissions to an already-seeded database', { skip: skipReason() }, async () => {
  const { ensureAdminRbacSeeded } = await import('../../src/services/admin-rbac.service');
  await ensureAdminRbacSeeded();

  // Simulate a database seeded before #221: same catalogue minus the new keys.
  await prisma.adminRolePermission.deleteMany({ where: { permissionKey: { in: NEW_PERMISSIONS } } });
  await prisma.adminPermission.deleteMany({ where: { key: { in: NEW_PERMISSIONS } } });
  assert.deepEqual(await grants(), {});
  const before = await prisma.adminRolePermission.count();

  // A later boot does not repair it: the seed only runs on an empty database.
  await ensureAdminRbacSeeded();
  assert.deepEqual(await grants(), {});

  await runMigration();
  assert.deepEqual(
    (await prisma.adminPermission.findMany({ where: { key: { in: NEW_PERMISSIONS } }, orderBy: { key: 'asc' } })).map((p) => p.key),
    ['chain.outbox.operate', 'chain.outbox.read'],
  );
  assert.deepEqual(await grants(), {
    auditor: ['chain.outbox.read'],
    operator: ['chain.outbox.operate', 'chain.outbox.read'],
    super_admin: ['chain.outbox.operate', 'chain.outbox.read'],
  });
  assert.equal(await prisma.adminRolePermission.count(), before + 5);

  // Forward-only and idempotent: a re-run changes nothing.
  await runMigration();
  assert.equal(await prisma.adminRolePermission.count(), before + 5);
});

test('on a fresh database the migration grants nothing and the boot seed assigns the permissions', { skip: skipReason() }, async () => {
  await prisma.adminRoleAssignment.deleteMany({});
  await prisma.adminRolePermission.deleteMany({});
  await prisma.adminRole.deleteMany({});
  await prisma.adminPermission.deleteMany({});

  await runMigration();
  assert.deepEqual(await grants(), {}, 'no roles yet, so no grants');

  const { ensureAdminRbacSeeded } = await import('../../src/services/admin-rbac.service');
  await ensureAdminRbacSeeded();
  assert.deepEqual(await grants(), {
    auditor: ['chain.outbox.read'],
    operator: ['chain.outbox.operate', 'chain.outbox.read'],
    super_admin: ['chain.outbox.operate', 'chain.outbox.read'],
  });
});
