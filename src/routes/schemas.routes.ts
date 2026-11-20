import { Router, Request, Response } from 'express';
import { SCHEMA_TARGETS, jsonSchemaFor } from '../schemas/generate';
import { config } from '../config';

const router = Router();

/**
 * Serves the published JSON Schemas at `/api/v1/schemas/*`. The `$id` is
 * rewritten from `PUBLIC_API_BASE_URL` on each request so staging and
 * production serve the right URL even though the committed files use the
 * canonical base. Schemas are versioned and never change after publishing,
 * so their responses are safe to cache aggressively. The index at
 * `GET /` is deliberately not cached as `immutable`, so new targets appear
 * for operators without a cache bust.
 */
function serveSchema(subpath: string, schema: Record<string, unknown>) {
  return (_req: Request, res: Response) => {
    const baseUrl = config.PUBLIC_API_BASE_URL || 'https://api.oracledesk.io';
    const body = {
      ...schema,
      $id: `${baseUrl.replace(/\/$/, '')}/api/v1/schemas/${subpath}`,
    };
    res.setHeader('Content-Type', 'application/schema+json');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).json(body);
  };
}

router.get('/', (_req, res) => {
  const baseUrl = config.PUBLIC_API_BASE_URL || 'https://api.oracledesk.io';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    targets: SCHEMA_TARGETS.map((target) => ({
      title: target.title,
      path: target.path,
      url: jsonSchemaFor(target, baseUrl).$id,
    })),
  });
});

for (const target of SCHEMA_TARGETS) {
  router.get(`/${target.path}`, serveSchema(target.path, target.schema));
}

export default router;
