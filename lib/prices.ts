/**
 * Price resolution:
 * 1. Jupiter Price API   — Solana tokens (by mint address)
 * 2. DeFiLlama coins API — EVM tokens (ethereum/base/arbitrum/bsc) — free, no key, no rate limit
 * 3. CoinGecko           — Sui tokens only (DeFiLlama Sui support is limited)
 */

const JUPITER_PRICE_URL = "https://api.jup.ag/price/v2";
const DEFILLAMA_URL     = "https://coins.llama.fi";
const COINGECKO_URL     = "https://api.coingecko.com/api/v3";

// Cache prices in-memory per snapshot run to avoid redundant API calls
let priceCache: Map<string, number> = new Map();

export function clearPriceCache() {
  priceCache = new Map();
}

// ─── Solana ───────────────────────────────────────────────────────────────────

/**
 * Fetch prices for Solana token mint addresses via Jupiter.
 * Returns map of mint → USD price.
 */
export async function getJupiterPrices(
  mints: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (mints.length === 0) return result;

  const batches: string[][] = [];
  for (let i = 0; i < mints.length; i += 100) batches.push(mints.slice(i, i + 100));

  for (const batch of batches) {
    try {
      const res = await fetch(`${JUPITER_PRICE_URL}?ids=${batch.join(",")}`, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json.data as Record<string, { price: string } | null>;
      for (const [mint, info] of Object.entries(data)) {
        if (info?.price) {
          const price = parseFloat(info.price);
          if (!isNaN(price) && price > 0) {
            result.set(mint, price);
            priceCache.set(`sol:${mint}`, price);
          }
        }
      }
    } catch { /* Jupiter unavailable */ }
  }

  return result;
}

// ─── EVM (DeFiLlama) ─────────────────────────────────────────────────────────

// DeFiLlama chain slug mapping
const LLAMA_CHAIN: Record<string, string> = {
  ethereum: "ethereum",
  base:     "base",
  arbitrum: "arbitrum",
  bsc:      "bsc",
};

/**
 * Fetch prices for EVM tokens via DeFiLlama coins API.
 * Free, no API key, no rate limits. Supports all major EVM chains.
 * Returns map of lowercase contract address → USD price.
 */
export async function getCoinGeckoPrices(
  contractAddresses: string[],
  chainId: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (contractAddresses.length === 0) return result;

  const llamaChain = LLAMA_CHAIN[chainId];
  if (!llamaChain) return result;

  // Check cache first
  const uncached: string[] = [];
  for (const addr of contractAddresses) {
    const key = `${chainId}:${addr.toLowerCase()}`;
    if (priceCache.has(key)) {
      result.set(addr.toLowerCase(), priceCache.get(key)!);
    } else {
      uncached.push(addr);
    }
  }
  if (uncached.length === 0) return result;

  // DeFiLlama accepts up to ~150 coins per request
  const batches: string[][] = [];
  for (let i = 0; i < uncached.length; i += 100) batches.push(uncached.slice(i, i + 100));

  for (const batch of batches) {
    try {
      const coins = batch.map(a => `${llamaChain}:${a.toLowerCase()}`).join(",");
      const res = await fetch(`${DEFILLAMA_URL}/prices/current/${coins}`, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`DeFiLlama ${chainId} ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { coins?: Record<string, { price?: number }> };
      for (const [key, info] of Object.entries(data.coins ?? {})) {
        if (info?.price && info.price > 0) {
          // key format: "ethereum:0x1234..."
          const addr = key.split(":").slice(1).join(":").toLowerCase();
          result.set(addr, info.price);
          priceCache.set(`${chainId}:${addr}`, info.price);
        }
      }
    } catch (err) {
      console.warn(`DeFiLlama price fetch error (${chainId}):`, err);
    }
  }

  return result;
}

// ─── Single price resolve ─────────────────────────────────────────────────────

export async function resolvePrice(
  address: string,
  chain: string
): Promise<number | null> {
  const cacheKey = `${chain}:${address.toLowerCase()}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;

  if (chain === "solana") {
    const prices = await getJupiterPrices([address]);
    return prices.get(address) ?? null;
  }
  const prices = await getCoinGeckoPrices([address], chain);
  return prices.get(address.toLowerCase()) ?? null;
}

// ─── Sui (CoinGecko) ─────────────────────────────────────────────────────────

/**
 * Fetch prices for Sui coin types.
 * Native SUI via CoinGecko simple/price; other tokens via token_price/sui.
 */
export async function getSuiPrices(
  coinTypes: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (coinTypes.length === 0) return result;

  const SUI_COIN_TYPE = "0x2::sui::SUI";

  // 1. Native SUI
  if (coinTypes.includes(SUI_COIN_TYPE)) {
    try {
      const res = await fetch(`${COINGECKO_URL}/simple/price?ids=sui&vs_currencies=usd`, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { sui?: { usd?: number } };
        if (data.sui?.usd) {
          result.set(SUI_COIN_TYPE, data.sui.usd);
          priceCache.set(`sui:${SUI_COIN_TYPE}`, data.sui.usd);
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Other Sui tokens — CoinGecko uses package address as contract_address
  const nonSui = coinTypes.filter(t => t !== SUI_COIN_TYPE);
  if (nonSui.length > 0) {
    const pkgMap = new Map<string, string>(); // packageAddr → coinType
    for (const ct of nonSui) {
      const pkg = ct.split("::")[0]?.toLowerCase();
      if (pkg) pkgMap.set(pkg, ct);
    }
    try {
      const addrs = [...pkgMap.keys()].join(",");
      const url = `${COINGECKO_URL}/simple/token_price/sui?contract_addresses=${addrs}&vs_currencies=usd`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, { usd?: number }>;
        for (const [pkg, info] of Object.entries(data)) {
          if (info?.usd && info.usd > 0) {
            const coinType = pkgMap.get(pkg.toLowerCase());
            if (coinType) {
              result.set(coinType, info.usd);
              priceCache.set(`sui:${coinType}`, info.usd);
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  return result;
}
