/**
 * Fetches Orca Whirlpool LP positions via the Orca position API.
 */

import type { RawDefiPosition } from "../types";

const ORCA_API = "https://api.orca.so";

interface OrcaPosition {
  positionMint: string;
  whirlpool: string;
  tokenA: { symbol: string; mint: string; amount: number; usdValue: number };
  tokenB: { symbol: string; mint: string; amount: number; usdValue: number };
  totalUsdValue: number;
  feeApr: number;
  rewardApr: number;
  totalApr: number;
  isInRange: boolean;
}

export async function fetchOrcaPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const url = `${ORCA_API}/v1/whirlpool/positions?wallet=${walletAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];

    const data = await res.json();
    const raw = data?.positions ?? data;
    const orcaPositions: OrcaPosition[] = Array.isArray(raw) ? raw : [];

    for (const pos of orcaPositions) {
      if (!pos.totalUsdValue || pos.totalUsdValue <= 0.01) continue;

      positions.push({
        protocol: "orca",
        chain: "solana",
        position_type: "lp",
        asset_symbol: `${pos.tokenA?.symbol ?? "?"}-${pos.tokenB?.symbol ?? "?"}`,
        asset_address: pos.positionMint ?? null,
        amount: pos.totalUsdValue, // LP positions measured in USD value
        price_usd: 1.0,
        value_usd: pos.totalUsdValue,
        is_debt: false,
        apy: pos.totalApr ?? null,
        extra_data: {
          whirlpool: pos.whirlpool,
          isInRange: pos.isInRange,
          tokenA: { symbol: pos.tokenA?.symbol, amount: pos.tokenA?.amount, usd: pos.tokenA?.usdValue },
          tokenB: { symbol: pos.tokenB?.symbol, amount: pos.tokenB?.amount, usd: pos.tokenB?.usdValue },
          feeApr: pos.feeApr,
          rewardApr: pos.rewardApr,
        },
      });
    }
  } catch (err) {
    console.error("Orca fetch error:", err);
  }

  return positions;
}
