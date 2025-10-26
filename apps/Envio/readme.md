# Envio HyperSync Integration Guide

## 🚀 Overview

Meme Sentinels leverages **Envio HyperSync** as its core blockchain data infrastructure to efficiently fetch and analyze token data across multiple EVM chains. HyperSync enables ultra-fast, cost-effective blockchain queries that would be impossible with traditional RPC methods.

---

## 📊 What We Use Envio For

### 1. **Multi-Chain Token Discovery**
Automatically discover thousands of newly deployed ERC-20 tokens across 6+ chains in real-time.

**Chains Supported:**
- Ethereum (Chain ID: 1)
- Base (Chain ID: 8453)
- Polygon (Chain ID: 137)
- Optimism (Chain ID: 10)
- Arbitrum (Chain ID: 42161)
- BSC (Chain ID: 56)

### 2. **Token Transaction Analysis**
Fetch complete transaction history for any token, including:
- Transfer events
- Approval events
- Transaction metadata (gas, timestamps, block numbers)
- Sender/receiver addresses

### 3. **Wallet Activity Tracking**
Monitor top-performing wallet addresses and their trading patterns:
- Track profit/loss calculations
- Identify "smart money" movements
- Discover other tokens traded by successful wallets

---

## 🏗️ Architecture

### Core Components

```
├── multichain-address.ts        # Multi-chain token discovery
├── multichain-transactions.ts   # Transaction history fetching
├── multichain-wallet.ts         # Wallet activity analysis
└── fetch-token-metadata.ts      # Token metadata enrichment
```

### Data Flow

```
1. Token Discovery (HyperSync)
   ↓
2. Transaction Fetching (HyperSync)
   ↓
3. Metadata Enrichment (Viem/RPC)
   ↓
4. Analysis & Scoring (AI Agents)
```

---

## 🔧 Implementation Details

### 1. Token Discovery (`multichain-address.ts`)

**Purpose:** Discover newly deployed tokens across multiple chains

**How It Works:**
- Scans Transfer events (`0xddf252ad...`) across specified time ranges
- Tracks first occurrence of each token address
- Filters by age (e.g., last 24 hours for meme coin candidates)
- Deduplicates across chains efficiently using Map structures

**Key Features:**
```typescript
// Fetch tokens from last 7 days across all chains
const tokens = await fetchTokenAddressesMultichain(7);

// Find meme coin candidates from last 24 hours
const memeCandidates = await fetchRecentMemeCandidates(24);
```

**Performance:**
- Processes 100,000+ events per batch
- Handles millions of tokens without memory overflow
- Parallel chain queries for maximum speed

---

### 2. Transaction Analysis (`multichain-transactions.ts`)

**Purpose:** Fetch complete transaction history for any token

**Events Tracked:**
- `Transfer(address,address,uint256)` - Token transfers
- `Approval(address,address,uint256)` - Token approvals

**Data Retrieved:**
- Block number and timestamp
- Transaction hash and index
- Sender/receiver addresses
- Gas used and gas price
- Event-specific data (amounts, addresses)

**Key Features:**
```typescript
// Get all transactions for a token across all chains
const { allTransactions, aggregatedStats } = 
  await getAllTokenTransactionsMultichain(tokenAddress);

// Get transactions for specific chains only
const data = await getAllTokenTransactionsMultichain(
  tokenAddress, 
  [1, 8453] // Ethereum and Base only
);
```

**Statistics Generated:**
- Total transaction count
- Transfer vs approval breakdown
- Unique address count
- Activity timeline (first/last transaction)
- Transactions per hour rate

---

### 3. Wallet Analysis (`multichain-wallet.ts`)

**Purpose:** Analyze wallet profitability and discover their other token holdings

**How It Works:**
1. Fetch all Transfer events for a specific token
2. Calculate profit/loss per wallet (sold - bought)
3. Identify top 5 most profitable wallets
4. For each top wallet, scan recent 24h activity
5. Discover other tokens they're trading (up to 50 per wallet)

**Key Features:**
```typescript
const { topWallets, otherTokens } = 
  await analyzeTokenWalletsMultiChain(tokenAddress);

// Returns:
// - Top 5 profitable wallets with profit calculations
// - Up to 50 other tokens each wallet has interacted with
// - Chain information for each token
```

**Use Cases:**
- Identify "smart money" following patterns
- Discover trending tokens before they pump
- Track whale movements and copy trades

---

## 📦 Configuration

### Environment Variables

```bash
# Optional: HyperSync Bearer Token (for higher rate limits)
HYPERSYNC_BEARER_TOKEN=your_token_here

# Chain-specific RPC URLs (fallbacks provided)
ETH_RPC_URL=https://eth.llamarpc.com
ARB_RPC_URL=https://arb1.arbitrum.io/rpc
BASE_RPC_URL=https://mainnet.base.org
OP_RPC_URL=https://mainnet.optimism.io
POLYGON_RPC_URL=https://polygon-rpc.com
BSC_RPC_URL=https://bsc-dataseed.binance.org
```

### Chain Configuration

```typescript
const CHAIN_CONFIGS = {
  eth: {
    chainId: 1,
    hypersyncUrl: "https://eth.hypersync.xyz",
    blockTime: 12, // seconds
  },
  base: {
    chainId: 8453,
    hypersyncUrl: "https://base.hypersync.xyz",
    blockTime: 2,
  },
  // ... more chains
};
```

---

## ⚡ Performance Optimizations

### 1. **Batch Processing**
- Fetches 100,000 events per query
- Minimal rate limiting (30ms between batches)
- Parallel chain queries for multi-chain operations

### 2. **Efficient Data Structures**
- Map-based deduplication (handles 100k+ tokens)
- Avoids array concat for large datasets
- Streams data instead of loading all at once

### 3. **Smart Filtering**
- Early termination when batch returns < 100k events
- Block range calculations based on chain block times
- Targeted queries using event signatures

### 4. **Memory Management**
```typescript
// ❌ Bad: Array spread with large datasets
const allTokens = [...chain1Tokens, ...chain2Tokens];

// ✅ Good: Map-based aggregation
const tokenMap = new Map();
for (const token of chainTokens) {
  tokenMap.set(token.address, token);
}
```

---

## 📈 Data Output Examples

### Token Discovery Output
```json
{
  "address": "0x1234...",
  "chainId": 8453,
  "chainName": "Base",
  "firstSeenBlock": 12345678,
  "firstSeenTimestamp": 1735123456,
  "transactionHash": "0xabcd...",
  "ageInHours": 2
}
```

### Transaction Analysis Output
```json
{
  "blockNumber": 12345678,
  "timestamp": 1735123456,
  "transactionHash": "0xabcd...",
  "from": "0x1234...",
  "to": "0x5678...",
  "eventType": "Transfer",
  "eventData": {
    "from": "0x1234...",
    "to": "0x5678...",
    "value": "1000000000000000000"
  },
  "chainId": 8453,
  "chainName": "Base"
}
```

### Wallet Analysis Output
```json
{
  "topWallets": [
    {
      "address": "0x1234...",
      "totalBought": "5000000000000000000",
      "totalSold": "8000000000000000000",
      "profit": "3000000000000000000",
      "chain": "base"
    }
  ],
  "otherTokens": {
    "0x1234...": [
      {
        "token": "0xabcd...",
        "chain": "base"
      }
    ]
  }
}
```

---

## 🎯 Why HyperSync?

### Traditional RPC Limitations
```typescript
// ❌ Slow: 2-5 seconds per 1000 blocks
// ❌ Expensive: Rate limited, requires paid plans
// ❌ Unreliable: Timeouts, missing data
```

### HyperSync Advantages
```typescript
// ✅ Fast: 100,000+ events in <1 second
// ✅ Cost-effective: Free tier with 100k events/query
// ✅ Reliable: Purpose-built for large-scale queries
```

### Speed Comparison
| Method | Time to Fetch 1M Events | Cost |
|--------|------------------------|------|
| Traditional RPC | ~2-3 hours | High (rate limits) |
| Envio HyperSync | ~30 seconds | Free (with token) |

---

## 🔗 Integration with Other Components

### 1. **Token Metadata Enrichment**
After HyperSync discovery, we use Viem for metadata:
```typescript
const tokens = await fetchTokenAddressesMultichain(7);
const enriched = await fetchTokenMetadata(tokens);
```

### 2. **AI Agent Pipeline**
HyperSync data feeds our multi-agent system:
- **Scout Agent**: Uses token discovery data
- **Yield Agent**: Analyzes transaction patterns
- **Risk Agent**: Monitors wallet activities
- **Alert Agent**: Tracks suspicious patterns

### 3. **Immutable Logging**
Important findings logged to Hedera HCS:
```typescript
// Token discovered → Log to HCS
// Suspicious pattern → Log to HCS
// AI decision → Log to HCS
```

---

## 📚 Resources

- [Envio HyperSync Docs](https://docs.envio.dev/docs/HyperSync/overview)
- [HyperSync Client SDK](https://github.com/enviodev/hypersync-client-node)
- [Supported Chains](https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks)
- [Query Examples](https://docs.envio.dev/docs/HyperSync/hypersync-query)

---

## 🛠️ Troubleshooting

### Common Issues

**1. Rate Limiting**
```typescript
// Solution: Add bearer token and reduce concurrency
const client = HypersyncClient.new({
  url: chain.url,
  bearerToken: process.env.HYPERSYNC_BEARER_TOKEN
});
```

**2. Memory Issues with Large Datasets**
```typescript
// Solution: Use Map instead of array operations
const tokenMap = new Map();
// ... instead of array.concat()
```

**3. Missing Data**
```typescript
// Solution: Always check for null/undefined
if (!log?.address || !log.topics) continue;
```

---

## 🚀 Future Enhancements

- [ ] WebSocket streaming for real-time updates
- [ ] GraphQL integration for complex queries
- [ ] On-demand indexing for custom events
- [ ] Enhanced caching layer for frequently accessed data
- [ ] Support for additional chains (Avalanche, Fantom)

---

Built with ❤️ using Envio HyperSync