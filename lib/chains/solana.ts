/**
 * Fetches wallet token balances on Solana via Helius DAS API.
 * Returns SPL fungible tokens + native SOL.
 */

import type { RawTokenBalance } from "../types";
import { getJupiterPrices } from "../prices";

function getHeliusKey(): string {
  const val = process.env.HELIUS_API_KEY ?? "";
  // Support full URL format: https://mainnet.helius-rpc.com/?api-key=KEY
  const match = val.match(/api-key=([a-f0-9-]{36})/);
  return match ? match[1] : val;
}

const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${getHeliusKey()}`;
const HELIUS_RPC = HELIUS_URL;
const HELIUS_DAS = HELIUS_URL;

// Known stablecoin/token mints to handle price fallbacks
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function fetchSolanaBalances(
  walletAddress: string
): Promise<RawTokenBalance[]> {
  const [tokens, solBalance] = await Promise.all([
    fetchFungibleTokens(walletAddress),
    fetchNativeSol(walletAddress),
  ]);

  const allTokens = [...tokens];

  // Add native SOL if balance > 0
  if (solBalance > 0) {
    allTokens.push({
      token_symbol: "SOL",
      token_name: "Solana",
      token_address: SOL_MINT,
      chain: "solana",
      amount: solBalance,
      price_usd: null,
      value_usd: 0,
    });
  }

  // Resolve prices for all tokens via Jupiter
  const mints = allTokens
    .filter((t) => t.token_address)
    .map((t) => t.token_address!);

  const prices = await getJupiterPrices([...new Set(mints)]);

  // Apply prices
  for (const token of allTokens) {
    if (!token.price_usd && token.token_address) {
      const price = prices.get(token.token_address);
      if (price !== undefined) {
        token.price_usd = price;
        token.value_usd = token.amount * price;
      }
    }
  }

  // Filter out dust (< $0.01 value and unknown price)
  return allTokens.filter(
    (t) => t.value_usd > 0.01 || t.price_usd === null
  );
}

async function fetchNativeSol(address: string): Promise<number> {
  try {
    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json();
    const lamports = json?.result?.value ?? 0;
    return lamports / 1e9;
  } catch {
    return 0;
  }
}

async function fetchFungibleTokens(
  address: string
): Promise<RawTokenBalance[]> {
  const tokens: RawTokenBalance[] = [];
  let page = 1;

  while (true) {
    try {
      const res = await fetch(HELIUS_DAS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "get-assets",
          method: "getAssetsByOwner",
          params: {
            ownerAddress: address,
            page,
            limit: 1000,
            displayOptions: {
              showFungible: true,
              showNativeBalance: false,
              showZeroBalance: false,
            },
          },
        }),
      });

      const json = await res.json();
      const items = json?.result?.items ?? [];

      if (items.length === 0) break;

      for (const asset of items) {
        // Only fungible tokens with balance
        if (asset.interface !== "FungibleToken" && asset.interface !== "FungibleAsset") continue;
        const tokenInfo = asset.token_info;
        if (!tokenInfo) continue;

        const amount =
          (tokenInfo.balance ?? 0) /
          Math.pow(10, tokenInfo.decimals ?? 0);

        if (amount <= 0) continue;

        const priceInfo = tokenInfo.price_info;
        const priceUsd = priceInfo?.price_per_token ?? null;
        const valueUsd = priceInfo?.total_price ?? (priceUsd ? amount * priceUsd : 0);

        tokens.push({
          token_symbol: tokenInfo.symbol ?? asset.content?.metadata?.symbol ?? "UNKNOWN",
          token_name: asset.content?.metadata?.name ?? tokenInfo.symbol,
          token_address: asset.id,
          chain: "solana",
          amount,
          price_usd: priceUsd,
          value_usd: valueUsd,
        });
      }

      if (items.length < 1000) break;
      page++;
    } catch {
      break;
    }
  }

  return tokens;
}
