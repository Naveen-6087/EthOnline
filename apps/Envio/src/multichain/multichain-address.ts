import {
  HypersyncClient,
  BlockField,
  LogField,
} from "@envio-dev/hypersync-client";
import type { Query } from "@envio-dev/hypersync-client";
import * as dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config();

const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Multichain configuration
export const CHAINS = [
  {
    id: 1,
    name: "Ethereum",
    url: "https://eth.hypersync.xyz",
    blocksPerDay: 7200, // 12s blocks
    bearerToken:
      process.env.HYPERSYNC_BEARER_TOKEN ||
      "c09215fd-568a-48f0-83b3-c96c2572ad85",
  },
  {
    id: 8453,
    name: "Base",
    url: "https://base.hypersync.xyz",
    blocksPerDay: 43200, // 2s blocks
    bearerToken:
      process.env.HYPERSYNC_BEARER_TOKEN ||
      "c09215fd-568a-48f0-83b3-c96c2572ad85",
  },
  {
    id: 137,
    name: "Polygon",
    url: "https://polygon.hypersync.xyz",
    blocksPerDay: 43200, // 2s blocks
    bearerToken:
      process.env.HYPERSYNC_BEARER_TOKEN ||
      "c09215fd-568a-48f0-83b3-c96c2572ad85",
  },
  {
    id: 10,
    name: "Optimism",
    url: "https://optimism.hypersync.xyz",
    blocksPerDay: 43200, // 2s blocks
    bearerToken:
      process.env.HYPERSYNC_BEARER_TOKEN ||
      "c09215fd-568a-48f0-83b3-c96c2572ad85",
  },
  {
    id: 42161,
    name: "Arbitrum",
    url: "https://arbitrum.hypersync.xyz",
    blocksPerDay: 28800, // 3s blocks
    bearerToken:
      process.env.HYPERSYNC_BEARER_TOKEN ||
      "c09215fd-568a-48f0-83b3-c96c2572ad85",
  },
];

export interface TokenAddress {
  address: string;
  chainId: number;
  chainName: string;
  firstSeenBlock: number;
  firstSeenTimestamp: number;
  transactionHash: string;
  ageInHours: number;
}

/**
 * Fetch token addresses from a single chain
 */
async function fetchTokensFromChain(
  chain: (typeof CHAINS)[0],
  daysToLookBack: number
): Promise<TokenAddress[]> {
  // console.log(`\n📡 Fetching from ${chain.name} (Chain ID: ${chain.id})...`);

  const client = HypersyncClient.new({
    url: chain.url,
    bearerToken: chain.bearerToken,
  });

  // Get current block height using minimal query
  const heightQuery: Query = {
    fromBlock: 0,
    toBlock: 999999999,
    logs: [],
    fieldSelection: {
      block: [BlockField.Number],
    },
    maxNumBlocks: 1,
  };

  const heightRes = await client.get(heightQuery);
  const currentBlock = heightRes.nextBlock - 1;
  const startBlock = Math.max(
    0,
    currentBlock - chain.blocksPerDay * daysToLookBack
  );

  console.log(`   Current block: ${currentBlock}`);
  console.log(`   Start block: ${startBlock}`);
  console.log(`   Scanning ${currentBlock - startBlock} blocks...`);

  const tokenFirstSeen = new Map<
    string,
    { block: number; timestamp: number; txHash: string }
  >();

  let fromBlock = startBlock;
  let batchCount = 0;

  while (fromBlock < currentBlock) {
    batchCount++;

    const query: Query = {
      fromBlock,
      toBlock: currentBlock,
      logs: [
        {
          topics: [[TRANSFER_EVENT_SIGNATURE]],
        },
      ],
      fieldSelection: {
        block: [BlockField.Number, BlockField.Timestamp],
        log: [LogField.Address, LogField.BlockNumber, LogField.TransactionHash],
      },
      maxNumLogs: 100000, // Large batch for efficiency
    };

    try {
      const response = await client.get(query);

      if (!response?.data?.logs || response.data.logs.length === 0) {
        break;
      }

      console.log(
        `   Batch ${batchCount}: ${response.data.logs.length} events from block ${fromBlock}`
      );

      // Process logs
      for (const log of response.data.logs) {
        if (!log?.address) continue;

        const addr = log.address.toLowerCase();
        const blockNum = log.blockNumber ?? 0;
        const txHash = log.transactionHash ?? "";

        // Find corresponding block
        const block = response.data.blocks?.find((b) => b.number === blockNum);
        const blockTimestamp = block?.timestamp ?? 0;

        // Track first seen
        if (!tokenFirstSeen.has(addr)) {
          tokenFirstSeen.set(addr, {
            block: blockNum,
            timestamp: blockTimestamp,
            txHash,
          });
        } else {
          const existing = tokenFirstSeen.get(addr);
          if (existing && blockNum < existing.block) {
            tokenFirstSeen.set(addr, {
              block: blockNum,
              timestamp: blockTimestamp,
              txHash,
            });
          }
        }
      }

      fromBlock = response.nextBlock;

      // If we got less than requested, we're done
      if (response.data.logs.length < 100000) {
        break;
      }

      // Minimal rate limiting
      await new Promise((resolve) => setTimeout(resolve, 30));
    } catch (error) {
      console.error(`   ❌ Error in batch ${batchCount}:`, error);
      break;
    }
  }

  // Convert to TokenAddress objects
  const now = Math.floor(Date.now() / 1000);
  const chainTokens: TokenAddress[] = Array.from(tokenFirstSeen.entries()).map(
    ([address, info]) => ({
      address,
      chainId: chain.id,
      chainName: chain.name,
      firstSeenBlock: info.block,
      firstSeenTimestamp: info.timestamp,
      transactionHash: info.txHash,
      ageInHours: Math.floor((now - info.timestamp) / 3600),
    })
  );

  console.log(
    `   ✅ Found ${chainTokens.length} unique tokens on ${chain.name}`
  );

  return chainTokens;
}

/**
 * Fetch token addresses across multiple chains in parallel
 */
// Replace the entire fetchTokenAddressesMultichain function with this optimized version:

export async function fetchTokenAddressesMultichain(
  daysToLookBack: number = 7,
  chains: typeof CHAINS = CHAINS
): Promise<TokenAddress[]> {
  console.log("\n🔍 MULTICHAIN TOKEN ADDRESS FETCHER");
  console.log("━".repeat(70));
  console.log(`Looking back: ${daysToLookBack} days`);
  console.log(`Chains: ${chains.map((c) => c.name).join(", ")}\n`);

  const startTime = Date.now();

  // Fetch from all chains in parallel
  const results = await Promise.allSettled(
    chains.map((chain) => fetchTokensFromChain(chain, daysToLookBack))
  );

  // Use Map for efficient deduplication (handles 100k+ tokens without stack overflow)
  const uniqueTokensMap = new Map<string, TokenAddress>();

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const chainTokens = result.value;
      
      // Add tokens to map, keeping earliest occurrence
      for (const token of chainTokens) {
        const key = token.address.toLowerCase();
        
        if (!uniqueTokensMap.has(key)) {
          uniqueTokensMap.set(key, token);
        } else {
          // Keep the token with earliest timestamp
          const existing = uniqueTokensMap.get(key)!;
          if (token.firstSeenTimestamp < existing.firstSeenTimestamp) {
            uniqueTokensMap.set(key, token);
          }
        }
      }
    } else {
      const chainName = chains[index]?.name || "Unknown";
      console.error(`❌ Failed to fetch from ${chainName}`);
    }
  });

  // Convert map to array
  const allTokens = Array.from(uniqueTokensMap.values());

  // Sort by most recent first
  allTokens.sort((a, b) => b.firstSeenTimestamp - a.firstSeenTimestamp);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n✅ FETCH COMPLETE");
  console.log("━".repeat(70));
  console.log(`Total unique tokens found: ${allTokens.length}`);
  console.log(`Duration: ${duration}s\n`);

  // Print distribution by chain
  console.log("📊 Distribution by chain:");
  const distribution = allTokens.reduce(
    (acc, token) => {
      acc[token.chainName] = (acc[token.chainName] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.table(distribution);

  return allTokens;
}

/**
 * Find recent meme coin candidates (very new tokens)
 */
export async function fetchRecentMemeCandidates(
  hoursToLookBack: number = 24
): Promise<TokenAddress[]> {
  console.log("\n🎯 FINDING MEME COIN CANDIDATES");
  console.log("━".repeat(70));
  console.log(
    `Looking for tokens created in the last ${hoursToLookBack} hours\n`
  );

  const daysToLookBack = Math.ceil(hoursToLookBack / 24);
  const allTokens = await fetchTokenAddressesMultichain(daysToLookBack);

  // Filter to only very recent tokens
  const cutoffTimestamp =
    Math.floor(Date.now() / 1000) - hoursToLookBack * 3600;
  const recentTokens = allTokens.filter(
    (token) => token.firstSeenTimestamp >= cutoffTimestamp
  );

  console.log(`\n🎯 Found ${recentTokens.length} meme coin candidates`);

  // Show top 20 newest
  if (recentTokens.length > 0) {
    console.log("\n📋 Top 20 newest tokens:");
    console.table(
      recentTokens.slice(0, 20).map((t) => ({
        Chain: t.chainName,
        Address: t.address.slice(0, 10) + "...",
        Age: `${t.ageInHours}h`,
        Block: t.firstSeenBlock,
      }))
    );
  }

  // Save filtered results
  try {
    const output = {
      fetchedAt: new Date().toISOString(),
      hoursLookback: hoursToLookBack,
      totalCandidates: recentTokens.length,
      tokens: recentTokens,
    };

    await fs.writeFile(
      "./meme_coin_candidates.json",
      JSON.stringify(output, null, 2)
    );
    console.log("\n💾 Saved to: ./meme_coin_candidates.json");
  } catch (error) {
    console.error("Failed to save file:", error);
  }

  return recentTokens;
}

// CLI execution
// if (require.main === module) {
//   const args = process.argv.slice(2);
//   const mode = args[0] || "recent"; // 'all' or 'recent'
//   const lookback = parseInt(args[1]) || (mode === "recent" ? 24 : 7);

//   if (mode === "recent") {
//     fetchRecentMemeCandidates(lookback)
//       .then(() => process.exit(0))
//       .catch((error) => {
//         console.error("Error:", error);
//         process.exit(1);
//       });
//   } else {
//     fetchTokenAddressesMultichain(lookback)
//       .then(() => process.exit(0))
//       .catch((error) => {
//         console.error("Error:", error);
//         process.exit(1);
//       });
//   }
// }
