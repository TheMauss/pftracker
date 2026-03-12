import { NextRequest, NextResponse } from "next/server";
import { takeSnapshot } from "@/lib/snapshot";
import { invalidatePortfolioCache } from "@/lib/portfolio-cache";

export async function POST(req: NextRequest) {
  // Protect with secret header
  const secret = req.headers.get("x-snapshot-secret");
  if (secret !== process.env.SNAPSHOT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const overwrite = body?.overwrite === true;

    const result = await takeSnapshot(overwrite);
    invalidatePortfolioCache(); // next /api/portfolio call will re-fetch fresh data
    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/snapshot error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
