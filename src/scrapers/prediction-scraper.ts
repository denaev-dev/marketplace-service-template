/**
 * Prediction Market Signal Aggregator
 * Mission #75 — Polymarket / Kalshi / Metaculus / Social Sentiment
 */

import { ProxyFetchOptions, proxyFetch } from "../proxy";

// ─── Types & Interfaces ───────────────────────────────────────────────────────

export interface MarketOdds {
  platform: "polymarket" | "kalshi" | "metaculus";
  marketId: string;
  question: string;
  yesProb: number; // 0–1
  noProb: number;  // 0–1
  volume24h: number | null;
  updatedAt: string;
}

export interface SentimentData {
  topic: string;
  sentimentScore: number;  // -1 → +1
  socialVolume: number;    // 0–100
  trendingRank: number | null;
  provider: string;
  fetchedAt: string;
}

export interface DivergenceSignal {
  market: MarketOdds;
  sentiment: SentimentData;
  divergenceScore: number;
  direction: "market_bullish_social_bearish" | "market_bearish_social_bullish" | "aligned";
  confidence: "high" | "medium" | "low";
}

export interface AggregatedSignal {
  query: string;
  markets: MarketOdds[];
  sentiment: SentimentData | null;
  divergence: DivergenceSignal[];
  aggregatedAt: string;
}

export interface TrendingMarket {
  platform: "polymarket" | "kalshi" | "metaculus";
  marketId: string;
  question: string;
  volume24h: number | null;
  yesProb: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Polymarket ───────────────────────────────────────────────────────────────
const POLYMARKET_BASE = "https://gamma-api.polymarket.com";

export async function fetchPolymarketOdds(query: string): Promise<MarketOdds[]> {
  const url = `${POLYMARKET_BASE}/markets?search=${encodeURIComponent(query)}&limit=10&active=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any[] = await res.json();

    return data
      .filter((m) => m.outcomePrices)
      .map((m) => {
        let prices: number[] = [];
        try { prices = JSON.parse(m.outcomePrices).map(Number); } catch { prices = [0.5, 0.5]; }
        const yes = clamp(prices[0] ?? 0.5);
        return {
          platform: "polymarket",
          marketId: m.id,
          question: m.question,
          yesProb: yes,
          noProb: clamp(prices[1] ?? 1 - yes),
          volume24h: m.volume24hr ?? null,
          updatedAt: new Date().toISOString(),
        };
      });
  } catch { return []; }
}

export async function fetchPolymarketTrending(): Promise<TrendingMarket[]> {
  const url = `${POLYMARKET_BASE}/markets?limit=20&active=true&order=volume24hr&ascending=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any[] = await res.json();
    return data.map((m) => {
      let prices: number[] = [];
      try { prices = JSON.parse(m.outcomePrices).map(Number); } catch { prices = [0.5]; }
      return {
        platform: "polymarket",
        marketId: m.id,
        question: m.question,
        volume24h: m.volume24hr ?? null,
        yesProb: clamp(prices[0] ?? 0.5),
      };
    });
  } catch { return []; }
}

// ─── Kalshi ───────────────────────────────────────────────────────────────────
const KALSHI_BASE = "https://trading-api.kalshi.com/trade-api/v2";

export async function fetchKalshiOdds(query: string): Promise<MarketOdds[]> {
  const url = `${KALSHI_BASE}/markets?search=${encodeURIComponent(query)}&limit=10&status=open`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.markets) return [];

    return data.markets.map((m: any) => {
      const yesMid = ((m.yes_bid ?? 0) + (m.yes_ask ?? 0)) / 2 / 100;
      const noMid  = ((m.no_bid  ?? 0) + (m.no_ask  ?? 0)) / 2 / 100;
      return {
        platform: "kalshi",
        marketId: m.ticker,
        question: m.title,
        yesProb: clamp(yesMid || (1 - noMid)),
        noProb: clamp(noMid  || (1 - yesMid)),
        volume24h: m.volume_24h ?? null,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch { return []; }
}

export async function fetchKalshiTrending(): Promise<TrendingMarket[]> {
  const url = `${KALSHI_BASE}/markets?limit=20&status=open&order_by=volume&sort=desc`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.markets) return [];
    return data.markets.map((m: any) => ({
      platform: "kalshi",
      marketId: m.ticker,
      question: m.title,
      volume24h: m.volume_24h ?? null,
      yesProb: clamp(((m.yes_bid ?? 0) + (m.yes_ask ?? 0)) / 2 / 100),
    }));
  } catch { return []; }
}

// ─── Metaculus ────────────────────────────────────────────────────────────────
const METACULUS_BASE = "https://www.metaculus.com/api2";

export async function fetchMetaculusOdds(query: string): Promise<MarketOdds[]> {
  const url = `${METACULUS_BASE}/questions/?search=${encodeURIComponent(query)}&limit=10&type=forecast&status=open`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.results) return [];

    return data.results.map((q: any) => {
      const yesProb = q.community_prediction?.full?.q2 ?? 0.5;
      return {
        platform: "metaculus",
        marketId: String(q.id),
        question: q.title,
        yesProb: clamp(yesProb),
        noProb: clamp(1 - yesProb),
        volume24h: null,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch { return []; }
}

export async function fetchMetaculusTrending(): Promise<TrendingMarket[]> {
  const url = `${METACULUS_BASE}/questions/?limit=20&type=forecast&status=open&order_by=-activity`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.results) return [];
    return data.results.map((q: any) => ({
      platform: "metaculus",
      marketId: String(q.id),
      question: q.title,
      volume24h: null,
      yesProb: clamp(q.community_prediction?.full?.q2 ?? 0.5),
    }));
  } catch { return []; }
}

// ─── EXPERT: Social Sentiment Provider ────────────────────────────────────────
export async function fetchSocialSentiment(topic: string): Promise<SentimentData> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=relevance&t=day&limit=10`;
  
  try {
    const res = await proxyFetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const data = await res.json();
    if (!data?.data?.children) throw new Error("Empty logs");

    const posts = data.data.children;
    let totalScore = 0;
    let totalUpvotes = 0;

    posts.forEach((p: any) => {
      const text = (p.data.title + " " + p.data.selftext).toLowerCase();
      if (text.includes("bullish") || text.includes("buy")) totalScore += 0.2;
      if (text.includes("bearish") || text.includes("sell")) totalScore -= 0.2;
      totalUpvotes += p.data.ups ?? 0;
    });

    return {
      topic,
      sentimentScore: clamp(totalScore, -1, 1),
      socialVolume: clamp(totalUpvotes / 100, 0, 100),
      trendingRank: null,
      provider: "Nexus_Reddit_Forensic_v1",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return fetchMockSentiment(topic);
  }
}

// ─── Divergence & Aggregation ─────────────────────────────────────────────────
export function computeDivergence(market: MarketOdds, sentiment: SentimentData): DivergenceSignal {
  const marketBias = market.yesProb * 2 - 1;
  const sentScore  = clamp(sentiment.sentimentScore, -1, 1);
  const rawDivergence = Math.abs(marketBias - sentScore);
  const divergenceScore = clamp(rawDivergence / 2);

  let direction: DivergenceSignal["direction"] = "aligned";
  if (rawDivergence > 0.15) {
    direction = marketBias > sentScore ? "market_bullish_social_bearish" : "market_bearish_social_bullish";
  }

  return {
    market, sentiment, divergenceScore, direction,
    confidence: divergenceScore > 0.4 ? "high" : divergenceScore > 0.2 ? "medium" : "low"
  };
}

export async function aggregateSignal(query: string): Promise<AggregatedSignal> {
  const [poly, kalshi, meta] = await Promise.allSettled([
    fetchPolymarketOdds(query),
    fetchKalshiOdds(query),
    fetchMetaculusOdds(query),
  ]);

  const markets: MarketOdds[] = [
    ...(poly.status === "fulfilled" ? poly.value : []),
    ...(kalshi.status === "fulfilled" ? kalshi.value : []),
    ...(meta.status === "fulfilled" ? meta.value : []),
  ];

  const sentiment = await fetchSocialSentiment(query);
  const divergence = markets.map((m) => computeDivergence(m, sentiment));

  return { query, markets, sentiment, divergence, aggregatedAt: new Date().toISOString() };
}

export async function aggregateTrending(): Promise<TrendingMarket[]> {
  const [poly, kalshi, meta] = await Promise.allSettled([
    fetchPolymarketTrending(),
    fetchKalshiTrending(),
    fetchMetaculusTrending(),
  ]);

  const all: TrendingMarket[] = [
    ...(poly.status === "fulfilled" ? poly.value : []),
    ...(kalshi.status === "fulfilled" ? kalshi.value : []),
    ...(meta.status === "fulfilled" ? meta.value : []),
  ];

  return all.sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1)).slice(0, 20);
}

export function fetchMockSentiment(topic: string): SentimentData {
  return { topic, sentimentScore: 0.05, socialVolume: 10, trendingRank: null, provider: "Mock", fetchedAt: new Date().toISOString() };
}
