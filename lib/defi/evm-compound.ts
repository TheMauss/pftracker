/**
 * Fetches Compound V3 (Comet) positions on Ethereum, Base, and Arbitrum.
 * Each Comet market has one base token (USDC, WETH, USDT) that users can supply/borrow.
 * Uses viem multicall — 2 HTTP requests per chain.
 */

import type { RawDefiPosition, ChainId } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

interface CompoundMarket {
  address: `0x${string}`;
  baseSymbol: string;
  baseDecimals: number;
}

const MARKETS: Record<string, CompoundMarket[]> = {
  ethereum: [
    { address: "0xc3d688B66703497DAA19211EEdff47f25384cdc3", baseSymbol: "USDC",  baseDecimals: 6  },
    { address: "0xA17581A9E3356d9a858b789D68B4d866e593aE94", baseSymbol: "WETH",  baseDecimals: 18 },
    { address: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840", baseSymbol: "USDT",  baseDecimals: 6  },
  ],
  base: [
    { address: "0xb125E6687d4313864e53df431d5425969c15Eb2F", baseSymbol: "USDC",  baseDecimals: 6  },
    { address: "0x46e6b214b524310239732D51387075E0e70970bf", baseSymbol: "WETH",  baseDecimals: 18 },
  ],
  arbitrum: [
    { address: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", baseSymbol: "USDC.e", baseDecimals: 6  },
    { address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", baseSymbol: "USDC",   baseDecimals: 6  },
    { address: "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486", baseSymbol: "WETH",   baseDecimals: 18 },
    { address: "0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07", baseSymbol: "USDT",   baseDecimals: 6  },
  ],
};

const COMET_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function borrowBalanceOf(address account) external view returns (uint256)",
  "function baseTokenPriceFeed() external view returns (address)",
  "function getUtilization() external view returns (uint256)",
  "function getPrice(address priceFeed) external view returns (uint128)",
  "function getSupplyRate(uint256 utilization) external view returns (uint64)",
  "function getBorrowRate(uint256 utilization) external view returns (uint64)",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAINS: Record<string, any> = { ethereum: mainnet, base, arbitrum };

function alchemyRpc(chain: string): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  const prefix: Record<string, string> = {
    ethereum: "eth-mainnet",
    base:     "base-mainnet",
    arbitrum: "arb-mainnet",
  };
  return `https://${prefix[chain]}.g.alchemy.com/v2/${key}`;
}

function rateToApy(rate: bigint): number {
  const ratePerSecond = Number(rate) / 1e18;
  return (Math.pow(1 + ratePerSecond, 31_536_000) - 1) * 100;
}

export async function fetchCompoundPositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const markets = MARKETS[chain];
  if (!markets?.length) return [];
  const viemChain = CHAINS[chain];
  if (!viemChain) return [];

  const user   = walletAddress as `0x${string}`;
  const ZERO   = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain:     viemChain,
    transport: http(alchemyRpc(chain)),
  });

  try {
    type MC = { status: "success" | "failure"; result?: unknown };

    // Round 1: balances + price feeds + utilizations
    const r1 = (await client.multicall({
      contracts: [
        ...markets.map(m => ({ address: m.address, abi: COMET_ABI, functionName: "balanceOf"          as const, args: [user] })),
        ...markets.map(m => ({ address: m.address, abi: COMET_ABI, functionName: "borrowBalanceOf"    as const, args: [user] })),
        ...markets.map(m => ({ address: m.address, abi: COMET_ABI, functionName: "baseTokenPriceFeed" as const })),
        ...markets.map(m => ({ address: m.address, abi: COMET_ABI, functionName: "getUtilization"     as const })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n         = markets.length;
    const supplyR   = r1.slice(0,     n);
    const borrowR   = r1.slice(n,   2*n);
    const feedR     = r1.slice(2*n, 3*n);
    const utilR     = r1.slice(3*n, 4*n);

    const feeds = feedR.map(e => (e?.status === "success" ? (e.result as `0x${string}`) : null) ?? ZERO);
    const utils = utilR.map(e => (e?.status === "success" ? (e.result as bigint) : 0n));

    // Round 2: prices + supply/borrow rates
    const r2 = (await client.multicall({
      contracts: [
        ...markets.map((m, i) => ({ address: m.address, abi: COMET_ABI, functionName: "getPrice"      as const, args: [feeds[i]] })),
        ...markets.map((m, i) => ({ address: m.address, abi: COMET_ABI, functionName: "getSupplyRate" as const, args: [utils[i]] })),
        ...markets.map((m, i) => ({ address: m.address, abi: COMET_ABI, functionName: "getBorrowRate" as const, args: [utils[i]] })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const pricesR  = r2.slice(0,     n);
    const supRateR = r2.slice(n,   2*n);
    const borRateR = r2.slice(2*n, 3*n);

    for (let i = 0; i < n; i++) {
      const supRaw = supplyR[i]?.status === "success" ? (supplyR[i].result as bigint) : 0n;
      const borRaw = borrowR[i]?.status === "success" ? (borrowR[i].result as bigint) : 0n;
      if (supRaw === 0n && borRaw === 0n) continue;

      const m        = markets[i];
      const divisor  = 10n ** BigInt(m.baseDecimals);
      const priceRaw = pricesR[i]?.status  === "success" ? (pricesR[i].result  as bigint) : 0n;
      const supRate  = supRateR[i]?.status === "success" ? (supRateR[i].result as bigint) : 0n;
      const borRate  = borRateR[i]?.status === "success" ? (borRateR[i].result as bigint) : 0n;
      // Compound V3 getPrice → 1e8 USD
      const priceUsd = priceRaw > 0n ? Number(priceRaw) / 1e8 : null;
      const supApy   = rateToApy(supRate);
      const borApy   = rateToApy(borRate);

      if (supRaw > 0n) {
        const amount   = Number(supRaw) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "compound",
            chain,
            position_type: "lend",
            asset_symbol:  m.baseSymbol,
            asset_address: m.address,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       false,
            apy:           supApy,
          });
        }
      }

      if (borRaw > 0n) {
        const amount   = Number(borRaw) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "compound",
            chain,
            position_type: "borrow",
            asset_symbol:  m.baseSymbol,
            asset_address: m.address,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       true,
            apy:           -borApy,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Compound V3 fetch error (${chain}):`, err);
  }

  return positions;
}
