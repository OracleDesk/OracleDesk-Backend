import { Router } from 'express';
import { config } from '../config';
import { secret } from '../config/secrets';
import { getReceiptJwks } from '../controllers/receipt.controller';
import { renderSep7StellarToml } from '../services/sep7.service';
import { getEntitlementJwks } from '../services/entitlement/token.service';

/**
 * Minimal `/.well-known/stellar.toml` endpoint for SEP-7 URI verification (#270).
 * Mounted at `/.well-known` before `/api/v1` and outside `/internal`.
 * Returns 404 when `URI_REQUEST_SIGNING_SECRET` is not configured.
 */
export function createWellKnownRouter(resolveSecret?: () => string): Router {
  const router = Router();

  router.get('/stellar.toml', (_req, res) => {
    let signingSecret = '';
    if (resolveSecret) {
      signingSecret = resolveSecret();
    } else {
      try {
        signingSecret = secret('URI_REQUEST_SIGNING_SECRET') || config.URI_REQUEST_SIGNING_SECRET;
      } catch {
        signingSecret = config.URI_REQUEST_SIGNING_SECRET;
      }
    }

    if (!signingSecret) {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }

    const body = renderSep7StellarToml(config.STELLAR_NETWORK_PASSPHRASE, signingSecret);
    res
      .status(200)
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(body);
  });

  router.get('/oracledesk-entitlement-jwks.json', (_req, res) => {
    try {
      res
        .status(200)
        .setHeader('Cache-Control', 'public, max-age=300')
        .json(getEntitlementJwks());
    } catch (err: any) {
      res.status(err.statusCode ?? 503).json({ error: err.code ?? 'ENTITLEMENT_KEYS_UNAVAILABLE' });
    }
  });
  router.get('/oracledesk-receipt-keys.json', getReceiptJwks);

  return router;
}

export default createWellKnownRouter();
