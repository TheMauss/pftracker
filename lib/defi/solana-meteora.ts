/**
 * Fetches Meteora DLMM and Dynamic pool positions.
 */

import type { RawDefiPosition } from "../types";

const METEORA_API = "https://dlmm-api.meteora.ag";

interface MeteoraPosition {
  publicKey: string;
  lbPair: string;
  tokenX: { symbol: string; address: string; amount: number; usdValue: number };
  tokenY: { symbol: string; address: string; amount: number; usdValue: number };
  totalXYUsdValue: number;
  feeApr: number;
  rewardApr: number;
  apr: number;
}

export async function fetchMeteoraPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // DLMM positions (v2 endpoint)
    const dlmmUrl = `${METEORA_API}/position_v2/${walletAddress}`;
    const res = await fetch(dlmmUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json();
      const dlmmPositions: MeteoraPosition[] =
        data?.userPositions ?? data?.positions ?? (Array.isArray(data) ? data : []);

      for (const pos of dlmmPositions) {
        const totalUsd = pos.totalXYUsdValue ?? 0;
        if (totalUsd <= 0.01) continue;

        positions.push({
          protocol: "meteora",
          chain: "solana",
          position_type: "lp",
          asset_symbol: `${pos.tokenX?.symbol ?? "?"}-${pos.tokenY?.symbol ?? "?"}`,
          asset_address: pos.publicKey ?? null,
          amount: totalUsd,
          price_usd: 1.0,
          value_usd: totalUsd,
          is_debt: false,
          apy: pos.apr ?? pos.feeApr ?? null,
          extra_data: {
            lbPair: pos.lbPair,
            tokenX: { symbol: pos.tokenX?.symbol, amount: pos.tokenX?.amount, usd: pos.tokenX?.usdValue },
            tokenY: { symbol: pos.tokenY?.symbol, amount: pos.tokenY?.amount, usd: pos.tokenY?.usdValue },
            feeApr: pos.feeApr,
            rewardApr: pos.rewardApr,
          },
        });
      }
    }
  } catch (err) {
    console.error("Meteora fetch error:", err);
  }

  return positions;
}
