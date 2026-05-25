"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arcPublicClient = void 0;
exports.marketIdToBytes32 = marketIdToBytes32;
exports.deployMarket = deployMarket;
exports.buyArcMarketShares = buyArcMarketShares;
exports.publishReasoningToRegistry = publishReasoningToRegistry;
exports.submitFundBet = submitFundBet;
exports.submitOracleApproval = submitOracleApproval;
exports.openPositionOnLedger = openPositionOnLedger;
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const config_1 = require("../config");
const contracts_1 = require("../config/contracts");
const circle_service_1 = require("./circle.service");
const error_middleware_1 = require("../middlewares/error.middleware");
const arcChain = {
    id: config_1.config.ARC_CHAIN_ID,
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config_1.config.ARC_RPC_URL] } },
};
exports.arcPublicClient = (0, viem_1.createPublicClient)({
    chain: arcChain,
    transport: (0, viem_1.http)(config_1.config.ARC_RPC_URL),
});
function marketIdToBytes32(marketId) {
    return (0, viem_1.keccak256)((0, viem_1.toBytes)(marketId));
}
/**
 * Deploys a new prediction market on Arc via MarketFactory.
 */
async function deployMarket(params) {
    const liquiditySeed = (0, viem_1.parseUnits)(params.liquiditySeedUsdc.toFixed(6), 6);
    const sha256Hash = params.sha256Hash.startsWith('0x')
        ? params.sha256Hash
        : `0x${params.sha256Hash}`;
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`deployMarket:${params.question}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: contracts_1.CONTRACT_ADDRESSES.marketFactory,
            abiFunctionSignature: 'createMarket(string,address,uint256,uint256,uint256,address,string,bytes32,uint256)',
            abiParameters: [
                params.question,
                contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
                params.expiryTimestamp,
                params.initialYesPriceBps,
                liquiditySeed.toString(),
                config_1.config.AGENT_WALLET_ADDRESS,
                params.reasoningCid,
                sha256Hash,
                params.confidenceIntervalBps,
            ],
            refId: `oracledesk-createMarket-${(0, viem_1.keccak256)((0, viem_1.toBytes)(params.question))}`,
        });
        return `circle:${result.transactionId}`;
    }
    return writeWalletContract({
        address: contracts_1.CONTRACT_ADDRESSES.marketFactory,
        abi: contracts_1.MARKET_FACTORY_ABI,
        functionName: 'createMarket',
        args: [
            params.question,
            contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
            params.expiryTimestamp,
            params.initialYesPriceBps,
            liquiditySeed,
            config_1.config.AGENT_WALLET_ADDRESS,
            params.reasoningCid,
            sha256Hash,
            params.confidenceIntervalBps,
        ],
    });
}
/**
 * Executes a BUY trade on an Arc PredictionMarket contract.
 */
async function buyArcMarketShares(params) {
    const amount = (0, viem_1.parseUnits)(params.amountUsdc.toFixed(6), 6);
    const minShares = params.minSharesOut ?? 0;
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`buyArc:${params.marketAddress}:${params.amountUsdc}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: params.marketAddress,
            abiFunctionSignature: 'buy(bool,uint256,uint256)',
            abiParameters: [params.buyYes, amount.toString(), minShares.toString()],
            refId: `oracledesk-buyArc-${params.marketAddress}-${Date.now()}`,
        });
        return `circle:${result.transactionId}`;
    }
    return writeWalletContract({
        address: params.marketAddress,
        abi: contracts_1.PREDICTION_MARKET_ABI,
        functionName: 'buy',
        args: [params.buyYes, amount, minShares],
    });
}
/**
 * Publishes a reasoning trace proof to the ReasoningRegistry on Arc.
 */
async function publishReasoningToRegistry(params) {
    const sha256Hash = params.sha256Hash.startsWith('0x')
        ? params.sha256Hash
        : `0x${params.sha256Hash}`;
    // If relatedId is a UUID, we need to format it or use a different representation
    // ReasoningRegistry expects bytes32 for relatedId.
    // For simplicity, we can hash the relatedId if it's not already bytes32.
    const relatedIdBytes = params.relatedId.startsWith('0x') && params.relatedId.length === 66
        ? params.relatedId
        : (0, viem_1.keccak256)((0, viem_1.toBytes)(params.relatedId));
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`publishReasoning:${params.ipfsCid}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: contracts_1.CONTRACT_ADDRESSES.reasoningRegistry,
            abiFunctionSignature: 'publishTrace(string,bytes32,string,bytes32)',
            abiParameters: [params.ipfsCid, sha256Hash, params.traceType, relatedIdBytes],
            refId: `oracledesk-publishReasoning-${params.ipfsCid}`,
        });
        return `circle:${result.transactionId}`;
    }
    return writeWalletContract({
        address: contracts_1.CONTRACT_ADDRESSES.reasoningRegistry,
        abi: contracts_1.REASONING_REGISTRY_ABI,
        functionName: 'publishTrace',
        args: [params.ipfsCid, sha256Hash, params.traceType, relatedIdBytes],
    });
}
async function submitFundBet(params) {
    const marketIdBytes = marketIdToBytes32(params.marketId);
    const amount = (0, viem_1.parseUnits)(params.amountUsdc.toFixed(6), 6);
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`fundBet:${params.marketId}:${params.amountUsdc}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: contracts_1.CONTRACT_ADDRESSES.treasuryManager,
            abiFunctionSignature: 'fundBet(bytes32,uint256,uint32)',
            abiParameters: [marketIdBytes, amount.toString(), '1000'],
            refId: `oracledesk-fundBet-${params.marketId}`,
        });
        return `circle:${result.transactionId}`;
    }
    return writeWalletContract({
        address: contracts_1.CONTRACT_ADDRESSES.treasuryManager,
        abi: contracts_1.TREASURY_MANAGER_ABI,
        functionName: 'fundBet',
        args: [marketIdBytes, amount, 1000],
    });
}
async function submitOracleApproval(params) {
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`oracle:${params.marketAddress}:${params.yesWon}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
            abiFunctionSignature: 'approveResolution(address,bool)',
            abiParameters: [params.marketAddress, params.yesWon],
            refId: `oracledesk-oracle-${params.marketAddress}-${params.yesWon}`,
        });
        return `circle:${result.transactionId}`;
    }
    return writeWalletContract({
        address: contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
        abi: contracts_1.MULTISIG_ORACLE_ABI,
        functionName: 'approveResolution',
        args: [params.marketAddress, params.yesWon],
    });
}
/**
 * Records a Polymarket position on the Arc PositionLedger.
 */
async function openPositionOnLedger(params) {
    const usdcSpent = (0, viem_1.parseUnits)(params.usdcSpent.toFixed(6), 6);
    const conditionId = params.conditionId.startsWith('0x') ? params.conditionId : `0x${params.conditionId}`;
    const sha256Hash = params.sha256Hash.startsWith('0x') ? params.sha256Hash : `0x${params.sha256Hash}`;
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        return `0x${(0, viem_1.keccak256)((0, viem_1.toBytes)(`openPosition:${params.conditionId}:${Date.now()}`)).slice(2)}`;
    }
    if (config_1.config.CHAIN_EXECUTION_MODE === 'circle') {
        const result = await (0, circle_service_1.createCircleContractExecution)({
            contractAddress: contracts_1.CONTRACT_ADDRESSES.positionLedger,
            abiFunctionSignature: 'openPosition(bytes32,bytes32,uint256,uint8,uint256,uint256,uint256,string,bytes32,string)',
            abiParameters: [
                (0, viem_1.keccak256)((0, viem_1.toBytes)(Date.now().toString())), // dummy positionId
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
        address: contracts_1.CONTRACT_ADDRESSES.positionLedger,
        abi: contracts_1.POSITION_LEDGER_ABI,
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
async function writeWalletContract(params) {
    if (!config_1.config.AGENT_PRIVATE_KEY) {
        throw new error_middleware_1.AppError(500, 'AGENT_PRIVATE_KEY_MISSING', 'AGENT_PRIVATE_KEY is required for wallet execution mode');
    }
    const privateKey = config_1.config.AGENT_PRIVATE_KEY.startsWith('0x')
        ? config_1.config.AGENT_PRIVATE_KEY
        : `0x${config_1.config.AGENT_PRIVATE_KEY}`;
    const account = (0, accounts_1.privateKeyToAccount)(privateKey);
    const walletClient = (0, viem_1.createWalletClient)({
        account,
        chain: arcChain,
        transport: (0, viem_1.http)(config_1.config.ARC_RPC_URL),
    });
    return walletClient.writeContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
    });
}
