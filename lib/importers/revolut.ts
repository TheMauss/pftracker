import type { ParsedStock } from "./etoro";
export type { ParsedStock };

export function parseRevolutCSV(text: string): ParsedStock[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("ticker") && lower.includes("type")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error("Nelze najít hlavičku CSV (očekává se Ticker + Type)");

  const headers = lines[headerIdx].split(",").map((h) => h.toLowerCase().trim().replace(/"/g, ""));
  const colTicker = headers.findIndex((h) => h === "ticker");
  const colType   = headers.findIndex((h) => h === "type");
  const colQty    = headers.findIndex((h) => h.includes("quantity"));
  const colPrice  = headers.findIndex((h) => h.includes("price per"));

  if (colTicker === -1 || colType === -1 || colQty === -1) {
    throw new Error("Chybí sloupce Ticker, Type nebo Quantity v CSV");
  }

  const map = new Map<string, { qty: number; totalCost: number; totalBought: number }>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/"/g, ""));
    if (cols.length < 3) continue;

    const ticker = cols[colTicker]?.toUpperCase()?.trim();
    const type   = cols[colType]?.toUpperCase()?.trim();
    if (!ticker) continue;

    const qty   = parseRevNum(cols[colQty] ?? "");
    const price = colPrice >= 0 ? parseRevNum(cols[colPrice] ?? "") : 0;
    if (qty <= 0) continue;

    const ex = map.get(ticker) ?? { qty: 0, totalCost: 0, totalBought: 0 };

    // Revolut types: "BUY - MARKET", "BUY - LIMIT", "SELL - MARKET", etc.
    if (type.startsWith("BUY")) {
      ex.qty        += qty;
      ex.totalCost  += qty * price;
      ex.totalBought += qty;
    } else if (type.startsWith("SELL")) {
      ex.qty -= qty;
    }
    // CASH TOP-UP, CASH WITHDRAWAL, DIVIDEND, STOCK_SPLIT etc. — ignore

    map.set(ticker, ex);
  }

  const results: ParsedStock[] = [];
  for (const [ticker, data] of map.entries()) {
    if (data.qty <= 0.00001) continue;
    const avgPrice = data.totalBought > 0 ? data.totalCost / data.totalBought : null;
    results.push({ ticker, name: null, quantity: data.qty, avg_price: avgPrice && avgPrice > 0 ? avgPrice : null });
  }

  return results.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Handles values like "EUR 305.45", "305.45", "1,234.56"
function parseRevNum(s: string): number {
  if (!s) return 0;
  // Strip currency prefix like "EUR ", "USD ", "GBP " etc.
  const cleaned = s.replace(/^[A-Z]{3}\s+/, "").replace(/[^\d.-]/g, "");
  return parseFloat(cleaned) || 0;
}
