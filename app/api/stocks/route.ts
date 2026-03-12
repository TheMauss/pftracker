import { NextRequest, NextResponse } from "next/server";
import {
  getStockPositions, upsertStockPositions, deleteStockSource,
  insertManualPosition, deleteStockPosition, updateStockPosition,
} from "@/lib/db";
import { fetchStockPrices } from "@/lib/stocks";
import { parseEtoroXLSX } from "@/lib/importers/etoro";
import { parseRevolutCSV } from "@/lib/importers/revolut";

export async function GET() {
  const positions = getStockPositions();
  if (!positions.length) return NextResponse.json({ positions: [], total_usd: 0 });

  // Only fetch Yahoo prices for non-manual positions
  const nonManualTickers = [...new Set(
    positions.filter((p) => p.source !== "manual").map((p) => p.ticker)
  )];
  const quotes = nonManualTickers.length ? await fetchStockPrices(nonManualTickers) : new Map();

  const enriched = positions.map((p) => {
    if (p.source === "manual") {
      // Use stored price_usd for manual positions
      const price = p.price_usd ?? null;
      return {
        ...p,
        price_usd: price,
        value_usd: price != null ? price * p.quantity : null,
        display_name: p.name ?? p.ticker,
        currency: "USD",
      };
    }
    const q = quotes.get(p.ticker);
    const price = q?.price ?? null;
    return {
      ...p,
      price_usd: price,
      value_usd: price != null ? price * p.quantity : null,
      display_name: q?.name ?? p.name ?? p.ticker,
      currency: q?.currency ?? "USD",
    };
  });

  const total_usd = enriched.reduce((s, p) => s + (p.value_usd ?? 0), 0);
  return NextResponse.json({ positions: enriched, total_usd });
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  // Manual single position (JSON body)
  if (ct.includes("application/json")) {
    const body = await req.json();
    const { ticker, quantity, avg_price, name, price_usd, category } = body;
    if (!ticker || !quantity || quantity <= 0) {
      return NextResponse.json({ error: "Zadej ticker a množství" }, { status: 400 });
    }
    const id = insertManualPosition(ticker, quantity, avg_price ?? null, name ?? null, price_usd ?? null, category || "Akcie");
    return NextResponse.json({ id });
  }

  // CSV / XLSX import (form data)
  const formData = await req.formData();
  const file   = formData.get("file") as File | null;
  const source = formData.get("source") as string | null;

  if (!file || !source) {
    return NextResponse.json({ error: "Chybí soubor nebo zdroj" }, { status: 400 });
  }

  let parsed;
  try {
    if (source === "etoro") {
      const buf = await file.arrayBuffer();
      parsed = parseEtoroXLSX(buf);
    } else if (source === "revolut") {
      const text = await file.text();
      parsed = parseRevolutCSV(text);
    } else {
      return NextResponse.json({ error: "Neznámý zdroj" }, { status: 400 });
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  if (!parsed.length) {
    return NextResponse.json({ error: "Soubor neobsahuje žádné pozice" }, { status: 400 });
  }

  upsertStockPositions(parsed.map((p) => ({ source, price_usd: null, category: "Akcie", ...p })));
  return NextResponse.json({ imported: parsed.length });
}

export async function PATCH(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Chybí id" }, { status: 400 });
  const body = await req.json();
  const { ticker, name, quantity, avg_price, price_usd, category } = body;
  updateStockPosition(id, {
    ...(ticker    !== undefined && { ticker }),
    ...(name      !== undefined && { name }),
    ...(quantity  !== undefined && { quantity }),
    ...(avg_price !== undefined && { avg_price }),
    ...(price_usd !== undefined && { price_usd }),
    ...(category  !== undefined && { category }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  const id     = searchParams.get("id");

  if (id) {
    deleteStockPosition(Number(id));
    return NextResponse.json({ ok: true });
  }
  if (source) {
    deleteStockSource(source);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Chybí source nebo id" }, { status: 400 });
}
