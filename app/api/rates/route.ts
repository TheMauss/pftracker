import { NextResponse } from "next/server";

export const revalidate = 3600; // cache 1 hour

export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("rates fetch failed");
    const data = await res.json();
    return NextResponse.json({ rates: data.rates, time: data.time_last_update_utc });
  } catch {
    return NextResponse.json({ rates: {}, time: null }, { status: 502 });
  }
}
