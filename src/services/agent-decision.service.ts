import type {
  AgentDecisionKind,
  AgentDecisionReason,
  AgentType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { canonicalJson, sha256Hex } from '../utils/hash.util';
import { prisma } from '../lib/prisma';

export interface RecordAgentDecisionInput {
  cycleId: string;
  agentType: AgentType;
  kind: AgentDecisionKind;
  reasonCode: AgentDecisionReason;
  marketId?: string;
  traceId?: string;
  tradeId?: string;
  positionId?: string;
  forecastRef?: string;
  inputs: unknown;
  sizingRecord?: unknown;
  outcome?: unknown;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

export function recordAgentDecision(
  input: RecordAgentDecisionInput,
  db: Pick<PrismaClient, 'agentDecision'> = prisma,
) {
  if (!input.cycleId.trim()) throw new Error('Agent decisions require a cycle id');

  const inputs = jsonValue(input.inputs);
  const inputsDigest = sha256Hex(canonicalJson(inputs));
  const decisionKey = sha256Hex(canonicalJson({
    cycleId: input.cycleId,
    agentType: input.agentType,
    kind: input.kind,
    reasonCode: input.reasonCode,
    marketId: input.marketId ?? null,
    inputsDigest,
  }));
  const links = {
    marketId: input.marketId ?? null,
    traceId: input.traceId ?? null,
    tradeId: input.tradeId ?? null,
    positionId: input.positionId ?? null,
    forecastRef: input.forecastRef ?? null,
    ...(input.sizingRecord === undefined ? {} : { sizingRecord: jsonValue(input.sizingRecord) }),
    ...(input.outcome === undefined ? {} : { outcome: jsonValue(input.outcome) }),
  };

  return db.agentDecision.upsert({
    where: { decisionKey },
    create: {
      decisionKey,
      cycleId: input.cycleId,
      agentType: input.agentType,
      kind: input.kind,
      reasonCode: input.reasonCode,
      inputsDigest,
      inputs,
      ...links,
    },
    update: {
      inputsDigest,
      inputs,
      ...links,
    },
  });
}
