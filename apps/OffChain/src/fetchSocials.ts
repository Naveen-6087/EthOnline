import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import type { TweetV2SingleResult, Tweetv2SearchParams } from 'twitter-api-v2';
import Snoowrap from 'snoowrap';
import type { Submission } from 'snoowrap';

interface SocialPost {
  id: string;
  platform: 'twitter' | 'reddit';
  content: string;
  author: string;
  timestamp: string;
  engagement: {
    likes?: number;
    retweets?: number;
    comments?: number;
    upvotes?: number;
  };
  url?: string;
}

type CryptoKeywords = string[];

const memeCoins: CryptoKeywords = [
  'dogecoin', 'DOGE', 'shiba inu', 'SHIB', 'pepecoin', 'PEPE',
  'floki', 'FLOKI', 'bonk', 'BONK', 'dogwifhat', 'WIF',
  'brett', 'mog', 'popcat', 'myro', 'wen', 'book of meme', 'BOME',
  'cats', 'mew', 'giga', 'moodeng', 'goat', 'act', 'pnut',
  'catcoin', 'grumpy cat', 'keyboard cat', 'nyan cat',
  'kishu inu', 'akita inu', 'babydoge', 'hokkaidu inu',
  'samoyedcoin', 'pitbull token', 'husky', 'corgi coin'
];

const subreddits: string[] = [
'CryptoCurrency', 'Bitcoin', 'ethtrader', 'CryptoMarkets',
'SatoshiStreetBets', 'CryptoMoonShots', 'CryptoCurrencyTrading',
'altcoin', 'defi', 'NFT', 'dogecoin', 'SHIBArmy',
'wallstreetbets', 'memecoins', 'CryptoMars'
];


const cryptoTerms: CryptoKeywords = [
  'meme coin', 'memecoin', 'shitcoin', 'crypto pump', 
  'pump signal', 'moon mission', 'to the moon', 'diamond hands',
  'paper hands', 'hodl', 'degen', 'ape in', 'rugpull'
];

const trendingHashtags: CryptoKeywords = [
  '#memecoin', '#memecoinseason', '#altseason', '#cryptopump',
  '#100x', '#moonshot', '#defi', '#degen', '#crypto'
];

const twitterClient: TwitterApi = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!);

const redditClient: Snoowrap = new Snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT!,
  clientId: process.env.REDDIT_CLIENT_ID!,
  clientSecret: process.env.REDDIT_CLIENT_SECRET!,
  username: process.env.REDDIT_USERNAME!,
  password: process.env.REDDIT_PASSWORD!,
});

function convertTweetToSocialPost(tweet: TweetV2SingleResult): SocialPost {
  return {
    id: tweet.id,
    platform: 'twitter',
    content: tweet.text,
    author: tweet.author_id || 'unknown',
    timestamp: tweet.created_at || new Date().toISOString(),
    engagement: {
      likes: tweet.public_metrics?.like_count || 0,
      retweets: tweet.public_metrics?.retweet_count || 0,
      comments: tweet.public_metrics?.reply_count || 0
    },
    url: `https://twitter.com/i/web/status/${tweet.id}`
  };
}

function convertRedditToSocialPost(post: Submission): SocialPost {
  return {
    id: post.id,
    platform: 'reddit',
    content: `${post.title}\n\n${post.selftext || ''}`.trim(),
    author: post.author.name,
    timestamp: new Date(post.created_utc * 1000).toISOString(),
    engagement: {
      upvotes: post.ups || 0,
      comments: post.num_comments || 0
    },
    url: `https://reddit.com${post.permalink}`
  };
}

async function searchTweets(
  query: string, 
  collection: TweetV2SingleResult[], 
  maxResults: number = 50
): Promise<void> {
  try {
    const params: Tweetv2SearchParams = {
      query,
      'tweet.fields': ['id', 'text', 'created_at', 'author_id', 'public_metrics'],
      max_results: maxResults,
    };

    const response = await twitterClient.v2.search(params);
    
    for await (const tweet of response) {
      collection.push(tweet);
    }
    
    console.log(`  ✓ Found ${response.tweets.length} tweets`);
  } catch (error) {
    console.error(`  ✗ Error fetching tweets:`, error);
  }
}


async function fetchTweets(memeCoins: String[], cryptoTerms: String[], trendingHashtags: String[]): Promise<SocialPost[]> {
  console.log('🐦 Fetching tweets...\n');

  const allTweets: TweetV2SingleResult[] = [];

  // Reduced strategies - only fetch what we need
  console.log('Strategy 1: Searching by meme coin names...');
  const coinQuery = memeCoins.slice(0, 3).map(k => `"${k}"`).join(' OR ') + ' -is:retweet lang:en';
  await searchTweets(coinQuery, allTweets, 3);

  console.log('Strategy 2: Searching by crypto terms...');
  const termsQuery = cryptoTerms.slice(0, 2).map(k => `"${k}"`).join(' OR ') + ' -is:retweet lang:en';
  await searchTweets(termsQuery, allTweets, 3);

  const uniqueTweets = Array.from(
    new Map(allTweets.map(t => [t.id, t])).values()
  );

  console.log(`\n✅ Total unique tweets fetched: ${uniqueTweets.length}\n`);

  return uniqueTweets.map(convertTweetToSocialPost);
}

async function fetchReddit(memeCoins: String[], cryptoTerms: String[], subreddits: String[]): Promise<SocialPost[]> {
  console.log('\n📱 Fetching Reddit posts...\n');

  const allPosts: Submission[] = [];

  // Reduced: Only search 2 subreddits with fewer coins
  console.log('Strategy 1: Searching by meme coin names...');
  for (const sub of subreddits.slice(0, 2)) {
    try {
      const subreddit = await redditClient.getSubreddit(sub);
      
      for (const coin of memeCoins.slice(0, 3)) {
        const results: Submission[] = await subreddit.search({
          query: coin,
          sort: 'new',
          time: 'week',
          limit: 2,
        });
        results.forEach(p => allPosts.push(p));
      }
      
      console.log(`  ✓ Searched r/${sub}`);
    } catch (error) {
      console.error(`  ✗ Error searching r/${sub}:`, error);
    }
  }

  // Reduced: Only get hot posts from 1 subreddit
  console.log('\nStrategy 2: Getting hot posts from meme coin subreddit...');
  try {
    const subreddit = await redditClient.getSubreddit('CryptoMoonShots');
    const hotPosts: Submission[] = await subreddit.getHot({ limit: 10 });
    hotPosts.forEach(p => allPosts.push(p));
    console.log(`  ✓ Got hot posts from r/CryptoMoonShots`);
  } catch (error) {
    console.error(`  ✗ Error getting hot posts:`, error);
  }

  const uniquePosts = Array.from(
    new Map(allPosts.map(p => [p.id, p])).values()
  );

  console.log(`\n✅ Total unique Reddit posts fetched: ${uniquePosts.length}\n`);

  return uniquePosts.map(convertRedditToSocialPost);
}

// Main function that returns all social posts
export async function fetchAllSocialData(): Promise<SocialPost[]> {
  console.log('🚀 Starting enhanced meme coin data fetch...\n');
  console.log('='.repeat(60) + '\n');
  
  const allPosts: SocialPost[] = [];
  
  try {
    const tweets = await fetchTweets(memeCoins, cryptoTerms, trendingHashtags);
    // Limit to 5 tweets
    allPosts.push(...tweets.slice(0, 5));
    
    const redditPosts = await fetchReddit(memeCoins, cryptoTerms, subreddits);
    // Limit to 10 Reddit posts
    allPosts.push(...redditPosts.slice(0, 10));
  } catch (error) {
    console.error('Fatal error:', error);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`🎯 Data fetch complete! Total posts: ${allPosts.length}`);
  console.log(`   - Tweets: ${allPosts.filter(p => p.platform === 'twitter').length}`);
  console.log(`   - Reddit posts: ${allPosts.filter(p => p.platform === 'reddit').length}`);
  
  return allPosts;
}

export async function fetaclTokenData(memecoins:String[], cryptoTerms: String[], subreddits: String[]):Promise<SocialPost[]>{
    const allPosts: SocialPost[] = [];
    try {
        const tweets = await fetchTweets(memecoins, cryptoTerms, trendingHashtags);
        allPosts.push(...tweets);
        
        const redditPosts = await fetchReddit(memecoins, cryptoTerms, subreddits);
        allPosts.push(...redditPosts);
        return allPosts;
    } catch (error) {
        console.log(error)
    }
}

//   (async () => {
//     const posts = await fetchAllSocialData();
    
//     // Display sample in required format
//     console.log('\n📋 Sample posts in SocialPost format:\n');
//     console.log(JSON.stringify(posts.slice(0, 5), null, 2));
    
//   })();
