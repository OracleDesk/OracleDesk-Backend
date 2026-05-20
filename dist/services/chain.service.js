"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arcPublicClient = void 0;
exports.marketIdToBytes32 = marketIdToBytes32;
exports.submitFundBet = submitFundBet;
exports.submitOracleApproval = submitOracleApproval;
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
