/**
 * Fetches Pendle Finance positions via Pendle REST API.
 * Supports HyperEVM (chainId 999), Ethereum (1), and Arbitrum (42161).
 */

import type { RawDefiPosition } from "../types";
import type { ChainId } from "../types";

const PENDLE_API = "https://api-v2.pendle.finance/core";

const CHAIN_MAP: Record<string, number> = {
  hyperevm: 999,
  ethereum: 1,
  arbitrum: 42161,
};

interface PendlePosition {
  pt: {
    address: string;
    symbol: string;
    expiry: string;
    priceUsd: number;
  };
  yt: {
    address: string;
    symbol: string;
    priceUsd: number;
  };
  lp: {
    address: string;
    symbol: string;
    priceUsd: number;
  };
  ptBalance: string;
  ytBalance: string;
  lpBalance: string;
  ptValueUsd: number;
  ytValueUsd: number;
  lpValueUsd: number;
  impliedApy: number;
  fixedApy: number;
}

export async function fetchPendlePositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const pendleChainId = CHAIN_MAP[chain];
  if (!pendleChainId) return [];

  const positions: RawDefiPosition[] = [];

  try {
    const url = `${PENDLE_API}/v1/${pendleChainId}/positions?address=${walletAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (!res.ok) {
      // Try alternate endpoint
      return await fetchPendleV2(walletAddress, pendleChainId, chain);
    }

    const data = await res.json();
    const pendlePositions: PendlePosition[] = data?.positions ?? data ?? [];

    for (const pos of pendlePositions) {
      // PT position (fixed yield)
      const ptAmount = parseFloat(pos.ptBalance ?? "0");
      if (ptAmount > 0 && pos.ptValueUsd > 0.01) {
        positions.push({
          protocol: "pendle",
          chain,
          position_type: "pt",
          asset_symbol: pos.pt?.symbol ?? "PT",
          asset_address: pos.pt?.address ?? null,
          amount: ptAmount,
          price_usd: pos.pt?.priceUsd ?? null,
          value_usd: pos.ptValueUsd,
          is_debt: false,
          apy: pos.fixedApy ?? null,
          extra_data: {
            expiry: pos.pt?.expiry,
            type: "principal_token",
            impliedApy: pos.impliedApy,
          },
        });
      }

      // YT position (yield token — leveraged yield)
      const ytAmount = parseFloat(pos.ytBalance ?? "0");
      if (ytAmount > 0 && pos.ytValueUsd > 0.01) {
        positions.push({
          protocol: "pendle",
          chain,
          position_type: "yt",
          asset_symbol: pos.yt?.symbol ?? "YT",
          asset_address: pos.yt?.address ?? null,
          amount: ytAmount,
          price_usd: pos.yt?.priceUsd ?? null,
          value_usd: pos.ytValueUsd,
          is_debt: false,
          apy: pos.impliedApy ?? null,
          extra_data: { type: "yield_token" },
        });
      }

      // LP position
      const lpAmount = parseFloat(pos.lpBalance ?? "0");
      if (lpAmount > 0 && pos.lpValueUsd > 0.01) {
        positions.push({
          protocol: "pendle",
          chain,
          position_type: "lp",
          asset_symbol: pos.lp?.symbol ?? "LP",
          asset_address: pos.lp?.address ?? null,
          amount: lpAmount,
          price_usd: pos.lp?.priceUsd ?? null,
          value_usd: pos.lpValueUsd,
          is_debt: false,
          apy: pos.impliedApy ?? null,
          extra_data: { type: "lp_token" },
        });
      }
    }
  } catch (err) {
    console.error(`Pendle fetch error (chain ${chain}):`, err);
  }

  return positions;
}

async function fetchPendleV2(
  walletAddress: string,
  chainId: number,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];
  try {
    // Get all markets for this chain, then check balances
    const marketsUrl = `${PENDLE_API}/v2/${chainId}/markets?limit=100`;
    const res = await fetch(marketsUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];

    const data = await res.json();
    const markets = data?.results ?? data?.markets ?? [];

    // For each market, check if user has PT/YT/LP via ERC20 balance
    // This is a fallback — just return empty for now and rely on main endpoint
    void markets;
    void walletAddress;
    void chain;
  } catch {
    // ignore
  }
  return positions;
}
