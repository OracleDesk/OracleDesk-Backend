/**
 * Admin operations on operational alert incidents (#226): list, acknowledge
 * (stops escalation for the current episode) and silence (no notifications
 * until the given time). The routes write the audit row (requirePermission).
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middlewares/error.middleware';

export const MAX_SILENCE_MINUTES = 24 * 60;

export async function listIncidents(q: { id?: string; state?: string; severity?: string; skip: number; take: number }) {
  const where = {
    ...(q.id ? { id: q.id } : {}),
    ...(q.state ? { state: q.state } : {}),
    ...(q.severity ? { severity: q.severity } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.alertIncident.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: q.skip, take: q.take }),
    prisma.alertIncident.count({ where }),
  ]);
  return { rows, total };
}

async function load(id: string) {
  const incident = await prisma.alertIncident.findUnique({ where: { id } });
  if (!incident) throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert incident not found');
  return incident;
}

/** Acknowledges the current episode. A later episode starts unacknowledged. */
export async function acknowledgeIncident(id: string, actor: string, now = new Date()) {
  const incident = await load(id);
  if (incident.state !== 'OPEN') throw new AppError(409, 'ALERT_NOT_OPEN', 'Only an open incident can be acknowledged');
  if (incident.ackedAt) return incident;
  return prisma.alertIncident.update({ where: { id }, data: { ackedAt: now, ackedBy: actor } });
}

export async function silenceIncident(id: string, untilMinutes: number, now = new Date()) {
  await load(id);
  return prisma.alertIncident.update({
    where: { id },
    data: { silencedUntil: new Date(now.getTime() + untilMinutes * 60_000) },
  });
}
