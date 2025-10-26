import express from "express";
import cors from "cors";
import { fetaclTokenData, fetchAllSocialData } from "./fetchSocials.js";
import { SocialMediaAggregator } from "./aggregator.js";
import type { SocialPost, AnalyzedToken } from "./aggregator.js";
import { createClient } from "redis";
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
  console.error("❌ Redis Client Error:", err);
  console.error("Error details:", {
    message: err.message,
    stack: err.stack,
    name: err.name,
  });
});

client.on("connect", () => {
  console.log("✅ Redis connected successfully");
  console.log("Redis config:", {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    username: process.env.REDIS_USERNAME,
  });
});

(async () => {
  try {
    await client.connect();
    console.log("✅ Redis client initialized");
    console.log("Testing Redis connection with PING...");
    const pong = await client.ping();
    console.log("✅ Redis PING response:", pong);
  } catch (err: any) {
    console.error("❌ Failed to connect to Redis:", {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    process.exit(1);
  }
})();

const app = express();
const port = parseInt(process.env.PORT || "3002");

app.use(cors());
app.use(express.json());

let cachedRankings: any[] = [];
let lastRankingUpdate = 0;
const RANKING_CACHE_TTL = 2 * 60 * 1000;

function calculateSocialScore(tokenAnalysis: AnalyzedToken): number {
  const {
    sentimentScore = 0,
    trendingScore = 0,
    mentionCount = 0,
    avgEngagement = 0,
    confidence = 0,
    riskLevel = "medium",
  } = tokenAnalysis;

  const riskPenalty =
    {
      low: 1,
      medium: 0.8,
      high: 0.5,
      extreme: 0.2,
    }[riskLevel] || 0.8;

  const baseScore =
    trendingScore * 0.3 +
    (sentimentScore + 1) * 50 * 0.25 +
    Math.min(mentionCount, 100) * 0.2 +
    Math.min(avgEngagement / 10, 100) * 0.15 +
    confidence * 100 * 0.1;

  return Math.max(0, Math.min(100, Math.round(baseScore * riskPenalty)));
}

async function getTokenAddressesSorted(): Promise<any[]> {
  try {
    // Check if Redis is connected
    if (!client.isOpen) {
      console.error("❌ Redis client is not connected");
      return [];
    }

    const now = Date.now();
    if (
      cachedRankings.length > 0 &&
      now - lastRankingUpdate < RANKING_CACHE_TTL
    ) {
      console.log(
        `📦 Returning cached rankings (${cachedRankings.length} tokens)`
      );
      return cachedRankings;
    }

    console.log("🔍 Fetching token addresses from Redis...");
    const keys = await client.keys("0x*");
    console.log(`🔍 Found ${keys.length} token keys in Redis`);

    if (!keys.length) {
      console.log("⚠️ No token keys found in Redis");
      return [];
    }

    const values = await client.mGet(keys);
    const tokens = values
      .map((v) => (v ? JSON.parse(v) : null))
      .filter(Boolean)
      .map((v) => ({
        address: v.address,
        name: v.name || "",
        symbol: v.symbol || "",
        finalScore: v.finalScore || v.trendingscore || 0,
      }));

    const sorted = tokens.sort((a, b) => b.finalScore - a.finalScore);

    cachedRankings = sorted;
    lastRankingUpdate = now;

    console.log(`✅ Sorted ${sorted.length} tokens by score`);

    return sorted;
  } catch (error) {
    console.error("❌ Error in getTokenAddressesSorted:", error);
    return [];
  }
}

async function updateTokenSocialScore(
  address: string,
  socialScore: number,
  socialAnalysis: AnalyzedToken
): Promise<void> {
  try {
    const existingData = await client.get(address);
    if (!existingData) return;

    const tokenData = JSON.parse(existingData);
    const onChainScore = tokenData.trendingscore || 0;

    const finalScore = Math.round(onChainScore * 0.6 + socialScore * 0.4);

    const updatedData = {
      ...tokenData,
      socialScore,
      finalScore,
      socialAnalysis: {
        sentiment: socialAnalysis.sentiment,
        sentimentScore: socialAnalysis.sentimentScore,
        mentionCount: socialAnalysis.mentionCount,
        riskLevel: socialAnalysis.riskLevel,
        recommendation: socialAnalysis.recommendation,
        confidence: socialAnalysis.confidence,
        lastUpdated: new Date().toISOString(),
      },
    };

    await client.set(address, JSON.stringify(updatedData));
    cachedRankings = [];
  } catch (error) {
    // Error updating token
  }
}

async function updateTokensByRankRange(startRank: number, endRank: number) {
  try {
    const sortedTokens = await getTokenAddressesSorted();
    const tokensToUpdate = sortedTokens.slice(startRank, endRank);
    if (!tokensToUpdate.length) return;

    const tokenTickers = tokensToUpdate
      .map((t) => t.symbol || t.name || "")
      .filter(Boolean);
    if (!tokenTickers.length) return;

    const posts: SocialPost[] = await fetaclTokenData(
      tokenTickers as string[],
      ["meme coin", "crypto", "pump", "moon"] as string[],
      ["CryptoCurrency", "SatoshiStreetBets", "CryptoMoonShots"] as string[]
    );

    const aggregator = new SocialMediaAggregator(process.env.GEMINI_API_KEY!);
    aggregator.addPosts(posts);
    const analysis = await aggregator.analyzeTrends();

    const analysisMap = new Map<string, AnalyzedToken>();
    analysis.topTrending.forEach((token) => {
      const key = (token.ticker || token.tokenName).toLowerCase();
      analysisMap.set(key, token);
    });

    await Promise.all(
      tokensToUpdate.map(async (token) => {
        const tokenKey = (token.symbol || token.name || "").toLowerCase();
        const socialAnalysis = analysisMap.get(tokenKey);

        const finalAnalysis: AnalyzedToken = socialAnalysis || {
          tokenName: token.name || token.symbol || "Unknown",
          sentiment: "neutral",
          sentimentScore: 0,
          trendingScore: 0,
          signals: [],
          riskLevel: "medium",
          mentionCount: 0,
          avgEngagement: 0,
          keyPhrases: [],
          recommendation: "hold",
          confidence: 0,
          reasoning: "No recent social media mentions",
        };

        const socialScore = socialAnalysis
          ? calculateSocialScore(socialAnalysis)
          : 30;
        await updateTokenSocialScore(token.address, socialScore, finalAnalysis);
      })
    );
  } catch (error) {
    // Error updating tokens by rank range
  }
}

function startScheduledUpdates() {
  setInterval(() => updateTokensByRankRange(0, 20), 5 * 60 * 1000);
  setInterval(() => updateTokensByRankRange(20, 100), 20 * 60 * 1000);
  setInterval(() => updateTokensByRankRange(100, Infinity), 30 * 60 * 1000);
}

app.get("/", (req, res) => res.send("OffChain API is running"));

app.get("/allposts", async (req, res) => {
  try {
    const posts = await fetchAllSocialData();
    res.json(posts);
  } catch {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

app.post("/tokenpost", async (req, res) => {
  try {
    const { memeCoins, cryptoTerms, subreddits } = req.body;
    const posts = await fetaclTokenData(memeCoins, cryptoTerms, subreddits);
    res.json(posts);
  } catch {
    res.status(500).json({ error: "Failed to fetch token posts" });
  }
});

app.post("/social-analytics", async (req, res) => {
  try {
    const { memeCoins, cryptoTerms, subreddits } = req.body;
    const posts: SocialPost[] = await fetaclTokenData(
      memeCoins,
      cryptoTerms,
      subreddits
    );

    const aggregator = new SocialMediaAggregator(process.env.GEMINI_API_KEY!);
    aggregator.addPosts(posts);
    const analysis = await aggregator.analyzeTrends();

    res.json({ success: true, analysis, postsAnalyzed: posts.length });
  } catch {
    res.status(500).json({ error: "Failed to analyze social data" });
  }
});

app.post("/update-social-scores", async (req, res) => {
  try {
    const { startRank = 0, endRank = Infinity } = req.body;
    await updateTokensByRankRange(startRank, endRank);
    res.json({ success: true, message: "Social scores updated successfully" });
  } catch {
    res.status(500).json({ error: "Failed to update social scores" });
  }
});

app.get("/token/:address", async (req, res) => {
  try {
    const data = await client.get(req.params.address);
    if (!data) return res.status(404).json({ error: "Token not found" });
    return res.json(JSON.parse(data));
  } catch {
    return res.status(500).json({ error: "Failed to fetch token" });
  }
});

app.get("/top-tokens", async (req, res) => {
  console.log("📊 Received request for top tokens");
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    console.log(`📊 Fetching top ${limit} tokens...`);

    const tokens = await getTokenAddressesSorted();
    console.log(`📊 Found ${tokens.length} sorted tokens`);

    if (tokens.length === 0) {
      console.log("⚠️ No tokens found in Redis");
      return res.json([]);
    }

    const topAddresses = tokens.slice(0, limit);
    console.log(`📊 Getting data for top ${topAddresses.length} addresses`);

    const values = await client.mGet(topAddresses.map((t) => t.address));
    const fullData = values.filter(Boolean).map((v) => JSON.parse(v!));

    console.log(`✅ Returning ${fullData.length} tokens`);
    return res.json(fullData.map((t, i) => ({ ...t, rank: i + 1 })));
  } catch (error) {
    console.error("❌ Error fetching top tokens:", error);
    return res.status(500).json({ error: "Failed to fetch top tokens" });
  }
});

app.post("/clear-cache", (req, res) => {
  cachedRankings = [];
  lastRankingUpdate = 0;
  return res.json({ success: true, message: "Cache cleared" });
});

// -------------------- Start Server --------------------
app.listen(port, () => {
  console.log(`OffChain API listening at http://localhost:${port}`);
  startScheduledUpdates();
  setTimeout(() => updateTokensByRankRange(0, 20), 2000);
  setTimeout(() => updateTokensByRankRange(20, 100), 15000);
  setTimeout(() => updateTokensByRankRange(100, 300), 30000);
});
