/**
 * Price resolution waterfall:
 * 1. Jupiter Price API (Solana tokens by mint address)
 * 2. CoinGecko by contract address (multi-chain)
 * 3. Returns null (unknown price)
 */

const JUPITER_PRICE_URL = "https://api.jup.ag/price/v2";
const COINGECKO_URL = "https://api.coingecko.com/api/v3";

// Cache prices in-memory per snapshot run to avoid redundant API calls
let priceCache: Map<string, number> = new Map();

export function clearPriceCache() {
  priceCache = new Map();
}

/**
 * Fetch prices for multiple Solana token mint addresses via Jupiter.
 * Returns a map of mint -> USD price.
 */
export async function getJupiterPrices(
  mints: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (mints.length === 0) return result;

  // Batch into groups of 100
  const batches: string[][] = [];
  for (let i = 0; i < mints.length; i += 100) {
    batches.push(mints.slice(i, i + 100));
  }

  for (const batch of batches) {
    try {
      const ids = batch.join(",");
      const res = await fetch(`${JUPITER_PRICE_URL}?ids=${ids}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json.data as Record<
        string,
        { price: string; id: string } | null
      >;
      for (const [mint, info] of Object.entries(data)) {
        if (info?.price) {
          const price = parseFloat(info.price);
          if (!isNaN(price) && price > 0) {
            result.set(mint, price);
            priceCache.set(`sol:${mint}`, price);
          }
        }
      }
    } catch {
      // silently continue — Jupiter unavailable
    }
  }

  return result;
}

/**
 * Fetch prices for EVM tokens via CoinGecko by contract address.
 * chainId: "ethereum", "base", "arbitrum", "bsc"
 */
export async function getCoinGeckoPrices(
  contractAddresses: string[],
  chainId: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (contractAddresses.length === 0) return result;

  const platformMap: Record<string, string> = {
    ethereum: "ethereum",
    base: "base",
    arbitrum: "arbitrum-one",
    bsc: "binance-smart-chain",
    solana: "solana",
  };
  const platform = platformMap[chainId];
  if (!platform) return result;

  // Batch into groups of 50
  const batches: string[][] = [];
  for (let i = 0; i < contractAddresses.length; i += 50) {
    batches.push(contractAddresses.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const addrs = batch.map((a) => a.toLowerCase()).join(",");
      const url = `${COINGECKO_URL}/simple/token_price/${platform}?contract_addresses=${addrs}&vs_currencies=usd`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 120 },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, { usd?: number }>;
      for (const [addr, info] of Object.entries(data)) {
        if (info?.usd && info.usd > 0) {
          result.set(addr.toLowerCase(), info.usd);
          priceCache.set(`${chainId}:${addr.toLowerCase()}`, info.usd);
        }
      }
    } catch {
      // silently continue
    }
    // Respect CoinGecko free-tier rate limit
    await sleep(300);
  }

  return result;
}

/**
 * Get a single token price — checks cache first.
 */
export async function resolvePrice(
  address: string,
  chain: string
): Promise<number | null> {
  const cacheKey = `${chain}:${address.toLowerCase()}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;

  if (chain === "solana") {
    const prices = await getJupiterPrices([address]);
    return prices.get(address) ?? null;
  } else {
    const prices = await getCoinGeckoPrices([address], chain);
    return prices.get(address.toLowerCase()) ?? null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
