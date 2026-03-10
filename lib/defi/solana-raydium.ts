/**
 * Fetches Raydium CLMM LP positions via the Raydium API.
 */

import type { RawDefiPosition } from "../types";

const RAYDIUM_API = "https://api-v3.raydium.io";

interface RaydiumPosition {
  nftMint: string;
  poolId: string;
  mintA: { symbol: string; address: string };
  mintB: { symbol: string; address: string };
  amountA: number;
  amountB: number;
  amountAUsd: number;
  amountBUsd: number;
  totalUsd: number;
  apr24h: number;
  apr7d: number;
  apr30d: number;
  inRange: boolean;
  rewardInfos: Array<{ symbol: string; apr: number }>;
}

export async function fetchRaydiumPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const url = `${RAYDIUM_API}/position/list?wallet=${walletAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];

    const data = await res.json();
    const raydiumPositions: RaydiumPosition[] =
      data?.data?.data ?? data?.data ?? data ?? [];

    for (const pos of raydiumPositions) {
      if (!pos.totalUsd || pos.totalUsd <= 0.01) continue;

      const rewardApr = (pos.rewardInfos ?? []).reduce(
        (sum: number, r: { apr: number }) => sum + (r.apr ?? 0),
        0
      );
      const totalApr = (pos.apr24h ?? 0) + rewardApr;

      positions.push({
        protocol: "raydium",
        chain: "solana",
        position_type: "lp",
        asset_symbol: `${pos.mintA?.symbol ?? "?"}-${pos.mintB?.symbol ?? "?"}`,
        asset_address: pos.nftMint ?? null,
        amount: pos.totalUsd,
        price_usd: 1.0,
        value_usd: pos.totalUsd,
        is_debt: false,
        apy: totalApr,
        extra_data: {
          poolId: pos.poolId,
          inRange: pos.inRange,
          tokenA: { symbol: pos.mintA?.symbol, amount: pos.amountA, usd: pos.amountAUsd },
          tokenB: { symbol: pos.mintB?.symbol, amount: pos.amountB, usd: pos.amountBUsd },
          apr24h: pos.apr24h,
          apr7d: pos.apr7d,
        },
      });
    }
  } catch (err) {
    console.error("Raydium fetch error:", err);
  }

  return positions;
}
