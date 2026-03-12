import { NextResponse } from "next/server";
import { getPriceArbHistory } from "@/lib/db";

export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asset     = searchParams.get("asset") ?? "BTC";
  const hoursBack = Math.min(parseInt(searchParams.get("hours") ?? "48"), 168);

  const points = getPriceArbHistory(asset, hoursBack);
  return NextResponse.json({ asset, hours: hoursBack, points });
}
