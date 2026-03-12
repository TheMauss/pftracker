/**
 * Fetches Sui wallet token balances.
 * Uses Sui JSON-RPC:
 *   suix_getAllBalances → list of coin balances
 *   suix_getCoinMetadata (batched) → symbol, decimals per coin type
 * Prices via CoinGecko (platform=sui).
 */

import type { RawTokenBalance } from "../types";
import { getSuiPrices } from "../prices";

const SUI_RPC = "https://fullnode.mainnet.sui.io";
const SUI_COIN_TYPE = "0x2::sui::SUI";

interface SuiBalance {
  coinType:        string;
  coinObjectCount: number;
  totalBalance:    string;
  lockedBalance:   Record<string, string>;
}

interface CoinMetadata {
  decimals: number;
  name:     string;
  symbol:   string;
}

async function suiRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sui RPC ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

async function batchCoinMetadata(
  coinTypes: string[]
): Promise<Map<string, CoinMetadata>> {
  const result = new Map<string, CoinMetadata>();
  if (coinTypes.length === 0) return result;

  // Sui JSON-RPC supports batch requests (array)
  const batchBody = coinTypes.map((ct, i) => ({
    jsonrpc: "2.0",
    id:      i,
    method:  "suix_getCoinMetadata",
    params:  [ct],
  }));

  try {
    const res = await fetch(SUI_RPC, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(batchBody),
      signal:  AbortSignal.timeout(20_000),
    });
    if (!res.ok) return result;
    const responses = (await res.json()) as Array<{
      id:     number;
      result?: CoinMetadata | null;
      error?: unknown;
    }>;
    for (const r of responses) {
      if (r.result && typeof r.result.decimals === "number") {
        result.set(coinTypes[r.id], r.result);
      }
    }
  } catch { /* ignore batch errors, fall back to symbol from coin type */ }

  return result;
}

/** Extract a human-readable symbol from a Sui coin type path. */
function symbolFromCoinType(coinType: string): string {
  const parts = coinType.split("::");
  return parts[parts.length - 1] ?? coinType.slice(0, 8);
}

export async function fetchSuiBalances(
  walletAddress: string
): Promise<RawTokenBalance[]> {
  const tokens: RawTokenBalance[] = [];

  // 1. Get all coin balances
  const balances = await suiRpc<SuiBalance[]>("suix_getAllBalances", [walletAddress]);
  if (!balances?.length) return tokens;

  // Filter out zero/dust balances (we'll price-check later)
  const nonZero = balances.filter(b => BigInt(b.totalBalance) > 0n);
  if (nonZero.length === 0) return tokens;

  // 2. Batch fetch coin metadata (symbol + decimals)
  const coinTypes    = nonZero.map(b => b.coinType);
  const metadataMap  = await batchCoinMetadata(coinTypes);

  // 3. Fetch prices for all coin types
  const prices = await getSuiPrices(coinTypes);

  // 4. Assemble token balances
  for (const bal of nonZero) {
    const meta       = metadataMap.get(bal.coinType);
    const decimals   = meta?.decimals ?? (bal.coinType === SUI_COIN_TYPE ? 9 : 6);
    const symbol     = meta?.symbol ?? symbolFromCoinType(bal.coinType);
    const amount     = Number(BigInt(bal.totalBalance)) / 10 ** decimals;
    const priceUsd   = prices.get(bal.coinType) ?? null;
    const valueUsd   = priceUsd ? amount * priceUsd : 0;

    // Skip dust (value < $0.01 with known price)
    if (priceUsd !== null && valueUsd < 0.01) continue;

    tokens.push({
      token_symbol:  symbol,
      token_name:    meta?.name ?? symbol,
      token_address: bal.coinType,
      chain:         "sui",
      amount,
      price_usd:     priceUsd,
      value_usd:     valueUsd,
    });
  }

  return tokens;
}
