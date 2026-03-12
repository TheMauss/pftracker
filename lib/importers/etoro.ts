import * as XLSX from "xlsx";

export interface ParsedStock {
  ticker: string;
  name: string | null;
  quantity: number;
  avg_price: number | null;
}

/**
 * Parse eToro Account Statement XLSX.
 *
 * Uses "Aktivita na účtu" sheet and computes NET units per ticker:
 *   net = sum("Otevřená pozice" units) − sum("Zisk/ztráta z obchodu" units)
 *
 * This is more robust than position-ID matching because eToro sometimes
 * logs simultaneous opens as one combined row with a single position ID.
 *
 * Small discrepancies (~1%) can occur for positions opened before the
 * report date range — re-export with full account history to minimise this.
 */
export function parseEtoroXLSX(buffer: ArrayBuffer): ParsedStock[] {
  const wb = XLSX.read(buffer, { type: "array" });

  const activitySheet = findSheet(wb, ["Aktivita na účtu", "Account Activity", "Activity"]);
  if (!activitySheet) {
    throw new Error(
      "Nelze najít sheet s aktivitou účtu. Ověř, že nahráváš Account Statement z eToro."
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(activitySheet, { header: 1 }) as unknown[][];
  const headers = (rows[0] as string[]).map((h) => String(h ?? "").toLowerCase().trim());

  // Column detection (Czech + English)
  const colType    = findColIdx(headers, ["napište", "type"]);
  const colDetails = findColIdx(headers, ["podrobnosti", "details"]);
  const colAmount  = findColIdx(headers, ["částka", "amount"]);
  const colUnits   = findColIdx(headers, ["jednotky", "units"]);

  if (colType === -1 || colDetails === -1 || colUnits === -1) {
    throw new Error(
      "Sheet 'Aktivita na účtu' neobsahuje očekávané sloupce (Napište / Podrobnosti / Jednotky)."
    );
  }

  // Aggregate per ticker: net units = opens − closes
  const map = new Map<string, { opens: number; closes: number; totalCost: number }>();

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i] as unknown[];
    const type    = String(row[colType]    ?? "").trim();
    const details = String(row[colDetails] ?? "").trim();
    const units   = parseNum(String(row[colUnits]  ?? ""));
    const amount  = parseNum(String(row[colAmount] ?? ""));

    const ticker = extractTicker(details);
    if (!ticker || units <= 0) continue;

    const ex = map.get(ticker) ?? { opens: 0, closes: 0, totalCost: 0 };

    if (type === "Otevřená pozice" || type === "Open Position") {
      ex.opens     += units;
      ex.totalCost += amount;
    } else if (
      type === "Zisk/ztráta z obchodu" ||
      type === "Trade Profit/Loss" ||
      type === "Position closed"
    ) {
      ex.closes += units;
    }

    map.set(ticker, ex);
  }

  const results: ParsedStock[] = [];
  for (const [ticker, d] of map.entries()) {
    const net = d.opens - d.closes;
    if (net < 0.0001) continue;
    const avgPrice = d.opens > 0 && d.totalCost > 0 ? d.totalCost / d.opens : null;
    results.push({ ticker, name: null, quantity: net, avg_price: avgPrice });
  }

  if (results.length === 0) {
    throw new Error("Žádné otevřené pozice nalezeny. Ověř, že soubor obsahuje transakční historii.");
  }

  return results.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findSheet(wb: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | null {
  for (const name of names) {
    if (wb.Sheets[name]) return wb.Sheets[name];
  }
  return null;
}

function findColIdx(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

// "TLT/USD" → "TLT", "AAPL/USD Buy" → "AAPL"
function extractTicker(details: string): string | null {
  const match = details.match(/^([A-Z0-9.]+)\/[A-Z]{3}/);
  if (match) return match[1];
  return null;
}

function parseNum(s: string): number {
  if (!s || s === "-") return 0;
  return parseFloat(s.replace(/[^\d.-]/g, "")) || 0;
}
