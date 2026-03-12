/**
 * Fetches NAVI Protocol positions on Sui.
 * NAVI is the largest lending protocol on Sui (like Aave).
 * Uses NAVI's public REST API.
 */

import type { RawDefiPosition } from "../types";

const NAVI_API = "https://open-api.naviprotocol.io";

interface NaviAsset {
  symbol:    string;
  coinType?: string;
  amount:    number | string;
  amountUSD: number | string;
  apy?:      number | string;
}

interface NaviPortfolio {
  supplies?: NaviAsset[];
  borrows?:  NaviAsset[];
  // Some API versions use these keys:
  deposits?: NaviAsset[];
  debts?:    NaviAsset[];
}

function toNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

export async function fetchNaviPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const res = await fetch(`${NAVI_API}/api/user/portfolio?address=${walletAddress}`, {
    headers: { Accept: "application/json" },
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NAVI API ${res.status}`);

  const json = await res.json() as { code?: number; data?: NaviPortfolio } | NaviPortfolio;

  // Handle both wrapped {code, data} and flat response formats
  const data: NaviPortfolio = ("data" in json && json.data) ? json.data : json as NaviPortfolio;

  const supplies = data.supplies ?? data.deposits ?? [];
  const borrows  = data.borrows  ?? data.debts    ?? [];

  for (const s of supplies) {
    const amount   = toNum(s.amount);
    const valueUsd = toNum(s.amountUSD);
    if (valueUsd < 0.01 && amount <= 0) continue;
    positions.push({
      protocol:      "navi",
      chain:         "sui",
      position_type: "lend",
      asset_symbol:  s.symbol ?? "?",
      asset_address: s.coinType,
      amount,
      price_usd:     amount > 0 && valueUsd > 0 ? valueUsd / amount : null,
      value_usd:     valueUsd,
      is_debt:       false,
      apy:           s.apy !== undefined ? toNum(s.apy) * 100 : null,
    });
  }

  for (const b of borrows) {
    const amount   = toNum(b.amount);
    const valueUsd = toNum(b.amountUSD);
    if (valueUsd < 0.01 && amount <= 0) continue;
    positions.push({
      protocol:      "navi",
      chain:         "sui",
      position_type: "borrow",
      asset_symbol:  b.symbol ?? "?",
      asset_address: b.coinType,
      amount,
      price_usd:     amount > 0 && valueUsd > 0 ? valueUsd / amount : null,
      value_usd:     valueUsd,
      is_debt:       true,
      apy:           b.apy !== undefined ? -(toNum(b.apy) * 100) : null,
    });
  }

  return positions;
}
