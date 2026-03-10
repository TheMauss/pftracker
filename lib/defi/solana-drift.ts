/**
 * Fetches Drift Protocol positions via the Drift data API.
 * Covers: perp positions, spot borrows/lends.
 * https://data.api.drift.trade
 */

import type { RawDefiPosition } from "../types";

const DRIFT_API = "https://data.api.drift.trade";

interface DriftPosition {
  marketIndex: number;
  marketName: string;
  baseAssetAmount: number;
  quoteAssetAmount: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unsettledPnl: number;
  side: "long" | "short";
  leverage: number;
  liquidationPrice: number;
  notionalValue: number;
  availableCollateral: number;
}

interface DriftSpotPosition {
  marketIndex: number;
  marketName: string;
  tokenAmount: number;
  tokenAmountUSD: number;
  isDebt: boolean;
  depositApy: number;
  borrowApy: number;
}

interface DriftUserResponse {
  perpPositions: DriftPosition[];
  spotPositions: DriftSpotPosition[];
  totalCollateral: number;
  freeCollateral: number;
  unrealizedPnl: number;
}

export async function fetchDriftPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  // Try multiple subaccounts (0-3)
  for (let subAccountId = 0; subAccountId <= 3; subAccountId++) {
    try {
      const url = `${DRIFT_API}/v2/positions?userPublicKey=${walletAddress}&subAccountId=${subAccountId}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) break;

      const data: DriftUserResponse = await res.json();
      if (!data) continue;

      // Spot positions (lends and borrows)
      for (const spot of data.spotPositions ?? []) {
        if (!spot.tokenAmountUSD || Math.abs(spot.tokenAmountUSD) <= 0.01) continue;
        positions.push({
          protocol: "drift",
          chain: "solana",
          position_type: spot.isDebt ? "borrow" : "lend",
          asset_symbol: spot.marketName ?? `SPOT-${spot.marketIndex}`,
          amount: Math.abs(spot.tokenAmount),
          price_usd:
            spot.tokenAmount !== 0
              ? Math.abs(spot.tokenAmountUSD / spot.tokenAmount)
              : null,
          value_usd: Math.abs(spot.tokenAmountUSD),
          is_debt: spot.isDebt,
          apy: spot.isDebt
            ? -(spot.borrowApy ?? null)
            : (spot.depositApy ?? null),
          extra_data: { subAccount: subAccountId },
        });
      }

      // Perp positions
      for (const perp of data.perpPositions ?? []) {
        if (!perp.notionalValue || Math.abs(perp.notionalValue) <= 0.01) continue;
        positions.push({
          protocol: "drift",
          chain: "solana",
          position_type: "perp",
          asset_symbol: `${perp.marketName}-PERP`,
          amount: Math.abs(perp.baseAssetAmount),
          price_usd: perp.markPrice ?? null,
          value_usd: perp.unrealizedPnl ?? 0,
          is_debt: false,
          apy: null,
          extra_data: {
            side: perp.side,
            leverage: perp.leverage,
            unrealizedPnl: perp.unrealizedPnl,
            subAccount: subAccountId,
          },
        });
      }
    } catch {
      break;
    }
  }

  return positions;
}
