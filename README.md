# OracleDesk Backend API Documentation

## Overview

OracleDesk is an AI-powered prediction market backend built with:

- Node.js
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL
- Circle Wallets API
- Arc Testnet
- Redis
- JWT Authentication
- IPFS (Pinata)
- Gemini AI

The backend powers:

- AI-generated prediction markets
- Reasoning traces
- Copy trading
- Portfolio analytics
- Oracle market resolution
- Subscription/paywall system
- USDC micropayments
- Circle wallet integration

---

# Base URL

```bash
https://oracledesk-backend.onrender.com/api/v1
```

Local:

```bash
http://localhost:8000/api/v1
```

---

# Response Format

All API responses follow the same structure.

## Success Response

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

---

## Error Response

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

---

# Authentication

OracleDesk uses JWT Bearer authentication.

## Authorization Header

```http
Authorization: Bearer <JWT_TOKEN>
```

---

# Auth Flow

## Connect Wallet

### Endpoint

```http
POST /auth/connect
```

### Description

Authenticates a wallet and returns a JWT token.

### Headers

```http
Content-Type: application/json
```

### Request Body

```json
{
  "walletAddress": "0x123..."
}
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "token": "jwt_token",
    "user": {
      "id": "uuid",
      "walletAddress": "0x123..."
    }
  },
  "error": null
}
```

### Error Response

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_WALLET",
    "message": "Wallet address is required"
  }
}
```

---

# Markets API

Base Route:

```http
/api/v1/markets
```

---

# Get All Markets

### Endpoint

```http
GET /markets
```

### Description

Returns paginated prediction markets.

### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| page | number | No | Default: 1 |
| limit | number | No | Default: 20 |
| status | string | No | Market status |
| category | string | No | Market category |
| currency | string | No | USDC or EURC |

### Market Status Values

```ts
PENDING
ACTIVE
RESOLVING
RESOLVED
CANCELLED
```

### Market Categories

```ts
FED
ECB
ELECTION
GEOPOLITICAL
CRYPTO
MACRO
SPORTS
ENTERTAINMENT
POLITICS
```

### Settlement Currencies

```ts
USDC
EURC
```

### Success Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "question": "Will BTC hit $150k before Dec 2026?",
      "category": "CRYPTO",
      "status": "ACTIVE",
      "settlementCurrency": "USDC",
      "yesPrice": 0.67,
      "noPrice": 0.33,
      "expiryTimestamp": "2026-12-01T00:00:00.000Z"
    }
  ],
  "error": null,
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

# Get Single Market

### Endpoint

```http
GET /markets/:id
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "question": "Will BTC hit $150k before Dec 2026?",
    "category": "CRYPTO",
    "status": "ACTIVE",
    "description": "AI generated market...",
    "expiryTimestamp": "2026-12-01T00:00:00.000Z"
  },
  "error": null
}
```

---

# Generate AI Market

### Endpoint

```http
POST /markets/generate
```

### Authentication

Required

### Headers

```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Description

Triggers AI market generation job.

### Success Response

```json
{
  "ok": true,
  "data": {
    "jobId": "uuid",
    "status": "RUNNING"
  },
  "error": null
}
```

---

# Get Market Generation Status

### Endpoint

```http
GET /markets/generation-status/:jobId
```

### Authentication

Required

### Success Response

```json
{
  "ok": true,
  "data": {
    "status": "COMPLETED",
    "marketId": "uuid",
    "question": "Will ETH ETF be approved?",
    "category": "CRYPTO"
  },
  "error": null
}
```

---

# Portfolio API

Base Route:

```http
/api/v1/portfolio
```

---

# Get Portfolio Summary

### Endpoint

```http
GET /portfolio
```

### Description

Returns overall AI trading portfolio statistics.

### Success Response

```json
{
  "ok": true,
  "data": {
    "totalUsdc": 10000,
    "deployedCapital": 2300,
    "availableCapital": 7700,
    "openPositions": 7,
    "totalPnl": 320,
    "dailyPnl": 22,
    "builderFeesEarned": 14,
    "correlationRisk": {
      "hasCorrelatedPositions": false,
      "correlatedPairs": []
    }
  },
  "error": null
}
```

---

# Get Portfolio Positions

### Endpoint

```http
GET /portfolio/positions
```

### Query Parameters

| Param | Type | Description |
|---|---|---|
| page | number | Pagination |
| limit | number | Pagination |
| status | string | OPEN, CLOSED, STOP_LOSS, HEDGED |

### Success Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "status": "OPEN",
      "size": 100,
      "pnl": 12,
      "market": {
        "question": "Will Fed cut rates?",
        "category": "FED"
      },
      "trade": {
        "direction": "YES",
        "amount": 100,
        "edgeDetected": 0.12
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

# Traces API

Base Route:

```http
/api/v1/traces
```

---

# Get All Reasoning Traces

### Endpoint

```http
GET /traces
```

### Query Parameters

| Param | Type |
|---|---|
| page | number |
| limit | number |
| agentType | string |

### Success Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "agentType": "TRADER",
      "decisionType": "BUY_YES",
      "edge": 0.12,
      "probabilityEstimate": 0.74,
      "marketProbability": 0.61,
      "confidenceInterval": {
        "lower": 0.69,
        "upper": 0.79
      },
      "previewSources": [],
      "verified": true,
      "ipfsCid": "Qm..."
    }
  ]
}
```

---

# Get Single Trace

### Endpoint

```http
GET /traces/:id
```

### Access Levels

| Access | Description |
|---|---|
| FREE_PREVIEW | Only preview sources |
| PER_TRACE | Full access |
| DAILY_PASS | Full access |

### Unauthenticated Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "sourcesUsed": [],
    "accessLevel": "FREE_PREVIEW",
    "lockedFields": [
      "fullSources",
      "hedgeConditions",
      "betFraction"
    ],
    "unlockPrice": 0.005,
    "dailyPassPrice": 0.5
  }
}
```

### Full Access Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "sourcesUsed": [],
    "hedgeConditions": [],
    "betFraction": 0.04,
    "accessLevel": "PER_TRACE"
  }
}
```

---

# Verify Trace Integrity

### Endpoint

```http
POST /traces/verify
```

### Authentication

Required

### Request Body

```json
{
  "traceId": "uuid"
}
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "traceId": "uuid",
    "ipfsCid": "Qm...",
    "storedHash": "abc",
    "computedHash": "abc",
    "verified": true,
    "verifiedAt": "2026-05-20T12:00:00.000Z"
  }
}
```

---

# Unlock Trace

### Endpoint

```http
POST /traces/:id/unlock
```

### Authentication

Required

### Request Body

```json
{
  "txHash": "0xabc...",
  "amount": 0.005,
  "type": "PER_TRACE"
}
```

### Unlock Types

```ts
PER_TRACE
DAILY_PASS
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "subscription": {},
    "trace": {}
  }
}
```

---

# Spending Allowance

## Get Spending Allowance

### Endpoint

```http
GET /traces/access/allowance
```

### Authentication

Required

### Success Response

```json
{
  "ok": true,
  "data": {
    "dailyLimit": 10,
    "perTraceLimit": 1,
    "currency": "USDC",
    "spentToday": 0,
    "isActive": true
  }
}
```

### Possible Null Response

If user has never configured spending allowance:

```json
{
  "ok": true,
  "data": null,
  "error": null
}
```

---

# Update Spending Allowance

### Endpoint

```http
PUT /traces/access/allowance
```

### Authentication

Required

### Request Body

```json
{
  "dailyLimit": 10,
  "perTraceLimit": 1,
  "currency": "USDC"
}
```

---

# Get Payment Events

### Endpoint

```http
GET /traces/payments
```

### Authentication

Required

### Success Response

```json
{
  "ok": true,
  "data": [
    {
      "txHash": "0xabc...",
      "type": "PER_TRACE",
      "amount": 0.005,
      "currency": "USDC",
      "status": "CONFIRMED"
    }
  ]
}
```

---

# Trade API

Base Route:

```http
/api/v1/trade
```

---

# Initiate Copy Trade

### Endpoint

```http
POST /trade/copy
```

### Authentication

Required

### Request Body

```json
{
  "traceId": "uuid",
  "marketId": "uuid",
  "amount": 100,
  "userWallet": "0x..."
}
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "tradeId": "uuid",
    "status": "PENDING"
  }
}
```

---

# Confirm Copy Trade

### Endpoint

```http
PATCH /trade/copy/:id/confirm
```

### Authentication

Required

### Success Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "EXECUTED",
    "txHash": "0xabc..."
  }
}
```

---

# Oracle API

Base Route:

```http
/api/v1/oracle
```

---

# Get Market Resolution Status

### Endpoint

```http
GET /oracle/markets/:marketId/resolution
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "RESOLVING",
    "resolvedOutcome": true,
    "resolvedAt": null,
    "agentLogs": []
  }
}
```

---

# Resolve Market

### Endpoint

```http
POST /oracle/resolve
```

### Authentication

Required

### Request Body

```json
{
  "marketId": "uuid",
  "yesWon": true,
  "rationale": "Official Fed announcement"
}
```

### Success Response

```json
{
  "ok": true,
  "data": {
    "market": {},
    "txHash": "0xabc..."
  }
}
```

---

# Webhooks

# Circle Webhook

### Endpoint

```http
POST /webhooks/circle
```

### Required Headers

```http
x-circle-signature
x-circle-key-id
```

### Description

Handles Circle transaction confirmations and payment reconciliation.

---

# Error Codes

## Authentication Errors

| Code | Description |
|---|---|
| UNAUTHORIZED | Missing auth |
| INVALID_TOKEN | Invalid JWT |
| TOKEN_EXPIRED | JWT expired |

## Market Errors

| Code | Description |
|---|---|
| MARKET_NOT_FOUND | Market missing |
| MARKET_NOT_DEPLOYED | No chain address |
| MARKET_NOT_RESOLVABLE | Invalid state |

## Trace Errors

| Code | Description |
|---|---|
| TRACE_NOT_FOUND | Missing trace |
| MISSING_TRACE_ID | traceId required |
| PAYMENT_UNVERIFIED | Circle tx invalid |

## Subscription Errors

| Code | Description |
|---|---|
| ALLOWANCE_DAILY_LIMIT | Daily limit exceeded |
| ALLOWANCE_PER_TRACE_LIMIT | Per trace limit exceeded |
| INVALID_ALLOWANCE | Invalid limits |

---

# Pagination

All paginated endpoints return:

```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 120,
    "totalPages": 6
  }
}
```

---

# Environment Variables

## AGENT_PRIVATE_KEY

Private key of the autonomous OracleDesk AI trading wallet.

Used for:

- automated trades
- market making
- resolution execution
- treasury operations

Example:

```env
AGENT_PRIVATE_KEY=0xabc123...
```

Generate from:

- MetaMask
- Rabby
- Foundry wallet
- Hardhat wallet

---

## AGENT_WALLET_ADDRESS

Public wallet address derived from `AGENT_PRIVATE_KEY`.

Example:

```env
AGENT_WALLET_ADDRESS=0x742d35Cc6634C0532925a3b844Bc454e4438f44e
```

---

# Circle Wallet Variables

## CIRCLE_WALLET_ADDRESS

The Circle-controlled wallet used for:

- contract execution
- USDC payments
- treasury transfers

Example:

```env
CIRCLE_WALLET_ADDRESS=0xabc123...
```

You get this from:

1. Circle Developer Console
2. Create Wallet
3. Copy wallet address

---

# Frontend Integration Notes

## Always Handle

- `ok === false`
- `data === null`
- pagination meta
- expired JWTs
- subscription states

---

# Recommended Frontend Stack

- React
- Next.js
- React Query / TanStack Query
- Axios
- Zustand
- Wagmi
- RainbowKit
- Viem

---

# Recommended API Client Structure

```bash
src/
 ├── api/
 │   ├── auth.ts
 │   ├── markets.ts
 │   ├── traces.ts
 │   ├── portfolio.ts
 │   ├── oracle.ts
 │   └── trade.ts
```

---

# Suggested Frontend Flows

## Trace Unlock Flow

1. User opens trace preview
2. Frontend shows locked fields
3. User pays USDC
4. Frontend gets txHash
5. Call unlock endpoint
6. Backend verifies payment
7. Backend returns full trace

## Market Generation Flow

1. Call `/markets/generate`
2. Receive `jobId`
3. Poll `/markets/generation-status/:jobId`
4. Stop polling when:
   - COMPLETED
   - FAILED

---

# Security Notes

Frontend should NEVER expose:

- Circle API keys
- JWT secret
- Agent private key
- Pinata secret
- Database URL

---

# Production Notes

Before production deployment:

- enable strict Circle verification
- rotate JWT secret
- enable HTTPS
- add rate limiting
- add Redis queue workers
- add websocket streaming
- enable monitoring/logging
