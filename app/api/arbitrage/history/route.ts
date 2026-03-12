import { NextResponse } from "next/server";
import { getFundingHistory } from "@/lib/db";
import { LEVERAGE_DN } from "@/lib/yields";

export const revalidate = 0;

function r4(n: number) { return Math.round(n * 10000) / 10000; }
function dailyToApy(daily: number) { return r4(daily * 365 * LEVERAGE_DN); }

export interface FundingHistoryChartPoint {
  fetched_at: string;
  hl_rate: number | null;
  lighter_rate: number | null;
  apy_spot: number | null;        // Perps/Spot (HL only)
  apy_pp_hl_short: number | null; // Perps/Perps: Short HL, Long Lighter
  apy_pp_lt_short: number | null; // Perps/Perps: Short Lighter, Long HL
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asset    = searchParams.get("asset") ?? "BTC";
  const hoursBack = Math.min(parseInt(searchParams.get("hours") ?? "48"), 168); // max 7d

  const raw = getFundingHistory(asset, hoursBack);

  const points: FundingHistoryChartPoint[] = raw.map((p) => {
    const hl = p.hl_rate;
    const lt = p.lighter_rate;
    return {
      fetched_at:      p.fetched_at,
      hl_rate:         hl,
      lighter_rate:    lt,
      apy_spot:        hl !== null ? dailyToApy(r4(hl * 3)) : null,
      apy_pp_hl_short: hl !== null && lt !== null ? dailyToApy(r4((hl - lt) * 3)) : null,
      apy_pp_lt_short: hl !== null && lt !== null ? dailyToApy(r4((lt - hl) * 3)) : null,
    };
  });

  return NextResponse.json({ asset, hours: hoursBack, points });
}
