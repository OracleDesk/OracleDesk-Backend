/**
 * Pluggable IPFS pin providers (#271):
 * - Pinata (`pinata`)
 * - Self-hosted Kubo HTTP RPC API (`kubo`)
 * - IPFS Pinning Service API (`psa:<host>`)
 *
 * Credentials are resolved through `secret()` on every call so secret refresh
 * rotations take effect without restarting the process.
 */
import axios from 'axios';
import { config } from '../../config';
import { secret } from '../../config/secrets';
import { AppError } from '../../middlewares/error.middleware';

export type PinProviderStatus = 'pinned' | 'pinning' | 'missing';

export interface PinProvider {
  readonly name: string;
  /** Pin exact bytes (or by CID for Pinning Service API) and return the CID. */
  pin(bytes: Buffer, name: string, signal?: AbortSignal, expectedCid?: string): Promise<string>;
  /** Check whether `cid` is pinned on this provider. */
  status(cid: string, signal?: AbortSignal): Promise<PinProviderStatus>;
}

const PINATA_BASE = 'https://api.pinata.cloud';

function resolveSecretSafe(name: 'PINATA_API_KEY' | 'PINATA_SECRET_API_KEY' | 'IPFS_KUBO_AUTH' | 'IPFS_PSA_TOKEN'): string {
  try {
    return secret(name);
  } catch {
    return (config as unknown as Record<string, string>)[name] ?? '';
  }
}

export const pinataProvider: PinProvider = {
  name: 'pinata',
  async pin(bytes, name, signal) {
    const apiKey = resolveSecretSafe('PINATA_API_KEY');
    const secretKey = resolveSecretSafe('PINATA_SECRET_API_KEY');
    if (!apiKey || !secretKey) {
      throw new AppError(503, 'IPFS_NOT_CONFIGURED', 'PINATA_API_KEY and PINATA_SECRET_API_KEY are not set');
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/json' }), `${name}.json`);
    form.append('pinataMetadata', JSON.stringify({ name }));
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
    const { data } = await axios.post<{ IpfsHash: string }>(`${PINATA_BASE}/pinning/pinFileToIPFS`, form, {
      headers: {
        pinata_api_key: apiKey,
        pinata_secret_api_key: secretKey,
      },
      timeout: config.TIMEOUT_IPFS_PIN_MS,
      signal,
    });
    return data.IpfsHash;
  },

  async status(cid, signal) {
    const apiKey = resolveSecretSafe('PINATA_API_KEY');
    const secretKey = resolveSecretSafe('PINATA_SECRET_API_KEY');
    if (!apiKey || !secretKey) return 'missing';
    const { data } = await axios.get<{ count?: number; rows?: Array<{ ipfs_pin_hash?: string }> }>(
      `${PINATA_BASE}/data/pinList`,
      {
        params: { hashContains: cid, status: 'pinned', pageLimit: 5 },
        headers: { pinata_api_key: apiKey, pinata_secret_api_key: secretKey },
        timeout: config.TIMEOUT_IPFS_PIN_MS,
        signal,
      },
    );
    const matched = (data.rows ?? []).some((row) => row.ipfs_pin_hash === cid);
    return matched ? 'pinned' : 'missing';
  },
};

export function kuboProvider(
  apiUrl: string,
  resolveAuth: () => string = () => resolveSecretSafe('IPFS_KUBO_AUTH'),
): PinProvider {
  const base = apiUrl.replace(/\/+$/, '');
  const authHeaders = (): Record<string, string> => {
    const auth = resolveAuth();
    return auth ? { Authorization: auth } : {};
  };

  return {
    name: 'kubo',
    async pin(bytes, name, signal) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/json' }), `${name}.json`);
      const { data } = await axios.post<{ Hash: string }>(
        `${base}/api/v0/add?cid-version=1&raw-leaves=true&pin=true`,
        form,
        {
          headers: authHeaders(),
          timeout: config.TIMEOUT_IPFS_PIN_MS,
          signal,
        },
      );
      return data.Hash;
    },

    async status(cid, signal) {
      try {
        const { data } = await axios.post<{ Keys?: Record<string, { Type?: string }> }>(
          `${base}/api/v0/pin/ls?arg=${encodeURIComponent(cid)}&type=recursive`,
          undefined,
          {
            headers: authHeaders(),
            timeout: config.TIMEOUT_IPFS_PIN_MS,
            signal,
          },
        );
        return data.Keys && cid in data.Keys ? 'pinned' : 'missing';
      } catch {
        return 'missing';
      }
    },
  };
}

export function pinningServiceProvider(
  endpoint: string,
  resolveToken: () => string = () => resolveSecretSafe('IPFS_PSA_TOKEN'),
): PinProvider {
  const base = endpoint.replace(/\/+$/, '');
  let host = 'remote';
  try {
    host = new URL(base).host;
  } catch {
    host = 'remote';
  }
  const authHeaders = (): Record<string, string> => {
    const token = resolveToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  return {
    name: `psa:${host}`,
    async pin(_bytes, name, signal, expectedCid) {
      if (!expectedCid) {
        throw new AppError(400, 'IPFS_PSA_CID_REQUIRED', 'Pinning Service API requires a precomputed CID');
      }
      const { data } = await axios.post<{ pin?: { cid?: string } }>(
        `${base}/pins`,
        { cid: expectedCid, name },
        {
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          timeout: config.TIMEOUT_IPFS_PIN_MS,
          signal,
        },
      );
      return data.pin?.cid ?? expectedCid;
    },

    async status(cid, signal) {
      try {
        const { data } = await axios.get<{ results?: Array<{ status?: string }> }>(
          `${base}/pins`,
          {
            params: { cid },
            headers: authHeaders(),
            timeout: config.TIMEOUT_IPFS_PIN_MS,
            signal,
          },
        );
        const statuses = (data.results ?? []).map((r) => r.status);
        if (statuses.includes('pinned')) return 'pinned';
        if (statuses.includes('queued') || statuses.includes('pinning')) return 'pinning';
        return 'missing';
      } catch {
        return 'missing';
      }
    },
  };
}

let testProviders: PinProvider[] | null = null;

/** Test seam to inject fake pin providers. Pass `null` to restore configured providers. */
export function setPinProvidersForTests(providers: PinProvider[] | null): void {
  testProviders = providers;
}

/** Builds the ordered list of configured pin providers from config. */
export function configuredPinProviders(): PinProvider[] {
  if (testProviders) return testProviders;
  const names = config.IPFS_PROVIDERS;
  const providers: PinProvider[] = [];
  for (const name of names) {
    if (name === 'pinata') {
      providers.push(pinataProvider);
    } else if (name === 'kubo' && config.IPFS_KUBO_API_URL) {
      providers.push(kuboProvider(config.IPFS_KUBO_API_URL));
    } else if (name === 'psa' && config.IPFS_PSA_ENDPOINT) {
      providers.push(pinningServiceProvider(config.IPFS_PSA_ENDPOINT));
    }
  }
  return providers.length > 0 ? providers : [pinataProvider];
}
