/**
 * Fetches Pendle Finance positions via the Pendle Dashboard API.
 * GET /v1/dashboard/positions/database/{user}
 * Returns all positions across all chains in one call.
 */

import type { RawDefiPosition } from "../types";
import type { ChainId } from "../types";

const PENDLE_API = "https://api-v2.pendle.finance/core";

const CHAIN_ID_TO_NAME: Record<number, ChainId> = {
  999: "hyperevm",
  1: "ethereum",
  42161: "arbitrum",
};

const CHAIN_NAME_TO_ID: Record<string, number> = {
  hyperevm: 999,
  ethereum: 1,
  arbitrum: 42161,
};

interface PendleDashboardPosition {
  chainId: number;
  totalOpen: number;
  totalClosed: number;
  openPositions: Array<{
    marketId: string;
    pt: { valuation: number; balance: string };
    yt: { valuation: number; balance: string };
    lp: { valuation: number; balance: string; activeBalance: string };
  }>;
  syPositions: Array<{
    syAddress: string;
    valuation: number;
    balance: string;
  }>;
}

interface PendleDashboardResponse {
  positions: PendleDashboardPosition[];
}

// Cache for market metadata (symbol lookup)
const marketSymbolCache = new Map<string, string>();

async function getMarketSymbol(chainId: number, marketId: string): Promise<string> {
  const key = `${chainId}-${marketId}`;
  if (marketSymbolCache.has(key)) return marketSymbolCache.get(key)!;

  try {
    const res = await fetch(
      `${PENDLE_API}/v1/${chainId}/markets/${marketId}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) }
    );
    if (res.ok) {
      const data = await res.json();
      const symbol = data?.pt?.name ?? data?.name ?? data?.symbol ?? marketId.slice(0, 10);
      marketSymbolCache.set(key, symbol);
      return symbol;
    }
  } catch {
    // fallback
  }
  return marketId.split("-").pop()?.slice(0, 10) ?? "PENDLE";
}

export async function fetchPendlePositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const targetChainId = CHAIN_NAME_TO_ID[chain];
  if (!targetChainId) return [];

  const positions: RawDefiPosition[] = [];

  try {
    const url = `${PENDLE_API}/v1/dashboard/positions/database/${walletAddress}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return positions;

    const data: PendleDashboardResponse = await res.json();

    for (const chainPositions of data.positions ?? []) {
      // Only process the requested chain
      if (chainPositions.chainId !== targetChainId) continue;
      const chainName = CHAIN_ID_TO_NAME[chainPositions.chainId] ?? chain;

      for (const pos of chainPositions.openPositions ?? []) {
        const marketSymbol = await getMarketSymbol(chainPositions.chainId, pos.marketId);

        // PT position
        if (pos.pt?.valuation > 0.01) {
          positions.push({
            protocol: "pendle",
            chain: chainName,
            position_type: "pt",
            asset_symbol: `PT-${marketSymbol}`,
            asset_address: pos.marketId,
            amount: parseFloat(pos.pt.balance || "0"),
            price_usd: null,
            value_usd: pos.pt.valuation,
            is_debt: false,
            apy: null,
            extra_data: { type: "principal_token", marketId: pos.marketId },
          });
        }

        // YT position
        if (pos.yt?.valuation > 0.01) {
          positions.push({
            protocol: "pendle",
            chain: chainName,
            position_type: "yt",
            asset_symbol: `YT-${marketSymbol}`,
            asset_address: pos.marketId,
            amount: parseFloat(pos.yt.balance || "0"),
            price_usd: null,
            value_usd: pos.yt.valuation,
            is_debt: false,
            apy: null,
            extra_data: { type: "yield_token", marketId: pos.marketId },
          });
        }

        // LP position
        const lpVal = pos.lp?.valuation ?? 0;
        if (lpVal > 0.01) {
          positions.push({
            protocol: "pendle",
            chain: chainName,
            position_type: "lp",
            asset_symbol: `LP-${marketSymbol}`,
            asset_address: pos.marketId,
            amount: parseFloat(pos.lp.balance || "0"),
            price_usd: null,
            value_usd: lpVal,
            is_debt: false,
            apy: null,
            extra_data: { type: "lp_token", marketId: pos.marketId },
          });
        }
      }

      // SY positions (standardized yield tokens)
      for (const sy of chainPositions.syPositions ?? []) {
        if (sy.valuation <= 0.01) continue;
        positions.push({
          protocol: "pendle",
          chain: chainName,
          position_type: "vault",
          asset_symbol: `SY-${sy.syAddress.slice(0, 8)}`,
          asset_address: sy.syAddress,
          amount: parseFloat(sy.balance || "0"),
          price_usd: null,
          value_usd: sy.valuation,
          is_debt: false,
          apy: null,
          extra_data: { type: "sy_token" },
        });
      }
    }
  } catch (err) {
    console.error(`Pendle fetch error (chain ${chain}):`, err);
  }

  return positions;
}
