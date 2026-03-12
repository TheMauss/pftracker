import { NextResponse } from "next/server";
import { getSnapshotHistory } from "@/lib/db";

export const revalidate = 3600;

export interface BenchmarkPoint {
  date: string;
  portfolio: number;   // % change from baseline
  btc: number;
  spx: number;
  portfolioUsd: number;
  btcPrice: number;
  spxPrice: number;
}

const TTL = 3_600_000; // 1h

let btcCache: { data: Map<string, number>; fetchedAt: number } | null = null;
let spxCache: { data: Map<string, number>; fetchedAt: number } | null = null;

async function getBtcPrices(): Promise<Map<string, number>> {
  const now = Date.now();
  if (btcCache && now - btcCache.fetchedAt < TTL) return btcCache.data;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily",
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const json = await res.json();
    const map = new Map<string, number>();
    for (const [ts, price] of (json.prices ?? []) as [number, number][]) {
      map.set(new Date(ts).toISOString().slice(0, 10), price);
    }
    btcCache = { data: map, fetchedAt: now };
    return map;
  } catch (err) {
    console.error("[benchmark] BTC fetch failed:", err);
    return btcCache?.data ?? new Map();
  }
}

async function getSpxPrices(): Promise<Map<string, number>> {
  const now = Date.now();
  if (spxCache && now - spxCache.fetchedAt < TTL) return spxCache.data;
  try {
    // Stooq — free, no key, returns CSV: Date,Open,High,Low,Close,Volume
    const res = await fetch(
      "https://stooq.com/q/d/l/?s=%5Espx&i=d",
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) throw new Error(`Stooq ${res.status}`);
    const text = await res.text();
    const map = new Map<string, number>();
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(",");
      if (parts.length < 5) continue;
      const date = parts[0]; // "YYYY-MM-DD"
      const close = parseFloat(parts[4]);
      if (date && !isNaN(close)) map.set(date, close);
    }
    spxCache = { data: map, fetchedAt: now };
    return map;
  } catch (err) {
    console.error("[benchmark] SPX fetch failed:", err);
    return spxCache?.data ?? new Map();
  }
}

function nearestPrice(map: Map<string, number>, targetDate: string): number | null {
  const exact = map.get(targetDate);
  if (exact) return exact;
  const target = new Date(targetDate).getTime();
  let best: number | null = null;
  let minDiff = Infinity;
  for (const [d, p] of map) {
    const diff = Math.abs(new Date(d).getTime() - target);
    if (diff < minDiff) { minDiff = diff; best = p; }
  }
  return best;
}

export async function GET() {
  try {
    const [snapshots, btcMap, spxMap] = await Promise.all([
      getSnapshotHistory(),
      getBtcPrices(),
      getSpxPrices(),
    ]);

    if (snapshots.length < 2) return NextResponse.json({ points: [] });

    const baseDate     = snapshots[0].taken_at.slice(0, 10);
    const basePortfolio = snapshots[0].total_usd;
    const baseBtc      = nearestPrice(btcMap, baseDate);
    const baseSpx      = nearestPrice(spxMap, baseDate);

    if (!baseBtc || !baseSpx) return NextResponse.json({ points: [] });

    const points: BenchmarkPoint[] = snapshots.map((s) => {
      const date         = s.taken_at.slice(0, 10);
      const btcPrice     = nearestPrice(btcMap, date) ?? baseBtc;
      const spxPrice     = nearestPrice(spxMap, date) ?? baseSpx;
      return {
        date,
        portfolio: +((s.total_usd  / basePortfolio - 1) * 100).toFixed(3),
        btc:       +((btcPrice     / baseBtc        - 1) * 100).toFixed(3),
        spx:       +((spxPrice     / baseSpx         - 1) * 100).toFixed(3),
        portfolioUsd: Math.round(s.total_usd),
        btcPrice:     Math.round(btcPrice),
        spxPrice:     Math.round(spxPrice),
      };
    });

    return NextResponse.json({ points });
  } catch (err) {
    console.error("[benchmark] error:", err);
    return NextResponse.json({ points: [] }, { status: 500 });
  }
}
