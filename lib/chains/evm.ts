/**
 * Fetches EVM wallet token balances via Covalent multi-chain API.
 * Covers: Ethereum, Base, Arbitrum, BNB Chain.
 * HyperEVM native balance fetched via viem.
 */

import type { RawTokenBalance, ChainId } from "../types";
import { createPublicClient, http, formatEther } from "viem";

const COVALENT_BASE = "https://api.covalenthq.com/v1";

const CHAIN_MAP: Record<string, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  arbitrum: "arbitrum-mainnet",
  bsc: "bsc-mainnet",
};

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

  const covalentChain = CHAIN_MAP[chain];
  if (!covalentChain) return [];

  const apiKey = process.env.COVALENT_API_KEY ?? "";

  try {
    const url = `${COVALENT_BASE}/${covalentChain}/address/${walletAddress}/balances_v2/?key=${apiKey}&no-spam=true&no-nft-fetch=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error(`Covalent error for ${chain}/${walletAddress}: ${res.status}`);
      return [];
    }

    const json = await res.json();
    const items: CovalentItem[] = json?.data?.items ?? [];

    const tokens: RawTokenBalance[] = [];

    for (const item of items) {
      // Skip NFTs and zero balances
      if (item.type === "nft") continue;
      if (!item.balance || item.balance === "0") continue;

      const decimals = item.contract_decimals ?? 18;
      const amount = Number(BigInt(item.balance)) / Math.pow(10, decimals);
      if (amount <= 0) continue;

      const priceUsd =
        item.quote_rate && item.quote_rate > 0 ? item.quote_rate : null;
      const valueUsd =
        item.quote && item.quote > 0
          ? item.quote
          : priceUsd
          ? amount * priceUsd
          : 0;

      // Filter dust
      if (valueUsd < 0.01 && priceUsd !== null) continue;

      tokens.push({
        token_symbol: item.contract_ticker_symbol ?? "UNKNOWN",
        token_name: item.contract_name ?? null,
        token_address: item.contract_address ?? null,
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

interface CovalentItem {
  contract_decimals: number;
  contract_name: string;
  contract_ticker_symbol: string;
  contract_address: string;
  balance: string;
  quote_rate: number | null;
  quote: number | null;
  type: string;
}
