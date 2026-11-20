import dns from 'node:dns/promises';
import net from 'node:net';
import axios from 'axios';
import { AppError } from '../middlewares/error.middleware';

function privateAddress(address: string): boolean {
  if (net.isIP(address) === 6) return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
  const octets = address.split('.').map(Number);
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

/** Fetches signer-supplied evidence without following redirects or reaching private networks. */
export async function fetchEvidenceSource(rawUrl: string, maxBytes = 2_000_000): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new AppError(400, 'INVALID_EVIDENCE_URL', 'Evidence sources must be valid URLs'); }
  if (parsed.protocol !== 'https:') throw new AppError(400, 'INVALID_EVIDENCE_URL', 'Evidence sources must use HTTPS');
  const addresses = await dns.lookup(parsed.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new AppError(400, 'EVIDENCE_URL_BLOCKED', 'Evidence source resolves to a private or unavailable address');
  }
  try {
    const response = await axios.get<ArrayBuffer>(parsed.toString(), {
      responseType: 'arraybuffer', timeout: 10_000, maxRedirects: 0,
      maxContentLength: maxBytes, maxBodyLength: maxBytes,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const bytes = Buffer.from(response.data);
    if (bytes.length > maxBytes) throw new AppError(413, 'EVIDENCE_TOO_LARGE', 'Evidence source exceeds the size limit');
    return { bytes, contentType: String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0] };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'EVIDENCE_FETCH_FAILED', 'Could not fetch evidence source', { url: rawUrl });
  }
}
