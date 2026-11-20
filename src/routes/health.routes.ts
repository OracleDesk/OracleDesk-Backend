import { Router } from 'express';
import type { HealthService } from '../services/health.service';

/**
 * /livez and /readyz (#111). Mounted before the global rate limiter so
 * orchestrators polling from one IP are never throttled. Responses carry only
 * name, ok, critical, latencyMs and a sanitised error class; probe detail
 * (ledger numbers, lag) is admin-only. A degraded chain-write probe (#220)
 * keeps HTTP 200 with status "degraded" and state on that check.
 */
export function createHealthRouter(health: HealthService): Router {
  const router = Router();

  router.get('/livez', (_req, res) => {
    const live = health.liveness();
    if (live.alive) {
      res.json({ ok: true, data: { status: 'alive' }, error: null });
      return;
    }
    res.status(503).json({ ok: false, data: { status: 'unhealthy' }, error: { code: 'NOT_ALIVE', message: 'Process is not healthy' } });
  });

  router.get('/readyz', async (_req, res) => {
    if (health.isDraining()) {
      res.status(503).json({ ok: false, data: { status: 'draining', checks: [] }, error: { code: 'NOT_READY', message: 'Server is shutting down' } });
      return;
    }
    const { ready, degraded, checks } = await health.readiness();
    const publicChecks = checks.map(({ name, ok, state, critical, latencyMs, error }) => ({
      name,
      ok,
      critical,
      latencyMs,
      ...(state === 'degraded' ? { state } : {}),
      ...(error ? { error } : {}),
    }));
    if (ready) {
      res.json({ ok: true, data: { status: degraded ? 'degraded' : 'ready', checks: publicChecks }, error: null });
      return;
    }
    res.status(503).json({
      ok: false,
      data: { status: 'not_ready', checks: publicChecks },
      error: { code: 'NOT_READY', message: 'A critical dependency is unavailable' },
    });
  });

  return router;
}
