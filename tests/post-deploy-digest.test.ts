import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';

const SCRIPT = resolve(__dirname, '../../scripts/post-deploy-checks.sh');

describe('post-deploy-checks digest normalization (#272)', () => {
  it('matches sha256:-prefixed DIGEST and fails on mismatched digest', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const port = (server.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), 'od-post-deploy-'));
    const hex = 'a'.repeat(64);
    try {
      const stubKubectl = join(dir, 'kubectl');
      writeFileSync(
        stubKubectl,
        `#!/usr/bin/env bash\nif [[ "$*" == *"rollout status"* ]]; then exit 0; fi\necho "ghcr.io/oracledesk/oracledesk-backend@sha256:${hex}"\n`,
        'utf8',
      );
      chmodSync(stubKubectl, 0o755);

      const env = {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        API_URL: `http://127.0.0.1:${port}`,
        READY_CHECKS: '1',
        READY_INTERVAL: '0',
        SKIP_KUBE: '0',
        KUBE_NAMESPACE: 'oracledesk-staging',
        DEPLOYMENTS: 'api indexer worker',
        DIGEST: `sha256:${hex}`,
      };

      const out = execFileSync('bash', [SCRIPT], { env, encoding: 'utf8' });
      assert.match(out, /OK: api runs digest/);
      assert.match(out, /OK: worker rollout ready/);

      assert.throws(() => {
        execFileSync('bash', [SCRIPT], {
          env: { ...env, DIGEST: `sha256:${'b'.repeat(64)}` },
          encoding: 'utf8',
        });
      });
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
