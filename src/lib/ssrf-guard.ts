/**
 * SSRF guard for outbound webhook deliveries (#128).
 *
 * User-registered URLs are a classic SSRF vector (cloud metadata at
 * 169.254.169.254, Redis on localhost, internal services). This module:
 *
 * - accepts only https: (http: only outside production with
 *   WEBHOOKS_ALLOW_HTTP=true), no credentials in the URL, and only ports
 *   443/8443 in production;
 * - resolves the hostname and rejects it if ANY address falls in a blocked
 *   range. Checks run on resolved IPs, never on strings, so aliases such as
 *   0x7f.1, 2130706433 or [::ffff:127.0.0.1] are caught after normalisation;
 * - pins the connection to the validated address with a custom `lookup`, so a
 *   second DNS answer (rebinding) cannot redirect the socket. TLS SNI and the
 *   Host header keep the original hostname;
 * - never follows redirects, caps the response read at 64 KB and enforces a
 *   total timeout.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const defaultResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

export interface GuardOptions {
  production: boolean;
  allowHttp: boolean;
  resolver?: Resolver;
  /** Test-only escape hatch for local receivers. Never wired to env. */
  allowPrivateForTests?: boolean;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_V6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

const blockList = (() => {
  const list = new net.BlockList();
  for (const [addr, prefix] of BLOCKED_V4) list.addSubnet(addr, prefix, 'ipv4');
  for (const [addr, prefix] of BLOCKED_V6) list.addSubnet(addr, prefix, 'ipv6');
  return list;
})();

/** Extracts the IPv4 address from an IPv4-mapped/compatible IPv6 address. */
function embeddedV4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** True if a literal IP address is private, loopback, link-local, metadata, etc. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, 'ipv4');
  if (family === 6) {
    const v4 = embeddedV4(address);
    if (v4) return blockList.check(v4, 'ipv4');
    return blockList.check(address, 'ipv6');
  }
  return true; // not an IP at all: refuse
}

function parseUrl(raw: string, opts: GuardOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('URL is not valid');
  }
  const httpAllowed = !opts.production && opts.allowHttp;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && httpAllowed)) {
    throw new SsrfError(httpAllowed ? 'URL must use http or https' : 'URL must use https');
  }
  if (url.username || url.password) throw new SsrfError('URL must not contain credentials');
  if (opts.production && url.port && url.port !== '443' && url.port !== '8443') {
    throw new SsrfError('URL port must be 443 or 8443');
  }
  return url;
}

/** Strips IPv6 brackets: new URL('http://[::1]/').hostname === '[::1]'. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

export interface ValidatedTarget {
  url: URL;
  address: string;
  family: number;
}

/**
 * Validates a webhook URL and resolves it to a single safe address.
 * Used at subscription create/update and again before every delivery.
 * WHATWG URL parsing normalises 0x7f.1 / 2130706433 to 127.0.0.1 first.
 */
export async function resolveSafeTarget(raw: string, opts: GuardOptions): Promise<ValidatedTarget> {
  const url = parseUrl(raw, opts);
  const host = bareHost(url);
  const resolver = opts.resolver ?? defaultResolver;

  let addresses: Array<{ address: string; family: number }>;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new SsrfError(`Could not resolve ${host}`);
    }
  }
  if (addresses.length === 0) throw new SsrfError(`Could not resolve ${host}`);
  if (!opts.allowPrivateForTests) {
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) throw new SsrfError(`${host} resolves to a disallowed address (${bad.address})`);
  }
  return { url, address: addresses[0].address, family: addresses[0].family };
}

/** Convenience wrapper used by the API: validates and returns the parsed URL. */
export async function assertSafeUrl(raw: string, opts: GuardOptions): Promise<URL> {
  return (await resolveSafeTarget(raw, opts)).url;
}

/**
 * A `lookup` that always answers with the pre-validated address, whatever
 * DNS says now. This is what defeats DNS rebinding between check and connect.
 */
export function pinnedLookup(address: string, family: number): net.LookupFunction {
  return ((_hostname: string, options: dns.LookupOptions | undefined, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void;
    const all = typeof options === 'object' && options?.all;
    if (all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as net.LookupFunction;
}

const MAX_RESPONSE_BYTES = 64 * 1024;

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
}

/**
 * POSTs `body` to `rawUrl` through the guard. Re-validates and re-resolves on
 * every call. Redirects are returned as-is (3xx), never followed.
 */
export async function safeFetch(
  rawUrl: string,
  init: { body: Buffer; headers: Record<string, string>; timeoutMs: number },
  opts: GuardOptions,
): Promise<SafeFetchResult> {
  const target = await resolveSafeTarget(rawUrl, opts);
  const { url } = target;
  const isHttps = url.protocol === 'https:';
  const lookup = pinnedLookup(target.address, target.family);
  const agent = isHttps
    ? new https.Agent({ lookup, keepAlive: false })
    : new http.Agent({ lookup, keepAlive: false });

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const signal = AbortSignal.timeout(init.timeoutMs);
    const req = (isHttps ? https : http).request(
      url,
      {
        method: 'POST',
        agent,
        headers: { ...init.headers, 'Content-Length': String(init.body.length) },
        signal,
        ...(isHttps ? { servername: bareHost(url) } : {}),
      },
      (res) => {
        let read = 0;
        res.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > MAX_RESPONSE_BYTES) res.destroy(); // drain at most 64 KB
        });
        const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers });
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      },
    );
    req.on('error', (err) => reject(err));
    req.end(init.body);
  }).finally(() => agent.destroy());
}
