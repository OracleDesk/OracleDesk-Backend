import type { Prisma } from '@prisma/client';
import { StrKey } from '@stellar/stellar-sdk';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';
import { withAdvisoryLock } from '../lib/advisory-lock';

export const ADMIN_ROLES = ['super_admin', 'operator', 'auditor'] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'admin.read',
  'admin.manage',
  'admin.audit.read',
  'markets.generate',
  'treasury.read',
  'treasury.operate',
  'agents.manage',
  'disputes.manage',
  'trace_audit.run',
  'reconciliation.run',
  'calibration.recompute',
  'refund.request',
  'refund.approve',
  'refund.prepare',
  'indexer.replay',
  'chain.signing_keys',
  // Admin outbox console (#221); reaches existing databases by migration.
  'chain.outbox.read',
  'chain.outbox.operate',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRoleName, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  operator: [
    'admin.read',
    'markets.generate',
    'treasury.read',
    'treasury.operate',
    'agents.manage',
    'disputes.manage',
    'trace_audit.run',
    'reconciliation.run',
    'calibration.recompute',
    'refund.request',
    'refund.prepare',
    'chain.outbox.read',
    'chain.outbox.operate',
  ],
  auditor: [
    'admin.read',
    'admin.audit.read',
    'treasury.read',
    'trace_audit.run',
    'reconciliation.run',
    'refund.approve',
    'chain.outbox.read',
  ],
};

const ROLE_DESCRIPTIONS: Record<AdminRoleName, string> = {
  super_admin: 'Full control, including granting and revoking admin roles',
  operator: 'Runs markets, treasury operations, agents and reconciliation',
  auditor: 'Read-only oversight plus audit and reconciliation reviews',
};

export interface AdminAccess {
  roleName: AdminRoleName;
  permissions: Set<string>;
}

const privilegedGrantPermissions = new Set<string>(config.ADMIN_PRIVILEGED_GRANT_PERMISSIONS);

function assignmentTtlSeconds(roleName: AdminRoleName): number {
  switch (roleName) {
    case 'super_admin':
      return config.ADMIN_ASSIGNMENT_SUPER_ADMIN_TTL_SECONDS;
    case 'operator':
      return config.ADMIN_ASSIGNMENT_OPERATOR_TTL_SECONDS;
    case 'auditor':
      return config.ADMIN_ASSIGNMENT_AUDITOR_TTL_SECONDS;
    default:
      return config.ADMIN_ASSIGNMENT_AUDITOR_TTL_SECONDS;
  }
}

export function assignmentExpiresAt(roleName: AdminRoleName, now = new Date()): Date {
  return new Date(now.getTime() + assignmentTtlSeconds(roleName) * 1000);
}

export function isPrivilegedRole(roleName: AdminRoleName): boolean {
  return ROLE_PERMISSIONS[roleName].some((p) => privilegedGrantPermissions.has(p));
}

export function isAdminRole(value: unknown): value is AdminRoleName {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function isAdminAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    StrKey.isValidEd25519PublicKey(value)
  );
}

function isAssignmentActive(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() > now.getTime();
}

async function syncCatalogueInTransaction(tx: Prisma.TransactionClient): Promise<void> {
  await tx.adminPermission.createMany({
    data: ADMIN_PERMISSIONS.map((key) => ({ key, description: key })),
    skipDuplicates: true,
  });
  await tx.adminRole.createMany({
    data: ADMIN_ROLES.map((name) => ({ name, description: ROLE_DESCRIPTIONS[name] })),
    skipDuplicates: true,
  });
  for (const role of ADMIN_ROLES) {
    await tx.adminRolePermission.createMany({
      data: ROLE_PERMISSIONS[role].map((permissionKey) => ({ roleName: role, permissionKey })),
      skipDuplicates: true,
    });
  }
}

/**
 * Syncs code-defined permissions and role links into an existing database (#276).
 * Fresh databases are seeded by ensureAdminRbacSeeded.
 */
export async function syncAdminRbacCatalogue(): Promise<void> {
  if ((await prisma.adminRole.count()) === 0) return;
  await prisma.$transaction(async (tx) => syncCatalogueInTransaction(tx));
  logger.debug('Synced admin RBAC permission catalogue');
}

/**
 * Seeds the fixed permission/role catalogue and, only on an uninitialised
 * database, assigns ADMIN_ADDRESSES as super admins. Once any role exists the
 * database is authoritative: an address removed or revoked there is never
 * re-granted from the environment.
 */
export async function ensureAdminRbacSeeded(): Promise<void> {
  if ((await prisma.adminRole.count()) > 0) return;

  const result = await withAdvisoryLock('admin:rbac:bootstrap', async (tx) => {
    if ((await tx.adminRole.count()) > 0) return;
    await syncCatalogueInTransaction(tx);
    if (config.ADMIN_ADDRESSES.length > 0) {
      const expiresAt = assignmentExpiresAt('super_admin');
      await tx.adminRoleAssignment.createMany({
        data: config.ADMIN_ADDRESSES.map((walletAddress) => ({
          walletAddress,
          roleName: 'super_admin',
          assignedBy: 'ADMIN_ADDRESSES',
          expiresAt,
        })),
        skipDuplicates: true,
      });
    }
    logger.info(
      { admins: config.ADMIN_ADDRESSES.length, roles: ADMIN_ROLES.length },
      'Seeded admin RBAC from ADMIN_ADDRESSES',
    );
  });
  if (!result.acquired) {
    logger.info('Admin RBAC seed is already in progress on another instance');
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if ((await prisma.adminRole.count()) > 0) return;
    }
    throw new Error('Admin RBAC seed did not complete; refusing to boot without a role catalogue');
  }
}

/**
 * In the test environment the in-memory or testcontainer database may not have
 * the RBAC seed; ADMIN_ADDRESSES keeps existing admin tests meaningful. This
 * fallback is test-only and never runs in development or production.
 */
function testBootstrapAccess(walletAddress: string): AdminAccess | null {
  if (config.NODE_ENV !== 'test') return null;
  if (!config.ADMIN_ADDRESSES.includes(walletAddress)) return null;
  return { roleName: 'super_admin', permissions: new Set<string>(ADMIN_PERMISSIONS) };
}

export async function adminAccessFor(walletAddress: string): Promise<AdminAccess | null> {
  const testAccess = testBootstrapAccess(walletAddress);
  if (testAccess) return testAccess;
  const assignment = await prisma.adminRoleAssignment.findUnique({
    where: { walletAddress },
    include: { role: { include: { permissions: { select: { permissionKey: true } } } } },
  });
  if (!assignment || !isAssignmentActive(assignment.expiresAt)) return null;
  return {
    roleName: assignment.roleName as AdminRoleName,
    permissions: new Set<string>(assignment.role.permissions.map((p) => p.permissionKey)),
  };
}

export async function hasAdminPermission(walletAddress: string, permission: AdminPermission): Promise<boolean> {
  const access = await adminAccessFor(walletAddress);
  return access?.permissions.has(permission) ?? false;
}

async function actorRole(actor: string): Promise<AdminAccess> {
  const access = await adminAccessFor(actor);
  if (!access) throw new AppError(403, 'FORBIDDEN', 'This action is limited to OracleDesk admins');
  return access;
}

async function assertActorCanGrantRole(access: AdminAccess, roleName: AdminRoleName): Promise<void> {
  const role = await prisma.adminRole.findUnique({
    where: { name: roleName },
    include: { permissions: { select: { permissionKey: true } } },
  });
  if (!role) throw new AppError(404, 'ROLE_NOT_FOUND', 'Admin role not found');
  if (access.roleName !== 'super_admin') {
    const missing = role.permissions
      .map((p) => p.permissionKey)
      .filter((permission) => !access.permissions.has(permission));
    if (missing.length > 0) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot grant a role with permissions you do not hold', { missing });
    }
  }
}

async function assertNotLastSuperAdminDemotion(
  tx: Prisma.TransactionClient,
  walletAddress: string,
  newRoleName: AdminRoleName,
  now: Date,
): Promise<void> {
  const current = await tx.adminRoleAssignment.findUnique({ where: { walletAddress } });
  if (!current || current.roleName !== 'super_admin' || newRoleName === 'super_admin') return;
  if (!isAssignmentActive(current.expiresAt, now)) return;
  const another = await tx.adminRoleAssignment.findFirst({
    where: {
      roleName: 'super_admin',
      walletAddress: { not: walletAddress },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (!another) {
    throw new AppError(409, 'LAST_SUPER_ADMIN', 'Cannot leave zero active super admins');
  }
}

async function applyAdminRoleAssignment(params: {
  walletAddress: string;
  roleName: AdminRoleName;
  actor: string;
  now?: Date;
}): Promise<void> {
  const { walletAddress, roleName, actor } = params;
  const now = params.now ?? new Date();
  const expiresAt = assignmentExpiresAt(roleName, now);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('admin:super_admin'))`;
    await assertNotLastSuperAdminDemotion(tx, walletAddress, roleName, now);
    await tx.adminRoleAssignment.upsert({
      where: { walletAddress },
      create: { walletAddress, roleName, assignedBy: actor, expiresAt },
      update: { roleName, assignedBy: actor, expiresAt },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'ADMIN_ROLE_GRANTED',
        target: walletAddress,
        roleName,
        metadata: { roleName, expiresAt: expiresAt.toISOString() },
      },
    });
  });
}

export async function listAdmins(): Promise<
  Array<{ walletAddress: string; roleName: string; assignedBy: string | null; expiresAt: Date; createdAt: Date }>
> {
  const rows = await prisma.adminRoleAssignment.findMany({
    where: { expiresAt: { gt: new Date() } },
    orderBy: [{ roleName: 'asc' }, { createdAt: 'asc' }],
    select: { walletAddress: true, roleName: true, assignedBy: true, expiresAt: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, roleName: row.roleName }));
}

export async function listRoles(): Promise<Array<{ name: string; description: string | null; permissions: string[]; admins: number }>> {
  const now = new Date();
  const roles = await prisma.adminRole.findMany({
    orderBy: { name: 'asc' },
    include: {
      permissions: { select: { permissionKey: true }, orderBy: { permissionKey: 'asc' } },
      assignments: { where: { expiresAt: { gt: now } }, select: { id: true } },
    },
  });
  return roles.map((role) => ({
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((p) => p.permissionKey),
    admins: role.assignments.length,
  }));
}

export async function listAdminAudit(limit: number, skip: number): Promise<{ rows: unknown[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip }),
    prisma.adminAuditLog.count(),
  ]);
  return { rows, total };
}

export type AdminGrantProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export async function listAdminGrantProposals(status: AdminGrantProposalStatus = 'PENDING'): Promise<
  Array<{
    id: string;
    walletAddress: string;
    roleName: string;
    proposedBy: string;
    approvedBy: string | null;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  }>
> {
  return prisma.adminRoleGrantProposal.findMany({
    where: { status },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      walletAddress: true,
      roleName: true,
      proposedBy: true,
      approvedBy: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

export async function proposeAdminRoleGrant(params: {
  walletAddress: string;
  roleName: AdminRoleName;
  actor: string;
}): Promise<{ id: string; expiresAt: Date }> {
  const { walletAddress, roleName, actor } = params;
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  if (!isAdminRole(roleName)) {
    throw new AppError(400, 'VALIDATION_ERROR', `roleName must be one of: ${ADMIN_ROLES.join(', ')}`);
  }
  if (!isPrivilegedRole(roleName)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This role does not require a proposal; use POST /admin/admins/grant');
  }

  const access = await actorRole(actor);
  await assertActorCanGrantRole(access, roleName);

  const proposalExpiresAt = new Date(Date.now() + config.ADMIN_GRANT_PROPOSAL_TTL_SECONDS * 1000);
  const proposal = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('admin:super_admin'))`;
    await assertNotLastSuperAdminDemotion(tx, walletAddress, roleName, new Date());
    const row = await tx.adminRoleGrantProposal.create({
      data: {
        walletAddress,
        roleName,
        proposedBy: actor,
        status: 'PENDING',
        expiresAt: proposalExpiresAt,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'ADMIN_ROLE_GRANT_PROPOSED',
        target: walletAddress,
        roleName,
        metadata: { proposalId: row.id, roleName, proposalExpiresAt: proposalExpiresAt.toISOString() },
      },
    });
    return row;
  });
  return { id: proposal.id, expiresAt: proposal.expiresAt };
}

export async function approveAdminRoleGrant(params: { proposalId: string; actor: string }): Promise<void> {
  const { proposalId, actor } = params;
  const access = await actorRole(actor);

  await prisma.$transaction(async (tx) => {
    const proposal = await tx.adminRoleGrantProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new AppError(404, 'PROPOSAL_NOT_FOUND', 'Admin role grant proposal not found');
    if (proposal.status !== 'PENDING') {
      throw new AppError(409, 'PROPOSAL_NOT_PENDING', `Proposal is ${proposal.status}`);
    }
    if (proposal.expiresAt.getTime() <= Date.now()) {
      await tx.adminRoleGrantProposal.update({
        where: { id: proposalId },
        data: { status: 'EXPIRED', decidedAt: new Date() },
      });
      throw new AppError(410, 'PROPOSAL_EXPIRED', 'This proposal has expired');
    }
    if (proposal.proposedBy === actor) {
      throw new AppError(403, 'SELF_APPROVAL', 'A privileged grant must be approved by a different admin than its proposer');
    }

    const roleName = proposal.roleName as AdminRoleName;
    if (!isAdminRole(roleName)) throw new AppError(400, 'VALIDATION_ERROR', 'Proposal has an invalid role');

    await assertActorCanGrantRole(access, roleName);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('admin:super_admin'))`;
    await assertNotLastSuperAdminDemotion(tx, proposal.walletAddress, roleName, new Date());

    const expiresAt = assignmentExpiresAt(roleName);
    await tx.adminRoleAssignment.upsert({
      where: { walletAddress: proposal.walletAddress },
      create: {
        walletAddress: proposal.walletAddress,
        roleName,
        assignedBy: actor,
        expiresAt,
      },
      update: { roleName, assignedBy: actor, expiresAt },
    });
    await tx.adminRoleGrantProposal.update({
      where: { id: proposalId },
      data: { status: 'APPROVED', approvedBy: actor, decidedAt: new Date() },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'ADMIN_ROLE_GRANT_APPROVED',
        target: proposal.walletAddress,
        roleName,
        metadata: {
          proposalId,
          proposedBy: proposal.proposedBy,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
  });
}

export async function grantAdminRole(params: {
  walletAddress: string;
  roleName: AdminRoleName;
  actor: string;
}): Promise<void> {
  const { walletAddress, roleName, actor } = params;
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  if (!isAdminRole(roleName)) {
    throw new AppError(400, 'VALIDATION_ERROR', `roleName must be one of: ${ADMIN_ROLES.join(', ')}`);
  }
  if (isPrivilegedRole(roleName)) {
    throw new AppError(
      409,
      'PRIVILEGED_GRANT_REQUIRES_APPROVAL',
      'This role requires a second admin; propose then approve with step-up',
    );
  }

  const access = await actorRole(actor);
  await assertActorCanGrantRole(access, roleName);
  await applyAdminRoleAssignment({ walletAddress, roleName, actor });
}

export async function renewAdminAssignment(params: { walletAddress: string; actor: string }): Promise<{ expiresAt: Date }> {
  const { walletAddress, actor } = params;
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  const access = await actorRole(actor);
  const assignment = await prisma.adminRoleAssignment.findUnique({ where: { walletAddress } });
  if (!assignment || !isAssignmentActive(assignment.expiresAt)) {
    throw new AppError(404, 'ADMIN_NOT_FOUND', 'This address has no active admin assignment');
  }
  const roleName = assignment.roleName as AdminRoleName;
  if (access.roleName !== 'super_admin' && actor !== walletAddress) {
    if (!access.permissions.has('admin.manage')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins or the holder may renew this assignment');
    }
  }

  const expiresAt = assignmentExpiresAt(roleName);
  await prisma.$transaction(async (tx) => {
    await tx.adminRoleAssignment.update({
      where: { walletAddress },
      data: { expiresAt },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'ADMIN_ROLE_RENEWED',
        target: walletAddress,
        roleName,
        metadata: { expiresAt: expiresAt.toISOString() },
      },
    });
  });
  return { expiresAt };
}

export async function revokeAdminRole(params: { walletAddress: string; actor: string }): Promise<void> {
  const { walletAddress, actor } = params;
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  const current = await prisma.adminRoleAssignment.findUnique({ where: { walletAddress } });
  if (!current || !isAssignmentActive(current.expiresAt)) {
    throw new AppError(404, 'ADMIN_NOT_FOUND', 'This address has no admin role');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('admin:super_admin'))`;
    const locked = await tx.adminRoleAssignment.findUnique({ where: { walletAddress } });
    if (!locked || !isAssignmentActive(locked.expiresAt)) {
      throw new AppError(404, 'ADMIN_NOT_FOUND', 'This address has no admin role');
    }
    const now = new Date();
    const another = await tx.adminRoleAssignment.findFirst({
      where: { roleName: 'super_admin', walletAddress: { not: walletAddress }, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (locked.roleName === 'super_admin' && !another) {
      throw new AppError(409, 'LAST_SUPER_ADMIN', 'Cannot revoke the last super admin');
    }
    await tx.adminRoleAssignment.delete({ where: { walletAddress } });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'ADMIN_ROLE_REVOKED',
        target: walletAddress,
        roleName: locked.roleName,
        metadata: { previousRole: locked.roleName },
      },
    });
  });
}

/**
 * Deletes expired assignments and marks stale proposals. Returns wallets evicted
 * from active admin status for socket teardown (#276).
 */
export async function expireAdminAssignments(now = new Date(), batchSize = 100): Promise<string[]> {
  const evicted: string[] = [];
  const result = await withAdvisoryLock('admin:assignment:expire', async (tx) => {
    const staleAssignments = await tx.adminRoleAssignment.findMany({
      where: { expiresAt: { lte: now } },
      take: batchSize,
      select: { walletAddress: true, roleName: true },
    });
    for (const row of staleAssignments) {
      if (row.roleName === 'super_admin') {
        const others = await tx.adminRoleAssignment.count({
          where: {
            roleName: 'super_admin',
            walletAddress: { not: row.walletAddress },
            expiresAt: { gt: now },
          },
        });
        if (others === 0) {
          logger.warn({ wallet: row.walletAddress }, 'Skipping expiry of last super admin assignment');
          continue;
        }
      }
      await tx.adminRoleAssignment.delete({ where: { walletAddress: row.walletAddress } });
      await tx.adminAuditLog.create({
        data: {
          actor: 'system',
          action: 'ADMIN_ROLE_EXPIRED',
          target: row.walletAddress,
          roleName: row.roleName,
          metadata: { expiredAt: now.toISOString() },
        },
      });
      evicted.push(row.walletAddress);
    }

    await tx.adminRoleGrantProposal.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', decidedAt: now },
    });
    return evicted;
  });
  return result.acquired ? result.value : [];
}