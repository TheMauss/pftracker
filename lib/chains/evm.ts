/**
 * Fetches EVM wallet token balances via Alchemy API.
 * Covers: Ethereum, Base, Arbitrum, BNB Chain.
 * HyperEVM native balance fetched via viem.
 */

import type { RawTokenBalance, ChainId } from "../types";
import { createPublicClient, http, formatEther } from "viem";
import { getCoinGeckoPrices } from "../prices";

// BSC not supported by Alchemy - excluded
const ALCHEMY_CHAIN: Record<string, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  arbitrum: "arb-mainnet",
};

const NATIVE: Record<string, { symbol: string; name: string; address: string }> = {
  ethereum: { symbol: "ETH", name: "Ether", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  base: { symbol: "ETH", name: "Ether", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  arbitrum: { symbol: "ETH", name: "Ether", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  bsc: { symbol: "BNB", name: "BNB", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
};

function alchemyUrl(chain: string): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://${ALCHEMY_CHAIN[chain]}.g.alchemy.com/v2/${key}`;
}

async function alchemyCall(chain: string, method: string, params: unknown[]) {
  const res = await fetch(alchemyUrl(chain), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Alchemy ${chain}/${method}: ${res.status}`);
  return res.json();
}

const hyperEvmChain = {
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } },
} as const;

async function fetchHyperEvmBalances(walletAddress: string): Promise<RawTokenBalance[]> {
  try {
    const client = createPublicClient({
      chain: hyperEvmChain,
      transport: http("https://rpc.hyperliquid.xyz/evm"),
    });
    const balance = await Promise.race([
      client.getBalance({ address: walletAddress as `0x${string}` }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 10_000)),
    ]);
    const amount = parseFloat(formatEther(balance));
    if (amount <= 0.001) return [];

    // Fetch HYPE price from Hyperliquid spot
    let hypePrice: number | null = null;
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      });
      if (res.ok) {
        const [meta, ctxs] = await res.json() as [
          { universe: Array<{ tokens: number[]; name: string }>; tokens: Array<{ name: string; index: number }> },
          Array<{ markPx: string }>
        ];
        for (let i = 0; i < meta.universe.length; i++) {
          if (meta.universe[i].name === "HYPE/USDC" && ctxs[i]?.markPx) {
            hypePrice = parseFloat(ctxs[i].markPx);
            break;
          }
        }
      }
    } catch {}

    return [{
      token_symbol: "HYPE",
      token_name: "Hyperliquid",
      token_address: "native",
      chain: "hyperevm",
      amount,
      price_usd: hypePrice,
      value_usd: hypePrice ? amount * hypePrice : 0,
    }];
  } catch {
    return [];
  }
}

export async function fetchEvmBalances(
  walletAddress: string,
  chain: ChainId
): Promise<RawTokenBalance[]> {
  if (chain === "hyperevm") return fetchHyperEvmBalances(walletAddress);
  if (!ALCHEMY_CHAIN[chain]) return [];

  try {
    // 1. ERC20 balances (1 call) + native balance (1 call) in parallel
    const [balJson, nativeHex] = await Promise.all([
      alchemyCall(chain, "alchemy_getTokenBalances", [walletAddress, "erc20"]),
      alchemyCall(chain, "eth_getBalance", [walletAddress, "latest"]),
    ]);

    const rawBalances: { contractAddress: string; tokenBalance: string }[] =
      (balJson?.result?.tokenBalances ?? []).filter(
        (t: { tokenBalance: string }) =>
          t.tokenBalance && t.tokenBalance !== "0x0000000000000000000000000000000000000000000000000000000000000000"
      );

    const nativeAmount = parseFloat(formatEther(BigInt(nativeHex?.result ?? "0x0")));

    // 2. Metadata for all tokens in ONE JSON-RPC batch HTTP request
    const metaMap = new Map<string, { symbol: string; name: string; decimals: number }>();
    if (rawBalances.length > 0) {
      const batchBody = rawBalances.map((t, i) => ({
        jsonrpc: "2.0",
        method: "alchemy_getTokenMetadata",
        params: [t.contractAddress],
        id: i,
      }));
      const res = await fetch(alchemyUrl(chain), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchBody),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const batchResults = await res.json() as Array<{ id: number; result?: { symbol: string; name: string; decimals: number } }>;
        for (const r of batchResults) {
          if (r.result) metaMap.set(rawBalances[r.id].contractAddress.toLowerCase(), r.result);
        }
      }
    }

    // 3. Prices via CoinGecko (one batch)
    const contractAddrs = rawBalances.map((t) => t.contractAddress);
    const nativeToken = NATIVE[chain];
    if (nativeAmount > 0.0001) contractAddrs.push(nativeToken.address);
    const prices = await getCoinGeckoPrices(contractAddrs, chain);

    const tokens: RawTokenBalance[] = [];

    // Native token
    if (nativeAmount > 0.0001) {
      const priceUsd = prices.get(nativeToken.address) ?? null;
      tokens.push({
        token_symbol: nativeToken.symbol,
        token_name: nativeToken.name,
        token_address: "native",
        chain,
        amount: nativeAmount,
        price_usd: priceUsd,
        value_usd: priceUsd ? nativeAmount * priceUsd : 0,
      });
    }

    // ERC20 tokens
    for (const raw of rawBalances) {
      const meta = metaMap.get(raw.contractAddress.toLowerCase());
      if (!meta) continue;

      const decimals = meta.decimals ?? 18;
      const amount = Number(BigInt(raw.tokenBalance)) / Math.pow(10, decimals);
      if (amount <= 0) continue;

      const priceUsd = prices.get(raw.contractAddress.toLowerCase()) ?? null;
      const valueUsd = priceUsd ? amount * priceUsd : 0;

      if (valueUsd < 0.01 && priceUsd !== null) continue;

      tokens.push({
        token_symbol: meta.symbol ?? "UNKNOWN",
        token_name: meta.name ?? null,
        token_address: raw.contractAddress,
        chain,
        amount,
        price_usd: priceUsd,
        value_usd: valueUsd,
      });
    }

    return tokens;
  } catch (err) {
    console.error(`Failed to fetch EVM balances for ${chain}/${walletAddress}:`, err);
    return [];
  }
}
