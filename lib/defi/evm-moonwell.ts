/**
 * Fetches Moonwell Protocol positions on Base.
 * Moonwell is a Compound V2 fork — the largest lending protocol on Base.
 * Uses viem multicall + Alchemy RPC (Base).
 *
 * Flow (same pattern as Venus):
 *  1. Comptroller.getAssetsIn(user) → list of mToken markets entered
 *  2. multicall: balanceOf + borrowBalanceStored + exchangeRateStored + underlying + rates
 *  3. Prices via CoinGecko (underlying token addresses, Base chain)
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi, defineChain } from "viem";
import { base } from "viem/chains";
import { getCoinGeckoPrices } from "../prices";

// Moonwell Artemis on Base — Unitroller (Comptroller proxy)
const COMPTROLLER = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C" as const;

// Sentinel for native ETH market (no underlying() call)
const ETH_SENTINEL = "0x0000000000000000000000000000000000000000" as const;
// WETH on Base for CoinGecko price lookup
const WETH_BASE    = "0x4200000000000000000000000000000000000006" as const;

// Base produces ~2s blocks → ~15,768,000 blocks/year
const BLOCKS_PER_YEAR = 15_768_000;

const COMPTROLLER_ABI = parseAbi([
  "function getAllMarkets() external view returns (address[])",
  "function getAccountLiquidity(address account) external view returns (uint256 err, uint256 liquidity, uint256 shortfall)",
  "function checkMembership(address account, address mToken) external view returns (bool)",
]);

const MTOKEN_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function balanceOf(address account) external view returns (uint256)",
  "function borrowBalanceStored(address account) external view returns (uint256)",
  "function exchangeRateStored() external view returns (uint256)",
  "function underlying() external view returns (address)",
  "function supplyRatePerBlock() external view returns (uint256)",
  "function borrowRatePerBlock() external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
]);

function alchemyRpc(): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://base-mainnet.g.alchemy.com/v2/${key}`;
}

function rateToApy(ratePerBlock: bigint): number {
  const rate = Number(ratePerBlock) / 1e18;
  return (Math.pow(1 + rate, BLOCKS_PER_YEAR) - 1) * 100;
}

export async function fetchMoonwellPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain:     base,
    transport: http(alchemyRpc()),
  });

  try {
    // Step 1: get all markets, then filter to those the user is in
    const allMarkets = (await client.readContract({
      address:      COMPTROLLER,
      abi:          COMPTROLLER_ABI,
      functionName: "getAllMarkets",
    })) as `0x${string}`[];

    if (!allMarkets.length) return positions;

    // Check membership (which markets user has entered) in one multicall
    type MC = { status: "success" | "failure"; result?: unknown };
    const memberBatch = (await client.multicall({
      contracts: allMarkets.map(m => ({
        address: COMPTROLLER, abi: COMPTROLLER_ABI,
        functionName: "checkMembership" as const,
        args: [walletAddress as `0x${string}`, m],
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const mTokens = allMarkets.filter((_, i) =>
      memberBatch[i]?.status === "success" && memberBatch[i].result === true
    );

    if (!mTokens.length) return positions;

    // Step 2: batch multicall — all mToken data in one request
    const batch = (await client.multicall({
      contracts: [
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "symbol"              as const })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "balanceOf"            as const, args: [walletAddress as `0x${string}`] })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "borrowBalanceStored"  as const, args: [walletAddress as `0x${string}`] })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "exchangeRateStored"   as const })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "underlying"           as const })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "supplyRatePerBlock"   as const })),
        ...mTokens.map(m => ({ address: m, abi: MTOKEN_ABI, functionName: "borrowRatePerBlock"   as const })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n           = mTokens.length;
    const symbolsR    = batch.slice(0,     n);
    const balancesR   = batch.slice(n,   2*n);
    const borrowsR    = batch.slice(2*n, 3*n);
    const exRatesR    = batch.slice(3*n, 4*n);
    const underlyingR = batch.slice(4*n, 5*n);
    const supRateR    = batch.slice(5*n, 6*n);
    const borRateR    = batch.slice(6*n, 7*n);

    // Collect underlying addresses for CoinGecko
    const underlyingAddrs = mTokens.map((_, i) => {
      const u = underlyingR[i]?.status === "success" ? (underlyingR[i].result as string) : null;
      if (!u || u === ETH_SENTINEL) return WETH_BASE;
      return u.toLowerCase();
    });

    const prices = await getCoinGeckoPrices(underlyingAddrs, "base");

    // Step 3: get decimals for unique non-WETH underlyings
    const uniqueUnderlying = [...new Set(underlyingAddrs.filter(a => a !== WETH_BASE.toLowerCase()))];
    const decMap = new Map<string, number>();
    if (uniqueUnderlying.length > 0) {
      const decBatch = (await client.multicall({
        contracts: uniqueUnderlying.map(addr => ({
          address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" as const,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as MC[];
      uniqueUnderlying.forEach((addr, i) => {
        const d = decBatch[i]?.status === "success" ? Number(decBatch[i].result as bigint) : 18;
        decMap.set(addr, d);
      });
    }

    // Step 4: assemble positions
    for (let i = 0; i < n; i++) {
      const symbol   = (symbolsR[i]?.status  === "success" ? symbolsR[i].result  : "?") as string;
      const vBal     = (balancesR[i]?.status === "success" ? balancesR[i].result : 0n) as bigint;
      const borrow   = (borrowsR[i]?.status  === "success" ? borrowsR[i].result  : 0n) as bigint;
      const exRate   = (exRatesR[i]?.status  === "success" ? exRatesR[i].result  : 0n) as bigint;
      const supRate  = (supRateR[i]?.status  === "success" ? supRateR[i].result  : 0n) as bigint;
      const borRate  = (borRateR[i]?.status  === "success" ? borRateR[i].result  : 0n) as bigint;

      if (vBal === 0n && borrow === 0n) continue;

      const underlyingAddr = underlyingAddrs[i];
      const underlyingDec  = underlyingAddr === WETH_BASE.toLowerCase() ? 18 : (decMap.get(underlyingAddr) ?? 18);
      const priceUsd       = prices.get(underlyingAddr) ?? null;
      const underlyingSymbol = symbol.startsWith("m") ? symbol.slice(1) : symbol;
      const supplyApy      = rateToApy(supRate);
      const borrowApy      = rateToApy(borRate);

      if (vBal > 0n && exRate > 0n) {
        const underlyingSmallest = (vBal * exRate) / (10n ** 18n);
        const amount   = Number(underlyingSmallest) / 10 ** underlyingDec;
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "moonwell",
            chain:         "base",
            position_type: "lend",
            asset_symbol:  underlyingSymbol,
            asset_address: underlyingAddr,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       false,
            apy:           supplyApy,
          });
        }
      }

      if (borrow > 0n) {
        const amount   = Number(borrow) / 10 ** underlyingDec;
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "moonwell",
            chain:         "base",
            position_type: "borrow",
            asset_symbol:  underlyingSymbol,
            asset_address: underlyingAddr,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       true,
            apy:           -borrowApy,
          });
        }
      }
    }
  } catch (err) {
    console.error("Moonwell fetch error:", err);
  }

  return positions;
}
