"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREDICTION_MARKET_ABI = exports.MULTISIG_ORACLE_ABI = exports.TREASURY_MANAGER_ABI = exports.POSITION_LEDGER_ABI = exports.REASONING_REGISTRY_ABI = exports.MARKET_FACTORY_ABI = exports.CONTRACT_ADDRESSES = void 0;
const viem_1 = require("viem");
const index_1 = require("./index");
exports.CONTRACT_ADDRESSES = {
    treasuryManager: index_1.config.TREASURY_MANAGER_ADDRESS,
    positionLedger: index_1.config.POSITION_LEDGER_ADDRESS,
    multiSigOracle: index_1.config.MULTISIG_ORACLE_ADDRESS,
    marketFactory: index_1.config.MARKET_FACTORY_ADDRESS,
    reasoningRegistry: index_1.config.REASONING_REGISTRY_ADDRESS,
};
exports.MARKET_FACTORY_ABI = (0, viem_1.parseAbi)([
    'event MarketDeployed(address indexed market, string question, address oracle, uint256 expiryTimestamp, uint256 initialYesPrice, uint256 liquiditySeed, string reasoningCid)',
    'function createMarket(string _question, address _oracle, uint256 _expiryTimestamp, uint256 _initialYesPrice, uint256 _liquiditySeedUsdc, address _agentWallet, string _reasoningCid, bytes32 _sha256Hash, uint256 _confidenceIntervalBps) returns (address marketAddress)',
    'function getAllMarkets() view returns (address[])',
    'function marketExists(string _question) view returns (bool)',
    'function publishReasoning(address _market, address _agentWallet, string _ipfsCid, bytes32 _sha256Hash)',
]);
exports.REASONING_REGISTRY_ABI = (0, viem_1.parseAbi)([
    'event ReasoningPublished(bytes32 indexed traceId, address indexed agentWallet, string ipfsCid, bytes32 sha256Hash, string traceType, bytes32 relatedId, uint256 blockTimestamp)',
    'event TraceAccessed(bytes32 indexed traceId, address indexed subscriber, uint256 amountPaidUsdc, uint256 blockTimestamp)',
    'event SubscriberUpdated(address indexed subscriber, uint256 totalTracesRead, uint256 totalPaidUsdc)',
    'function publishTrace(string _ipfsCid, bytes32 _sha256Hash, string _traceType, bytes32 _relatedId) returns (bytes32 traceId)',
    'function verifyTrace(string _ipfsCid, bytes32 _sha256Hash) view returns (bool valid, uint256 publishedAt)',
    'function recordAccess(bytes32 _traceId, address _subscriber, uint256 _amountPaidUsdc)',
]);
exports.POSITION_LEDGER_ABI = (0, viem_1.parseAbi)([
    'event PositionOpened(bytes32 indexed positionId, bytes32 indexed conditionId, uint256 tokenId, uint8 side, uint256 usdcSpent, uint256 entryPriceBps, uint256 edgeBps, string reasoningCid, bytes32 sha256Hash, string polygonTxHash)',
    'event PositionClosed(bytes32 indexed positionId, uint8 state, int256 realisedPnl, uint256 closedAt)',
    'event ReasoningPublished(bytes32 indexed positionId, address indexed agentWallet, string ipfsCid, bytes32 sha256Hash, uint256 blockTimestamp)',
    'function getPosition(bytes32 _positionId) view returns ((bytes32 polymarketConditionId, uint256 polymarketTokenId, uint8 side, uint256 usdcSpent, uint256 sharesReceived, uint256 entryPriceBps, uint256 kellyFractionBps, uint256 edgeBps, uint256 openedAt, uint256 closedAt, string reasoningCid, bytes32 sha256Hash, uint8 state, int256 realisedPnl, string polygonTxHash, uint64 cctpNonce))',
    'function getOpenPositionIds() view returns (bytes32[])',
]);
exports.TREASURY_MANAGER_ABI = (0, viem_1.parseAbi)([
    'event FundedBet(bytes32 indexed marketId, uint256 usdcAmount, uint256 cctpNonce, address polygonWallet)',
    'event SweptBack(bytes32 indexed marketId, uint256 usdcAmount)',
    'event RiskParamsUpdated(uint256 maxSinglePositionBps, uint256 maxCorrelatedExposureBps, uint256 maxDailyDrawdownBps)',
    'event AgentPaused(string reason)',
    'event AgentResumed()',
    'function fundBet(bytes32 _marketId, uint256 _usdcAmount, uint32 _minFinalityThreshold) returns (uint64 cctpNonce)',
    'function maxBetAllowed() view returns (uint256)',
    'function getOpenPositions() view returns (bytes32[])',
]);
exports.MULTISIG_ORACLE_ABI = (0, viem_1.parseAbi)([
    'event MarketResolved(address market, bool yesWon)',
    'event ResolutionApproved(address signer, address market, bool yesWon, uint256 count)',
    'function approveResolution(address _market, bool _yesWon)',
    'function required() view returns (uint256)',
]);
exports.PREDICTION_MARKET_ABI = (0, viem_1.parseAbi)([
    'function buy(bool _buyYes, uint256 _usdcIn, uint256 _minSharesOut) returns (uint256 sharesOut)',
    'function sell(bool _sellYes, uint256 _sharesIn, uint256 _minUsdcOut) returns (uint256 usdcOut)',
    'function resolve(bool _yesWon)',
    'function redeem()',
    'function currentYesPrice() view returns (uint256)',
    'function currentSpreadBps() view returns (uint256)',
    'function totalLiquidity() view returns (uint256)',
    'function getMarketInfo() view returns (string, address, uint256, uint256, uint256, bool, bool, string)',
]);
