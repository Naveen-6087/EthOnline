import express from "express";
import cors from "cors";
import { fetchTokenAddresses } from "./fetch-token-address.js";
import { metadata } from "./test.js";
import { getAllTokenTransactions } from "./transaction.js";
import { OnChainAggregator } from "./aggregate.js";
import { createClient } from "redis";
import type { Transaction } from "./aggregate.js";
import { fetchTokenAddressesMultichain, type TokenAddress } from "./multichain/multichain-address.js";
import { analyzeTokenWalletsMultiChain } from "./wallet-analysis.js";
import * as dotenv from "dotenv";

dotenv.config();

const client = createClient({
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  },
});

client.on("error", (err: Error) => {
  console.error("Redis error:", err);
});

await client.connect();

const app = express();

app.use(cors());
app.use(express.json());

function calculateTrendingScore(metrics: any) {
  const {
    activityScore = 0,
    liquidityHealthScore = 0,
    momentumScore = 0,
    distributionScore = 0,
    buyVsSellRatio = 1,
    priceChange24h = 0,
  } = metrics;

  const score =
    activityScore * 0.25 +
    liquidityHealthScore * 0.2 +
    distributionScore * 0.15 +
    momentumScore * 0.1 +
    Math.min(buyVsSellRatio, 100) * 0.1 +
    Math.max(priceChange24h, -100) / 2;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Process tokens with concurrency control and batching
async function analyzeAndStoreTokens(
  tokens: TokenAddress[], 
  forceUpdate: boolean = false,
  concurrency: number = 10
) {
  console.log(`\n🔄 Processing ${tokens.length} tokens (concurrency: ${concurrency}, forceUpdate: ${forceUpdate})`);
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let noData = 0;

  // Process tokens in batches with concurrency control
  for (let i = 0; i < tokens.length; i += concurrency) {
    const batch = tokens.slice(i, i + concurrency);
    
    const promises = batch.map(async (token) => {
      try {
        // Check if token exists in Redis
        const existingData = await client.get(token.address);
        
        if (existingData && !forceUpdate) {
          skipped++;
          return;
        }

        // Fetch transaction and metadata
        const transactions: Transaction[] = await getAllTokenTransactions(token.address);
        const analysis = await metadata(token.address);

        // Validate we have data
        if (!transactions || transactions.length === 0) {
          noData++;
          return;
        }

        if (!analysis) {
          noData++;
          return;
        }

        // Create fresh aggregator for this token
        const aggregator = new OnChainAggregator();
        
        // Add data to aggregator
        aggregator.addTransactions(transactions);
        aggregator.addTokenData(analysis);

        // Analyze and calculate score
        const onChainMetrics = aggregator.analyzeOnChain();
        const trendingScore = calculateTrendingScore(onChainMetrics);

        // Log sample of successful analyses
        if (updated < 5 || updated % 100 === 0) {
          console.log(`   ✓ ${token.address.slice(0, 10)}... | Score: ${trendingScore} | Txs: ${transactions.length} | Chain: ${token.chainName}`);
        }

        // Store in Redis
        await client.set(
          token.address,
          JSON.stringify({
            address: token.address,
            chainId: token.chainId,
            chainName: token.chainName,
            trendingscore: trendingScore,
            block: token.firstSeenBlock,
            timestamp: token.firstSeenTimestamp,
            ageInHours: token.ageInHours,
            lastUpdated: Date.now(),
            metrics: {
              activityScore: onChainMetrics.activityScore,
              liquidityHealthScore: onChainMetrics.liquidityHealthScore,
              momentumScore: onChainMetrics.momentumScore,
              distributionScore: onChainMetrics.distributionScore,
              buyVsSellRatio: onChainMetrics.buyVsSellRatio,
            }
          })
        );
        
        updated++;
      } catch (err) {
        failed++;
        if (failed <= 5) {
          console.error(`❌ Failed to process ${token.address}:`, err instanceof Error ? err.message : err);
        }
      } finally {
        processed++;
      }
    });

    await Promise.all(promises);
    
    // Progress update every batch
    const progress = ((processed / tokens.length) * 100).toFixed(1);
    console.log(`📊 Progress: ${progress}% (${processed}/${tokens.length}) | Updated: ${updated} | Skipped: ${skipped} | No Data: ${noData} | Failed: ${failed}`);
  }

  console.log(`\n✅ Complete! Updated: ${updated} | Skipped: ${skipped} | No Data: ${noData} | Failed: ${failed}\n`);
  return { updated, skipped, noData, failed };
}

// Update ALL tokens in database (recalculate scores)
async function updateAllTokenScores(concurrency: number = 10) {
  console.log("♻️  Starting full database score update...");
  
  // Get all token addresses from Redis
  const keys = await client.keys("*");
  console.log(`Found ${keys.length} tokens in database`);
  
  if (keys.length === 0) {
    console.log("No tokens in database to update");
    return { updated: 0, failed: 0 };
  }
  
  // Get all token data
  const tokensInDb = await Promise.all(
    keys.map(async (key) => {
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    })
  );
  
  const validTokens = tokensInDb.filter(t => t !== null);
  
  // Convert to TokenAddress format
  const tokens: TokenAddress[] = validTokens.map(t => ({
    address: t.address,
    chainId: t.chainId || 1,
    chainName: t.chainName || 'Unknown',
    firstSeenBlock: t.block || 0,
    firstSeenTimestamp: t.timestamp || 0,
    ageInHours: t.ageInHours || 0,
    transactionHash: ''
  }));
  
  // Force update ALL tokens
  return await analyzeAndStoreTokens(tokens, true, concurrency);
}

// Check for new tokens and add them to database
async function addNewTokens(days: number = 1, maxNewTokens: number = 500) {
  console.log(`🔍 Checking for new tokens (last ${days} days)...`);
  
  const allTokens: TokenAddress[] = await fetchTokenAddressesMultichain(days);
  console.log(`Found ${allTokens.length} tokens from blockchain`);
  
  // Filter to only tokens NOT already in Redis
  const newTokens: TokenAddress[] = [];
  
  for (const token of allTokens) {
    const exists = await client.exists(token.address);
    if (!exists) {
      newTokens.push(token);
    }
  }
  
  console.log(`Found ${newTokens.length} NEW tokens not in database`);
  
  if (newTokens.length === 0) {
    return { added: 0, failed: 0 };
  }
  
  // Limit the number of new tokens to process
  const tokensToAdd = newTokens.slice(0, maxNewTokens);
  console.log(`Processing ${tokensToAdd.length} new tokens...`);
  
  // Add new tokens (forceUpdate = false since they're new)
  return await analyzeAndStoreTokens(tokensToAdd, false, 15);
}

app.get("/", (req, res) => {
  res.send("Envio API is running");
});

app.get("/token-addresses", async (req, res) => {
  try {
    const hypersyncurl = req.body?.hypersyncurl;
    if (hypersyncurl) {
      const addresses = await fetchTokenAddresses(hypersyncurl);
      return res.json(addresses);
    }
    const addresses = await fetchTokenAddresses();
    return res.json(addresses);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch token addresses" });
  }
});

app.post("/token-addresses", async (req, res) => {
  try {
    const { hypersyncurl, days } = req.body;

    if (hypersyncurl) {
      const addresses = await fetchTokenAddresses(days, hypersyncurl);
      return res.json(addresses);
    }

    const addresses = await fetchTokenAddresses();
    return res.json(addresses);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch token addresses" });
  }
});

app.get("/token-metadata/:address", async (req, res) => {
  try {
    const address = req.params.address;
    const data = await metadata(address);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch token metadata" });
  }
});

app.post("/token-metadata/:address", async (req, res) => {
  try {
    const address = req.params.address;
    const string = req.body?.string;
    if (string) {
      const data = await metadata(address, string);
      return res.json(data);
    }
    const data = await metadata(address);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch token metadata" });
  }
});

app.get("/transactions/:address", async (req, res) => {
  try {
    const tokenAddress = req.params.address as string;
    if (!tokenAddress) {
      return res.status(400).json({ error: "Token address is required" });
    }
    const transactions = await getAllTokenTransactions(tokenAddress);
    return res.json(transactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.post("/transactions/:address", async (req, res) => {
  try {
    const tokenAddress = req.params.address as string;
    if (!tokenAddress) {
      return res.status(400).json({ error: "Token address is required" });
    }
    const hypersyncurl = req.body?.hypersyncurl;
    if (hypersyncurl) {
      console.log("Using custom Hypersync URL from request body:", hypersyncurl);
      const transactions = await getAllTokenTransactions(tokenAddress, hypersyncurl);
      return res.json(transactions);
    }
    const transactions = await getAllTokenTransactions(tokenAddress);
    return res.json(transactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.post("/dbinit", async (req, res) => {
  try {
    console.log("🚀 Starting database initialization...");
    
    const maxTokens = req.body?.maxTokens || 5000;
    const days = req.body?.days || 30;
    
    const allTokens: TokenAddress[] = await fetchTokenAddressesMultichain(days);
    const tokens = allTokens.slice(0, maxTokens);
    
    console.log(`📊 Selected ${tokens.length} most recent tokens out of ${allTokens.length} total`);
    
    res.json({ 
      message: "Database initialization started", 
      totalTokens: allTokens.length,
      processing: tokens.length,
      days,
      note: "Processing in background. Check server logs for progress."
    });
    
    analyzeAndStoreTokens(tokens, false, 20).catch(console.error);
  } catch (error) {
    console.error("DB init error:", error);
    return res.status(500).json({ error: "Failed to initialize database" });
  }
});

// Refresh recent tokens and update scores
app.post("/refresh-tokens", async (req, res) => {
  try {
    console.log("🔄 Starting token refresh...");
    
    const days = req.body?.days || 2;
    const maxTokens = req.body?.maxTokens || 1000;
    
    const allTokens: TokenAddress[] = await fetchTokenAddressesMultichain(days);
    const tokens = allTokens.slice(0, maxTokens);
    
    console.log(`📊 Selected ${tokens.length} most recent tokens out of ${allTokens.length} total`);
    
    res.json({ 
      message: "Token refresh started", 
      totalTokens: allTokens.length,
      processing: tokens.length,
      days,
      note: "Processing in background. Check server logs for progress."
    });
    
    analyzeAndStoreTokens(tokens, true, 15).catch(console.error);
  } catch (error) {
    console.error("Refresh error:", error);
    return res.status(500).json({ error: "Failed to refresh tokens" });
  }
});

// Update ALL tokens in the database (recalculate scores for everything)
app.post("/update-all-scores", async (req, res) => {
  try {
    const concurrency = req.body?.concurrency || 10;
    
    const keys = await client.keys("*");
    
    if (keys.length === 0) {
      return res.json({ 
        message: "No tokens in database. Use /dbinit first.",
        tokensUpdated: 0
      });
    }
    
    res.json({ 
      message: "Full database update started", 
      totalTokens: keys.length,
      estimatedTime: `${Math.ceil(keys.length / concurrency / 60)} minutes`,
      note: "Processing in background. Check server logs for progress."
    });
    
    updateAllTokenScores(concurrency).catch(console.error);
    
  } catch (error) {
    console.error("Update all scores error:", error);
    return res.status(500).json({ error: "Failed to update all scores" });
  }
});

// Manually trigger adding new tokens
app.post("/add-new-tokens", async (req, res) => {
  try {
    const days = req.body?.days || 1;
    const maxNewTokens = req.body?.maxNewTokens || 500;
    
    res.json({ 
      message: "Checking for new tokens...", 
      days,
      maxNewTokens,
      note: "Processing in background. Check server logs for progress."
    });
    
    addNewTokens(days, maxNewTokens).catch(console.error);
    
  } catch (error) {
    console.error("Add new tokens error:", error);
    return res.status(500).json({ error: "Failed to add new tokens" });
  }
});

// Get all tokens sorted by trending score
app.get("/trending-tokens", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const chain = req.query.chain as string;
    
    const keys = await client.keys("*");
    
    const tokens = await Promise.all(
      keys.map(async (key) => {
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
      })
    );

    let filtered = tokens.filter(t => t !== null);
    
    if (chain) {
      filtered = filtered.filter(t => t.chainName?.toLowerCase() === chain.toLowerCase());
    }
    
    const sorted = filtered
      .sort((a, b) => (b.trendingscore || 0) - (a.trendingscore || 0))
      .slice(0, limit);

    return res.json({
      total: filtered.length,
      returned: sorted.length,
      chain: chain || "all",
      tokens: sorted
    });
  } catch (error) {
    console.error("Error fetching trending tokens:", error);
    return res.status(500).json({ error: "Failed to fetch trending tokens" });
  }
});

// Debug endpoint: Analyze a single token and see the full scoring breakdown
app.get("/debug/analyze/:address", async (req, res) => {
  try {
    const address = req.params.address;
    
    console.log(`\n🔍 DEBUG: Analyzing ${address}...`);
    
    const transactions: Transaction[] = await getAllTokenTransactions(address);
    const analysis = await metadata(address);
    
    console.log(`   Transactions: ${transactions.length}`);
    console.log(`   Metadata: ${analysis ? 'Found' : 'Not found'}`);
    
    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ error: "No transactions found" });
    }
    
    if (!analysis) {
      return res.status(404).json({ error: "No metadata found" });
    }
    
    const aggregator = new OnChainAggregator();
    aggregator.addTransactions(transactions);
    aggregator.addTokenData(analysis);
    
    const onChainMetrics = aggregator.analyzeOnChain();
    const trendingScore = calculateTrendingScore(onChainMetrics);
    
    console.log(`   Trending Score: ${trendingScore}`);
    
    return res.json({
      address,
      trendingScore,
      breakdown: {
        activityScore: onChainMetrics.activityScore,
        liquidityHealthScore: onChainMetrics.liquidityHealthScore,
        momentumScore: onChainMetrics.momentumScore,
        distributionScore: onChainMetrics.distributionScore,
        buyVsSellRatio: onChainMetrics.buyVsSellRatio,
        priceChange24h: analysis.priceChange24h,
      },
      formula: {
        activityWeight: "25%",
        liquidityWeight: "20%",
        distributionWeight: "15%",
        momentumWeight: "10%",
        buyVsSellWeight: "10%",
        priceChangeWeight: "20%"
      },
      rawMetrics: onChainMetrics,
      tokenData: analysis
    });
  } catch (error) {
    console.error("Debug analysis error:", error);
    return res.status(500).json({ error: "Failed to analyze token" });
  }
});

// Get chain distribution stats
app.get("/stats", async (req, res) => {
  try {
    const keys = await client.keys("*");
    
    const tokens = await Promise.all(
      keys.map(async (key) => {
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
      })
    );

    const validTokens = tokens.filter(t => t !== null);
    
    const chainStats = validTokens.reduce((acc, token) => {
      const chain = token.chainName || 'Unknown';
      if (!acc[chain]) {
        acc[chain] = { count: 0, avgScore: 0, totalScore: 0 };
      }
      acc[chain].count++;
      acc[chain].totalScore += token.trendingscore || 0;
      acc[chain].avgScore = acc[chain].totalScore / acc[chain].count;
      return acc;
    }, {} as Record<string, { count: number; avgScore: number; totalScore: number }>);

    return res.json({
      totalTokens: validTokens.length,
      chainDistribution: chainStats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

function stringifyBigInts(obj: any): any {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(stringifyBigInts);
  if (obj !== null && typeof obj === "object") {
    const res: any = {};
    for (const key in obj) {
      res[key] = stringifyBigInts(obj[key]);
    }
    return res;
  }
  return obj;
}

app.get("/analyze-wallets/:address", async (req, res) => {
  try {
    const tokenAddress = req.params.address as string;
    if (!tokenAddress) {
      return res.status(400).json({ error: "Token address is required" });
    }
    const analysis = await analyzeTokenWalletsMultiChain(tokenAddress);
    const safeAnalysis = stringifyBigInts(analysis);
    return res.json(safeAnalysis);
  } catch (error) {
    console.error("Wallet analysis error:", error);
    return res.status(500).json({ error: "Failed to analyze wallets" });
  }
});

// HOURLY JOB: Update all existing tokens AND add new tokens
const hourlyRefreshInterval = setInterval(
  async () => {
    try {
      const startTime = Date.now();
      console.log(`\n${"=".repeat(80)}`);
      console.log(`⏰ [${new Date().toISOString()}] HOURLY REFRESH STARTED`);
      console.log(`${"=".repeat(80)}\n`);
      
      // STEP 1: Check for new tokens (last 1 hour)
      console.log("STEP 1/2: Checking for new tokens...");
      const newTokensResult = await addNewTokens(1, 300); // Check last 1 day, max 300 new tokens
      console.log(`✅ New tokens added: ${newTokensResult.updated}`);
      
      // STEP 2: Update ALL existing tokens in database
      console.log("\nSTEP 2/2: Updating scores for all tokens in database...");
      const updateResult = await updateAllTokenScores(10); // Concurrency of 10
      console.log(`✅ Tokens updated: ${updateResult.updated}, Failed: ${updateResult.failed}`);
      
      const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
      console.log(`\n${"=".repeat(80)}`);
      console.log(`✅ [${new Date().toISOString()}] HOURLY REFRESH COMPLETED in ${duration} minutes`);
      console.log(`${"=".repeat(80)}\n`);
      
    } catch (error) {
      console.error(`\n${"=".repeat(80)}`);
      console.error(`❌ [${new Date().toISOString()}] HOURLY REFRESH FAILED`);
      console.error(`${"=".repeat(80)}`);
      console.error(error);
    }
  },
  60 * 60 * 1000 // Run every hour
);

// Cleanup on server shutdown
process.on('SIGTERM', () => {
  clearInterval(hourlyRefreshInterval);
  client.quit();
});

process.on('SIGINT', () => {
  clearInterval(hourlyRefreshInterval);
  client.quit();
});

const port = parseInt(process.env.PORT || "3001");

app.listen(port, () => {
  console.log(`\n🚀 Server running on port ${port}`);
  console.log(`📡 API Endpoints:`);
  console.log(`   POST /dbinit - Initialize database with new tokens`);
  console.log(`   POST /refresh-tokens - Refresh recent tokens (last 2 days)`);
  console.log(`   POST /update-all-scores - Update ALL tokens in database ⚡`);
  console.log(`   POST /add-new-tokens - Check and add new tokens`);
  console.log(`   GET  /trending-tokens?limit=50&chain=base - Get trending tokens`);
  console.log(`   GET  /stats - Get chain statistics`);
  console.log(`   GET  /debug/analyze/:address - Debug scoring for a token`);
  console.log(`\n⏰ Hourly auto-refresh: ENABLED (every 60 minutes)`);
  console.log(`   → Checks for new tokens across all chains`);
  console.log(`   → Updates scores for ALL existing tokens`);
  console.log(`⚠️  Use Ctrl+C to stop the server\n`);
});