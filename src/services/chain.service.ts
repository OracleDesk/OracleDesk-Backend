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
