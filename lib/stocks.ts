export interface StockQuote {
  ticker: string;
  price: number | null;       // always in USD
  currency: string;           // original currency
  name: string | null;
}

const BASE = "https://query2.finance.yahoo.com/v8/finance/chart";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const SUFFIXES = [".DE", ".L", ".AS", ".PA", ".MI", ".SW", ".VI", ".ST", ".F"];

// FX pairs to fetch (against USD)
const FX_PAIRS: Record<string, string> = {
  EUR: "EURUSD=X",
  GBP: "GBPUSD=X",
  GBp: "GBPUSD=X", // pence — divide by 100 later
  CHF: "CHFUSD=X",
  SEK: "SEKUSD=X",
  NOK: "NOKUSD=X",
};

async function fetchOne(symbol: string): Promise<{ price: number; currency: string; name: string | null } | null> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
    if (price == null) return null;
    return { price, currency: meta.currency ?? "USD", name: meta.shortName ?? meta.longName ?? null };
  } catch {
    return null;
  }
}

async function fetchFxRates(currencies: Set<string>): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const needed = [...currencies].filter((c) => c !== "USD" && FX_PAIRS[c]);
  if (!needed.length) return rates;

  await Promise.allSettled(
    needed.map(async (currency) => {
      const pair = FX_PAIRS[currency];
      const q = await fetchOne(pair);
      if (q?.price) {
        const rate = currency === "GBp" ? q.price / 100 : q.price;
        rates.set(currency, rate);
      }
    })
  );
  return rates;
}

export async function fetchStockPrices(tickers: string[]): Promise<Map<string, StockQuote>> {
  const result = new Map<string, StockQuote>();
  if (!tickers.length) return result;

  // Step 1: fetch all tickers in parallel
  await Promise.allSettled(
    tickers.map(async (ticker) => {
      const q = await fetchOne(ticker);
      if (q) result.set(ticker, { ticker, ...q });
    })
  );

  // Step 2: for any not found, try exchange suffixes in parallel — take first hit
  const missing = tickers.filter((t) => !result.has(t));
  await Promise.allSettled(
    missing.map(async (ticker) => {
      const attempts = await Promise.all(SUFFIXES.map((s) => fetchOne(ticker + s).then((q) => ({ s, q }))));
      const hit = attempts.find((a) => a.q != null);
      if (hit?.q) result.set(ticker, { ticker, ...hit.q });
    })
  );

  // Step 3: convert non-USD prices to USD
  const foreignCurrencies = new Set(
    [...result.values()].map((q) => q.currency).filter((c) => c !== "USD")
  );
  if (foreignCurrencies.size > 0) {
    const fxRates = await fetchFxRates(foreignCurrencies);
    for (const [ticker, quote] of result.entries()) {
      if (quote.currency === "USD") continue;
      const rate = fxRates.get(quote.currency);
      if (rate && quote.price != null) {
        result.set(ticker, { ...quote, price: quote.price * rate });
      }
    }
  }

  return result;
}
