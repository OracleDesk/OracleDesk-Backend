/**
 * Reasoning trace lifecycle after generation:
 *   seal (if confidential) → pin to IPFS → traceHash = sha256(pinned bytes) →
 *   reasoning_registry.publish_trace → verify.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import { verifyTraceHash, sha256Hex, canonicalBytesStrict } from '../utils/hash.util';
import { fetchIpfsBytes, pinJson, pinDocument } from './ipfs.service';
import { getOnChainTrace, publishTrace } from './chain.service';
import { agentSigner } from './stellar/clients';
import type { TraceVerification } from '../types';
import { TraceDocV1 } from '../schemas/trace';
import {
  sealTrace,
  openTrace,
  loadKeks,
  TracePublicPart,
  createKek,
} from './trace-crypto.service';
import crypto from 'node:crypto';

export interface PinTraceResult {
  cid: string;
  traceHash: string;
  contentMode: 'PLAINTEXT_LEGACY' | 'ENCRYPTED';
  plaintextHash: string;
}

export interface PublishPinnedResult {
  onChainTraceId: bigint | null;
  publishTxHash: string | null;
}

/**
 * Pins a reasoning trace document to IPFS, encrypting the envelope if TRACE_CONFIDENTIAL=true.
 */
export async function pinTrace(params: {
  traceId: string;
  payload: Record<string, unknown> | TraceDocV1;
  action: string;
  onChainMarketId: bigint | null;
}): Promise<PinTraceResult> {
  const isConfidential = config.TRACE_CONFIDENTIAL;

  if (isConfidential) {
    // 1. Strict canonical bytes for the plaintext
    const plaintextBytes = canonicalBytesStrict(params.payload);
    const plaintextHash = sha256Hex(plaintextBytes);

    // 2. Build public preview part
    const payload = params.payload as any;
    const publicPart: TracePublicPart = {
      traceId: params.traceId,
      agentType: payload.agentType || 'MARKET_MAKER',
      decisionType: payload.decisionType || params.action.toUpperCase(),
      market: {
        backendId: payload.market?.backendId || payload.marketId || '',
        onChainId:
          params.onChainMarketId !== null
            ? params.onChainMarketId.toString()
            : payload.market?.onChainId ?? null,
      },
      probabilityEstimate: Number(payload.probabilityEstimate ?? 0.5),
      marketProbability: Number(payload.marketProbability ?? 0.5),
      edge: Number(payload.edge ?? 0),
      previewSources: Array.isArray(payload.sourcesUsed)
        ? payload.sourcesUsed.slice(0, 2).map((s: any) => ({
            source: String(s.source ?? ''),
            weight: Number(s.weight ?? 0),
            signal: String(s.signal ?? ''),
            rawValue:
              s.rawValue !== undefined && s.rawValue !== null
                ? Number(s.rawValue)
                : null,
          }))
        : [],
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    // 3. Load active KEK
    const keks = loadKeks(config);
    let activeKek = keks.get(config.TRACE_KEK_ACTIVE);
    if (!activeKek) {
      const ephemeralKey = crypto.randomBytes(32);
      activeKek = createKek(config.TRACE_KEK_ACTIVE, ephemeralKey);
      keks.set(config.TRACE_KEK_ACTIVE, activeKek);
    }

    // 4. Seal trace
    const sealed = sealTrace(plaintextBytes, publicPart, activeKek);

    // 5. Self-test decryption before pinning
    const decrypted = openTrace(
      sealed.envelope,
      activeKek.unwrap(sealed.wrappedKey),
    );
    if (sha256Hex(decrypted) !== sealed.plaintextHash) {
      throw new AppError(
        500,
        'ENVELOPE_SELF_TEST_FAILED',
        'Sealed envelope failed decryption self-test',
      );
    }

    // 6. Pin envelope to IPFS
    const pinned = await pinJson(
      sealed.envelope,
      `oracledesk-trace-${params.traceId}`,
    );

    // 7. Atomic DB update
    await prisma.$transaction(async (tx) => {
      await tx.reasoningTrace.update({
        where: { id: params.traceId },
        data: {
          ipfsCid: pinned.cid,
          traceHash: pinned.hash,
          contentMode: 'ENCRYPTED',
          plaintextHash: sealed.plaintextHash,
        },
      });

      await tx.traceKey.upsert({
        where: { traceId: params.traceId },
        create: {
          traceId: params.traceId,
          kid: sealed.kid,
          wrappedKey: sealed.wrappedKey,
          plaintextHash: sealed.plaintextHash,
        },
        update: {
          kid: sealed.kid,
          wrappedKey: sealed.wrappedKey,
          plaintextHash: sealed.plaintextHash,
        },
      });
    });

    return {
      cid: pinned.cid,
      traceHash: pinned.hash,
      contentMode: 'ENCRYPTED',
      plaintextHash: sealed.plaintextHash,
    };
  }

  // Plaintext path
  const pinned = await pinJson(
    params.payload,
    `oracledesk-trace-${params.traceId}`,
  );

  await prisma.reasoningTrace.update({
    where: { id: params.traceId },
    data: {
      ipfsCid: pinned.cid,
      traceHash: pinned.hash,
      contentMode: 'PLAINTEXT_LEGACY',
      plaintextHash: pinned.hash,
    },
  });

  return {
    cid: pinned.cid,
    traceHash: pinned.hash,
    contentMode: 'PLAINTEXT_LEGACY',
    plaintextHash: pinned.hash,
  };
}

/**
 * Publishes a pinned trace to the on-chain reasoning registry.
 */
export async function publishPinnedTrace(params: {
  traceId: string;
  onChainMarketId: bigint;
  action: string;
  ipfsCid: string;
  traceHash: string;
}): Promise<PublishPinnedResult> {
  const result = await publishTrace({
    agent: agentSigner().publicKey as string,
    market_id: params.onChainMarketId,
    action: params.action,
    trace_hash: Buffer.from(params.traceHash, 'hex'),
    ipfs_cid: params.ipfsCid,
  });

  if (result.mode === 'dry-run') {
    return { onChainTraceId: null, publishTxHash: null };
  }

  await prisma.reasoningTrace.update({
    where: { id: params.traceId },
    data: {
      onChainTraceId: result.value,
      publishTxHash: result.txHash,
      verified: true,
    },
  });

  return { onChainTraceId: result.value, publishTxHash: result.txHash };
}

/**
 * Pins and publishes a trace in one call.
 */
export async function pinAndPublishTrace(params: {
  traceId: string;
  payload: Record<string, unknown> | TraceDocV1;
  action: string;
  onChainMarketId: bigint | null;
}): Promise<{
  cid: string;
  traceHash: string;
  onChainTraceId: bigint | null;
  publishTxHash: string | null;
}> {
  const pinned = await pinTrace(params);

  if (params.onChainMarketId === null) {
    logger.info(
      { traceId: params.traceId },
      'Trace pinned; market not on-chain yet, so not published',
    );
    return {
      cid: pinned.cid,
      traceHash: pinned.traceHash,
      onChainTraceId: null,
      publishTxHash: null,
    };
  }

  const published = await publishPinnedTrace({
    traceId: params.traceId,
    onChainMarketId: params.onChainMarketId,
    action: params.action,
    ipfsCid: pinned.cid,
    traceHash: pinned.traceHash,
  });

  return {
    cid: pinned.cid,
    traceHash: pinned.traceHash,
    onChainTraceId: published.onChainTraceId,
    publishTxHash: published.publishTxHash,
  };
}

/**
 * Fetches the content at the on-chain CID, hashes the exact bytes and
 * compares them with the on-chain trace_hash.
 */
export async function verifyTraceOnChain(
  traceId: string,
): Promise<TraceVerification & { contentMode?: string; plaintextHash?: string | null }> {
  const trace = await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    select: {
      id: true,
      onChainTraceId: true,
      traceHash: true,
      contentMode: true,
      plaintextHash: true,
    },
  });
  if (!trace) throw new AppError(404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');
  if (trace.onChainTraceId === null) {
    throw new AppError(
      409,
      'TRACE_NOT_PUBLISHED',
      'This trace has not been published on-chain yet',
    );
  }

  const onChain = await getOnChainTrace(trace.onChainTraceId);
  const onChainHash = Buffer.from(onChain.trace_hash).toString('hex');
  const bytes = await fetchIpfsBytes(onChain.ipfs_cid);
  const verified = verifyTraceHash(bytes, onChainHash);

  let contentMode = trace.contentMode;
  let plaintextHash = trace.plaintextHash;

  if (verified) {
    try {
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (parsed.kind === 'oracledesk.trace.enc') {
        contentMode = 'ENCRYPTED';
        if (parsed.plaintextHash && trace.plaintextHash && parsed.plaintextHash !== trace.plaintextHash) {
          logger.warn(
            { traceId, parsedHash: parsed.plaintextHash, storedHash: trace.plaintextHash },
            'Plaintext hash in envelope does not match stored plaintextHash',
          );
        }
      } else {
        contentMode = 'PLAINTEXT_LEGACY';
      }
    } catch {
      // not JSON or legacy
    }
  }

  await prisma.reasoningTrace.update({
    where: { id: traceId },
    data: { verified },
  });

  return {
    traceId,
    onChainTraceId: trace.onChainTraceId.toString(),
    ipfsCid: onChain.ipfs_cid,
    onChainHash,
    computedHash: sha256Hex(bytes),
    storedHash: trace.traceHash,
    verified,
    verifiedAt: new Date(),
    contentMode,
    plaintextHash,
  };
}
