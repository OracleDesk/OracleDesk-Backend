import { parseAbi } from 'viem';
import { config } from './index';

export const CONTRACT_ADDRESSES = {
  treasuryManager: config.TREASURY_MANAGER_ADDRESS,
  positionLedger: config.POSITION_LEDGER_ADDRESS,
  multiSigOracle: config.MULTISIG_ORACLE_ADDRESS,
  marketFactory: config.MARKET_FACTORY_ADDRESS,
  reasoningRegistry: config.REASONING_REGISTRY_ADDRESS,
} as const;

export const MARKET_FACTORY_ABI = parseAbi([
  'event MarketDeployed(address indexed market, string question, address oracle, uint256 expiryTimestamp, uint256 initialYesPrice, uint256 liquiditySeed, string reasoningCid)',
  'function createMarket(string _question, address _oracle, uint256 _expiryTimestamp, uint256 _initialYesPrice, uint256 _liquiditySeedUsdc, address _agentWallet, string _reasoningCid, bytes32 _sha256Hash, uint256 _confidenceIntervalBps) returns (address marketAddress)',
  'function getAllMarkets() view returns (address[])',
  'function marketExists(string _question) view returns (bool)',
  'function publishReasoning(address _market, address _agentWallet, string _ipfsCid, bytes32 _sha256Hash)',
]);

export const REASONING_REGISTRY_ABI = parseAbi([
  'event ReasoningPublished(bytes32 indexed traceId, address indexed agentWallet, string ipfsCid, bytes32 sha256Hash, string traceType, bytes32 relatedId, uint256 blockTimestamp)',
  'event TraceAccessed(bytes32 indexed traceId, address indexed subscriber, uint256 amountPaidUsdc, uint256 blockTimestamp)',
  'event SubscriberUpdated(address indexed subscriber, uint256 totalTracesRead, uint256 totalPaidUsdc)',
  'function publishTrace(string _ipfsCid, bytes32 _sha256Hash, string _traceType, bytes32 _relatedId) returns (bytes32 traceId)',
  'function verifyTrace(string _ipfsCid, bytes32 _sha256Hash) view returns (bool valid, uint256 publishedAt)',
  'function recordAccess(bytes32 _traceId, address _subscriber, uint256 _amountPaidUsdc)',
]);

export const POSITION_LEDGER_ABI = parseAbi([
  'event PositionOpened(bytes32 indexed positionId, bytes32 indexed conditionId, uint256 tokenId, uint8 side, uint256 usdcSpent, uint256 entryPriceBps, uint256 edgeBps, string reasoningCid, bytes32 sha256Hash, string polygonTxHash)',
  'event PositionClosed(bytes32 indexed positionId, uint8 state, int256 realisedPnl, uint256 closedAt)',
  'event ReasoningPublished(bytes32 indexed positionId, address indexed agentWallet, string ipfsCid, bytes32 sha256Hash, uint256 blockTimestamp)',
  'function getPosition(bytes32 _positionId) view returns ((bytes32 polymarketConditionId, uint256 polymarketTokenId, uint8 side, uint256 usdcSpent, uint256 sharesReceived, uint256 entryPriceBps, uint256 kellyFractionBps, uint256 edgeBps, uint256 openedAt, uint256 closedAt, string reasoningCid, bytes32 sha256Hash, uint8 state, int256 realisedPnl, string polygonTxHash, uint64 cctpNonce))',
  'function getOpenPositionIds() view returns (bytes32[])',
]);

export const TREASURY_MANAGER_ABI = parseAbi([
  'event FundedBet(bytes32 indexed marketId, uint256 usdcAmount, uint256 cctpNonce, address polygonWallet)',
  'event SweptBack(bytes32 indexed marketId, uint256 usdcAmount)',
  'event RiskParamsUpdated(uint256 maxSinglePositionBps, uint256 maxCorrelatedExposureBps, uint256 maxDailyDrawdownBps)',
  'event AgentPaused(string reason)',
  'event AgentResumed()',
  'function fundBet(bytes32 _marketId, uint256 _usdcAmount, uint32 _minFinalityThreshold) returns (uint64 cctpNonce)',
  'function maxBetAllowed() view returns (uint256)',
  'function getOpenPositions() view returns (bytes32[])',
]);

export const MULTISIG_ORACLE_ABI = parseAbi([
  'event MarketResolved(address market, bool yesWon)',
  'event ResolutionApproved(address signer, address market, bool yesWon, uint256 count)',
  'function approveResolution(address _market, bool _yesWon)',
  'function required() view returns (uint256)',
]);

export const PREDICTION_MARKET_ABI = parseAbi([
  'function buy(bool _buyYes, uint256 _usdcIn, uint256 _minSharesOut) returns (uint256 sharesOut)',
  'function sell(bool _sellYes, uint256 _sharesIn, uint256 _minUsdcOut) returns (uint256 usdcOut)',
  'function resolve(bool _yesWon)',
  'function redeem()',
  'function currentYesPrice() view returns (uint256)',
  'function currentSpreadBps() view returns (uint256)',
  'function totalLiquidity() view returns (uint256)',
  'function getMarketInfo() view returns (string, address, uint256, uint256, uint256, bool, bool, string)',
]);
