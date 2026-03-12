/**
 * Fetches Scallop Protocol positions on Sui.
 * Scallop is a major lending protocol on Sui.
 * Uses Scallop's public portfolio API.
 */

import type { RawDefiPosition } from "../types";

const SCALLOP_API = "https://api.scallop.io";

interface ScallopPosition {
  coinName?:   string;
  symbol?:     string;
  coinType?:   string;
  supplyAmount?:  number | string;
  supplyValueUsd?: number | string;
  borrowAmount?:  number | string;
  borrowValueUsd?: number | string;
  // alternative field names
  amount?:     number | string;
  amountUsd?:  number | string;
  apy?:        number | string;
  supplyApy?:  number | string;
  borrowApy?:  number | string;
}

interface ScallopResponse {
  code?:     number;
  data?: {
    lendings?:    ScallopPosition[];
    borrowings?:  ScallopPosition[];
    supplies?:    ScallopPosition[];
    borrows?:     ScallopPosition[];
  };
}

function toNum(v: number | string | undefined | null): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v as string) || 0;
}

function sym(p: ScallopPosition): string {
  return (p.symbol ?? p.coinName ?? "?").toUpperCase();
}

export async function fetchScallopPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const res = await fetch(
    `${SCALLOP_API}/api/v1/portfolio?address=${walletAddress}`,
    {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(20_000),
    }
  );
  if (!res.ok) throw new Error(`Scallop API ${res.status}`);

  const json = (await res.json()) as ScallopResponse;
  const data = json.data ?? {};

  const supplies  = data.supplies  ?? data.lendings  ?? [];
  const borrows   = data.borrows   ?? data.borrowings ?? [];

  for (const s of supplies) {
    const amount   = toNum(s.supplyAmount ?? s.amount);
    const valueUsd = toNum(s.supplyValueUsd ?? s.amountUsd);
    if (valueUsd < 0.01 && amount <= 0) continue;
    const apy = toNum(s.supplyApy ?? s.apy);
    positions.push({
      protocol:      "scallop",
      chain:         "sui",
      position_type: "lend",
      asset_symbol:  sym(s),
      asset_address: s.coinType,
      amount,
      price_usd:     amount > 0 && valueUsd > 0 ? valueUsd / amount : null,
      value_usd:     valueUsd,
      is_debt:       false,
      apy:           apy ? apy * 100 : null,
    });
  }

  for (const b of borrows) {
    const amount   = toNum(b.borrowAmount ?? b.amount);
    const valueUsd = toNum(b.borrowValueUsd ?? b.amountUsd);
    if (valueUsd < 0.01 && amount <= 0) continue;
    const apy = toNum(b.borrowApy ?? b.apy);
    positions.push({
      protocol:      "scallop",
      chain:         "sui",
      position_type: "borrow",
      asset_symbol:  sym(b),
      asset_address: b.coinType,
      amount,
      price_usd:     amount > 0 && valueUsd > 0 ? valueUsd / amount : null,
      value_usd:     valueUsd,
      is_debt:       true,
      apy:           apy ? -(apy * 100) : null,
    });
  }

  return positions;
}
