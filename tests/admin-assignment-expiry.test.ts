/**
 * Admin assignment expiry and two-person privileged grants (#276).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('every catalogue role is privileged under default grant rules', async () => {
  const { ADMIN_ROLES, isPrivilegedRole } = await import('../src/services/admin-rbac.service');
  for (const role of ADMIN_ROLES) {
    assert.ok(isPrivilegedRole(role), `${role} should require propose/approve`);
  }
});

test('assignmentExpiresAt advances beyond now', async () => {
  const { assignmentExpiresAt } = await import('../src/services/admin-rbac.service');
  const now = new Date();
  const exp = assignmentExpiresAt('auditor', now);
  assert.ok(exp.getTime() > now.getTime());
});