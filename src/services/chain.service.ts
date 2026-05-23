import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseUnits,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';
import {
  CONTRACT_ADDRESSES,
  MULTISIG_ORACLE_ABI,
  TREASURY_MANAGER_ABI,
  MARKET_FACTORY_ABI,
  PREDICTION_MARKET_ABI,
  REASONING_REGISTRY_ABI,
  POSITION_LEDGER_ABI,
} from '../config/contracts';
import { createCircleContractExecution } from './circle.service';
import { AppError } from '../middlewares/error.middleware';

const arcChain = {
  id: config.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
} as const;

export const arcPublicClient = createPublicClient({
  chain: arcChain as any,
  transport: http(config.ARC_RPC_URL),
});

export function marketIdToBytes32(marketId: string): `0x${string}` {
  return keccak256(toBytes(marketId));
}

/**
 * Deploys a new prediction market on Arc via MarketFactory.
 */
export async function deployMarket(params: {
  question: string;
  expiryTimestamp: number;
  initialYesPriceBps: number;
  liquiditySeedUsdc: number;
  reasoningCid: string;
  sha256Hash: string;
  confidenceIntervalBps: number;
}): Promise<string> {
  const liquiditySeed = parseUnits(params.liquiditySeedUsdc.toFixed(6), 6);
  const sha256Hash = params.sha256Hash.startsWith('0x')
    ? params.sha256Hash as `0x${string}`
    : `0x${params.sha256Hash}` as `0x${string}`;

  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`deployMarket:${params.question}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: CONTRACT_ADDRESSES.marketFactory,
      abiFunctionSignature: 'createMarket(string,address,uint256,uint256,uint256,address,string,bytes32,uint256)',
      abiParameters: [
        params.question,
        CONTRACT_ADDRESSES.multiSigOracle,
        params.expiryTimestamp,
        params.initialYesPriceBps,
        liquiditySeed.toString(),
        config.AGENT_WALLET_ADDRESS,
        params.reasoningCid,
        sha256Hash,
        params.confidenceIntervalBps,
      ],
      refId: `oracledesk-createMarket-${keccak256(toBytes(params.question))}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: CONTRACT_ADDRESSES.marketFactory as `0x${string}`,
    abi: MARKET_FACTORY_ABI,
    functionName: 'createMarket',
    args: [
      params.question,
      CONTRACT_ADDRESSES.multiSigOracle,
      params.expiryTimestamp,
      params.initialYesPriceBps,
      liquiditySeed,
      config.AGENT_WALLET_ADDRESS,
      params.reasoningCid,
      sha256Hash,
      params.confidenceIntervalBps,
    ],
  });
}

/**
 * Executes a BUY trade on an Arc PredictionMarket contract.
 */
export async function buyArcMarketShares(params: {
  marketAddress: string;
  buyYes: boolean;
  amountUsdc: number;
  minSharesOut?: number;
}): Promise<string> {
  const amount = parseUnits(params.amountUsdc.toFixed(6), 6);
  const minShares = params.minSharesOut ?? 0;

  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`buyArc:${params.marketAddress}:${params.amountUsdc}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: params.marketAddress,
      abiFunctionSignature: 'buy(bool,uint256,uint256)',
      abiParameters: [params.buyYes, amount.toString(), minShares.toString()],
      refId: `oracledesk-buyArc-${params.marketAddress}-${Date.now()}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: params.marketAddress as `0x${string}`,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'buy',
    args: [params.buyYes, amount, minShares],
  });
}

/**
 * Publishes a reasoning trace proof to the ReasoningRegistry on Arc.
 */
export async function publishReasoningToRegistry(params: {
  ipfsCid: string;
  sha256Hash: string;
  traceType: 'market_creation' | 'trade' | 'hedge' | 'pass';
  relatedId: string; // positionId or marketId
}): Promise<string> {
  const sha256Hash = params.sha256Hash.startsWith('0x')
    ? params.sha256Hash as `0x${string}`
    : `0x${params.sha256Hash}` as `0x${string}`;

  // If relatedId is a UUID, we need to format it or use a different representation
  // ReasoningRegistry expects bytes32 for relatedId.
  // For simplicity, we can hash the relatedId if it's not already bytes32.
  const relatedIdBytes = params.relatedId.startsWith('0x') && params.relatedId.length === 66
    ? params.relatedId as `0x${string}`
    : keccak256(toBytes(params.relatedId));

  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`publishReasoning:${params.ipfsCid}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: CONTRACT_ADDRESSES.reasoningRegistry,
      abiFunctionSignature: 'publishTrace(string,bytes32,string,bytes32)',
      abiParameters: [params.ipfsCid, sha256Hash, params.traceType, relatedIdBytes],
      refId: `oracledesk-publishReasoning-${params.ipfsCid}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: CONTRACT_ADDRESSES.reasoningRegistry as `0x${string}`,
    abi: REASONING_REGISTRY_ABI,
    functionName: 'publishTrace',
    args: [params.ipfsCid, sha256Hash, params.traceType, relatedIdBytes],
  });
}

export async function submitFundBet(params: {
  marketId: string;
  amountUsdc: number;
}): Promise<string> {
  const marketIdBytes = marketIdToBytes32(params.marketId);
  const amount = parseUnits(params.amountUsdc.toFixed(6), 6);

  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`fundBet:${params.marketId}:${params.amountUsdc}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: CONTRACT_ADDRESSES.treasuryManager,
      abiFunctionSignature: 'fundBet(bytes32,uint256,uint32)',
      abiParameters: [marketIdBytes, amount.toString(), '1000'],
      refId: `oracledesk-fundBet-${params.marketId}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: CONTRACT_ADDRESSES.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'fundBet',
    args: [marketIdBytes, amount, 1000],
  });
}

export async function submitOracleApproval(params: {
  marketAddress: string;
  yesWon: boolean;
}): Promise<string> {
  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`oracle:${params.marketAddress}:${params.yesWon}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: CONTRACT_ADDRESSES.multiSigOracle,
      abiFunctionSignature: 'approveResolution(address,bool)',
      abiParameters: [params.marketAddress, params.yesWon],
      refId: `oracledesk-oracle-${params.marketAddress}-${params.yesWon}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: CONTRACT_ADDRESSES.multiSigOracle as `0x${string}`,
    abi: MULTISIG_ORACLE_ABI,
    functionName: 'approveResolution',
    args: [params.marketAddress as `0x${string}`, params.yesWon],
  });
}

/**
 * Records a Polymarket position on the Arc PositionLedger.
 */
export async function openPositionOnLedger(params: {
  conditionId: string;
  tokenId: string;
  side: 'YES' | 'NO';
  usdcSpent: number;
  entryPriceBps: number;
  edgeBps: number;
  reasoningCid: string;
  sha256Hash: string;
  polygonTxHash: string;
}): Promise<string> {
  const usdcSpent = parseUnits(params.usdcSpent.toFixed(6), 6);
  const conditionId = params.conditionId.startsWith('0x') ? params.conditionId as `0x${string}` : `0x${params.conditionId}` as `0x${string}`;
  const sha256Hash = params.sha256Hash.startsWith('0x') ? params.sha256Hash as `0x${string}` : `0x${params.sha256Hash}` as `0x${string}`;

  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    return `0x${keccak256(toBytes(`openPosition:${params.conditionId}:${Date.now()}`)).slice(2)}`;
  }

  if (config.CHAIN_EXECUTION_MODE === 'circle') {
    const result = await createCircleContractExecution({
      contractAddress: CONTRACT_ADDRESSES.positionLedger,
      abiFunctionSignature: 'openPosition(bytes32,bytes32,uint256,uint8,uint256,uint256,uint256,string,bytes32,string)',
      abiParameters: [
        keccak256(toBytes(Date.now().toString())), // dummy positionId
        conditionId,
        params.tokenId,
        params.side === 'YES' ? 0 : 1,
        usdcSpent.toString(),
        params.entryPriceBps,
        params.edgeBps,
        params.reasoningCid,
        sha256Hash,
        params.polygonTxHash,
      ],
      refId: `oracledesk-openPosition-${params.conditionId}`,
    });
    return `circle:${result.transactionId}`;
  }

  return writeWalletContract({
    address: CONTRACT_ADDRESSES.positionLedger as `0x${string}`,
    abi: POSITION_LEDGER_ABI,
    functionName: 'openPosition',
    args: [
      conditionId, // Use conditionId as positionId for simplicity in this hackathon version or generate a unique one
      params.tokenId,
      params.side === 'YES' ? 0 : 1,
      usdcSpent,
      params.entryPriceBps,
      params.edgeBps,
      params.reasoningCid,
      sha256Hash,
      params.polygonTxHash,
    ],
  });
}

async function writeWalletContract(params: {
  address: `0x${string}`;
  abi: any;
  functionName: string;
  args: unknown[];
}): Promise<string> {
  if (!config.AGENT_PRIVATE_KEY) {
    throw new AppError(500, 'AGENT_PRIVATE_KEY_MISSING', 'AGENT_PRIVATE_KEY is required for wallet execution mode');
  }

  const privateKey = config.AGENT_PRIVATE_KEY.startsWith('0x')
    ? config.AGENT_PRIVATE_KEY as `0x${string}`
    : `0x${config.AGENT_PRIVATE_KEY}` as `0x${string}`;

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: arcChain as any,
    transport: http(config.ARC_RPC_URL),
  });

  return walletClient.writeContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  } as any);
}
