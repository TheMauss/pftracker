import { NextResponse } from "next/server";
import {
  fetchPriceArbitrage,
  fetchDeltaNeutralData,
  type PriceArbitrage,
  type DeltaNeutralAsset,
} from "@/lib/yields";

export const revalidate = 0; // always fresh — prices are time-sensitive

export interface ArbitrageApiResponse {
  price_arb: PriceArbitrage[];
  delta_neutral: DeltaNeutralAsset[];
  fetched_at: string;
  errors: string[];
}

export async function GET() {
  try {
    const errors: string[] = [];

    const [arbResult, dnResult] = await Promise.allSettled([
      fetchPriceArbitrage(),
      fetchDeltaNeutralData(),
    ]);

    const price_arb: PriceArbitrage[] =
      arbResult.status === "fulfilled" ? arbResult.value : [];
    const delta_neutral: DeltaNeutralAsset[] =
      dnResult.status === "fulfilled" ? dnResult.value : [];

    if (arbResult.status === "rejected")
      errors.push(`Price arb fetch failed: ${arbResult.reason}`);
    if (dnResult.status === "rejected")
      errors.push(`Delta neutral fetch failed: ${dnResult.reason}`);

    return NextResponse.json({
      price_arb,
      delta_neutral,
      fetched_at: new Date().toISOString(),
      errors,
    } satisfies ArbitrageApiResponse);
  } catch (err) {
    console.error("/api/arbitrage error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
