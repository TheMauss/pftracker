/**
 * Fetches Hyperliquid L1 perp + spot balances.
 * Uses the public Hyperliquid info API (no auth required).
 */

import type { RawTokenBalance } from "../types";

const HL_API = "https://api.hyperliquid.xyz/info";

interface HLMarginSummary {
  accountValue: string;
  totalMarginUsed: string;
  totalNtlPos: string;
  totalRawUsd: string;
}

interface HLAssetPosition {
  position: {
    coin: string;
    szi: string;
    entryPx: string | null;
    positionValue: string;
    unrealizedPnl: string;
    returnOnEquity: string;
    liquidationPx: string | null;
    leverage: { type: string; value: number };
    maxLeverage: number;
    marginUsed: string;
    cumFunding: { allTime: string; sinceOpen: string; sinceChange: string };
  };
  type: "oneWay";
}

interface HLClearinghouseState {
  assetPositions: HLAssetPosition[];
  crossMarginSummary: HLMarginSummary;
  marginSummary: HLMarginSummary;
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  time: number;
}

interface HLSpotBalance {
  coin: string;
  token: number;
  hold: string;
  total: string;
  entryNtl: string;
}

interface HLSpotState {
  balances: HLSpotBalance[];
}

interface HLSpotMeta {
  universe: Array<{ tokens: number[]; name: string; index: number }>;
  tokens: Array<{ name: string; index: number }>;
}

interface HLSpotAssetCtx {
  markPx: string;
  midPx: string | null;
  dayNtlVlm: string;
  prevDayPx: string;
}

async function hlPost<T>(type: string, user: string): Promise<T | null> {
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, user }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchSpotPrices(): Promise<Map<number, number>> {
  const prices = new Map<number, number>();
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return prices;
    const [meta, ctxs] = (await res.json()) as [HLSpotMeta, HLSpotAssetCtx[]];
    for (let i = 0; i < meta.universe.length; i++) {
      const market = meta.universe[i];
      const ctx = ctxs[i];
      if (!ctx?.markPx) continue;
      const price = parseFloat(ctx.markPx);
      if (!isNaN(price) && price > 0) {
        // tokens[0] = base token index, tokens[1] = quote token index
        prices.set(market.tokens[0], price);
      }
    }
  } catch {}
  return prices;
}

export async function fetchHyperliquidBalances(
  walletAddress: string
): Promise<RawTokenBalance[]> {
  const [perpState, spotState, spotPrices] = await Promise.all([
    hlPost<HLClearinghouseState>("clearinghouseState", walletAddress),
    hlPost<HLSpotState>("spotClearinghouseState", walletAddress),
    fetchSpotPrices(),
  ]);

  const tokens: RawTokenBalance[] = [];

  // ─── Perp account equity (counted in portfolio total) ────────────────────
  if (perpState) {
    const accountValue = parseFloat(perpState.marginSummary.accountValue);
    if (accountValue > 0.01) {
      tokens.push({
        token_symbol: "USDC",
        token_name: "Hyperliquid Perp Equity",
        token_address: undefined,
        chain: "hyperliquid",
        amount: accountValue,
        price_usd: 1.0,
        value_usd: accountValue,
        is_derivative: false, // equity IS counted in totals
      });
    }

    // ─── Individual perp positions (informational, excluded from totals) ──
    for (const { position } of perpState.assetPositions) {
      const size = parseFloat(position.szi);
      if (size === 0) continue;

      const posValue = parseFloat(position.positionValue);
      const unrealizedPnl = parseFloat(position.unrealizedPnl);
      const isLong = size > 0;
      const symbol = `${position.coin}-PERP${isLong ? "" : "-SHORT"}`;
      const entryPx = position.entryPx ? parseFloat(position.entryPx) : null;

      tokens.push({
        token_symbol: symbol,
        token_name: `${position.coin} Perpetual ${isLong ? "Long" : "Short"} x${position.leverage.value}`,
        token_address: undefined,
        chain: "hyperliquid",
        amount: Math.abs(size),
        price_usd: entryPx,
        value_usd: unrealizedPnl, // unrealized PnL (the equity row above captures actual value)
        is_derivative: true, // excluded from portfolio total
      });
    }
  }

  // ─── Spot balances ────────────────────────────────────────────────────────
  if (spotState?.balances) {
    for (const bal of spotState.balances) {
      const total = parseFloat(bal.total);
      if (total <= 0) continue;

      const isUsdc = bal.coin === "USDC" || bal.coin === "USDC.e";
      const priceUsd = isUsdc ? 1.0 : (spotPrices.get(bal.token) ?? null);
      const valueUsd = priceUsd != null ? total * priceUsd : 0;

      tokens.push({
        token_symbol: bal.coin,
        token_name: bal.coin,
        token_address: undefined,
        chain: "hyperliquid",
        amount: total,
        price_usd: priceUsd,
        value_usd: valueUsd,
        is_derivative: false,
      });
    }
  }

  return tokens;
}
