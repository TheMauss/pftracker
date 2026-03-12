/**
 * Fetches Venus Protocol positions on BNB Chain (BSC).
 * Venus is a Compound V2 fork — the largest lending protocol on BSC.
 * Uses public BSC RPC (Alchemy doesn't support BSC).
 *
 * Flow:
 *  1. Comptroller.getAssetsIn(user) → list of vToken markets user has entered
 *  2. multicall: balanceOf + borrowBalanceStored + exchangeRateStored + decimals + underlying
 *  3. Prices via CoinGecko (underlying token addresses)
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi, defineChain } from "viem";
import { getCoinGeckoPrices } from "../prices";

const BSC_RPC = "https://bsc.publicnode.com";

const bsc = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [BSC_RPC] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

// Venus Core Pool Comptroller on BSC
const COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;

// Native BNB sentinel address used by Venus for the BNB market
const BNB_SENTINEL = "0x0000000000000000000000000000000000000000" as const;
// Wrapped BNB — used for CoinGecko price lookup
const WBNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" as const;

const COMPTROLLER_ABI = parseAbi([
  "function getAssetsIn(address account) external view returns (address[])",
]);

const VTOKEN_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address account) external view returns (uint256)",
  "function borrowBalanceStored(address account) external view returns (uint256)",
  "function exchangeRateStored() external view returns (uint256)",
  "function underlying() external view returns (address)",
  "function supplyRatePerBlock() external view returns (uint256)",
  "function borrowRatePerBlock() external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]);

// BSC produces ~3 blocks per second → ~28,800 blocks per day → ~10,512,000 per year
const BLOCKS_PER_YEAR = 10_512_000;

function rateToApy(ratePerBlock: bigint): number {
  const ratePerBlockFloat = Number(ratePerBlock) / 1e18;
  return (Math.pow(1 + ratePerBlockFloat, BLOCKS_PER_YEAR) - 1) * 100;
}

export async function fetchVenusPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain:     bsc,
    transport: http(BSC_RPC, { timeout: 30_000, retryCount: 2, retryDelay: 1_000 }),
  });

  try {
    // Step 1: get markets user has entered
    const vTokens = (await client.readContract({
      address:      COMPTROLLER,
      abi:          COMPTROLLER_ABI,
      functionName: "getAssetsIn",
      args:         [walletAddress as `0x${string}`],
    })) as `0x${string}`[];

    if (!vTokens.length) return positions;

    // Step 2: batch multicall — all vToken data in one request
    type MC = { status: "success" | "failure"; result?: unknown };
    const batch = (await client.multicall({
      contracts: [
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "symbol"               as const })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "balanceOf"             as const, args: [walletAddress as `0x${string}`] })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "borrowBalanceStored"   as const, args: [walletAddress as `0x${string}`] })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "exchangeRateStored"    as const })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "underlying"            as const })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "supplyRatePerBlock"    as const })),
        ...vTokens.map(v => ({ address: v, abi: VTOKEN_ABI, functionName: "borrowRatePerBlock"    as const })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n          = vTokens.length;
    const symbolsR   = batch.slice(0,     n);
    const balancesR  = batch.slice(n,   2*n);
    const borrowsR   = batch.slice(2*n, 3*n);
    const exRatesR   = batch.slice(3*n, 4*n);
    const underlyingR = batch.slice(4*n, 5*n);
    const supRateR   = batch.slice(5*n, 6*n);
    const borRateR   = batch.slice(6*n, 7*n);

    // Collect unique underlying addresses for CoinGecko price lookup
    const underlyingAddrs = vTokens.map((_, i) => {
      const u = underlyingR[i]?.status === "success" ? (underlyingR[i].result as string) : null;
      // vBNB has no underlying() — use WBNB for price lookup
      if (!u || u === BNB_SENTINEL) return WBNB_ADDRESS;
      return u.toLowerCase();
    });

    const prices = await getCoinGeckoPrices(underlyingAddrs, "bsc");

    // Step 3: get underlying decimals for non-BNB tokens
    const uniqueUnderlying = [...new Set(underlyingAddrs.filter(a => a !== WBNB_ADDRESS))];
    let underlyingDecimalsMap = new Map<string, number>();
    if (uniqueUnderlying.length > 0) {
      const decBatch = (await client.multicall({
        contracts: uniqueUnderlying.map(addr => ({
          address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" as const,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as MC[];
      uniqueUnderlying.forEach((addr, i) => {
        const d = decBatch[i]?.status === "success" ? Number(decBatch[i].result as bigint) : 18;
        underlyingDecimalsMap.set(addr, d);
      });
    }

    // Step 4: assemble positions
    for (let i = 0; i < n; i++) {
      const symbol      = (symbolsR[i]?.status  === "success" ? symbolsR[i].result   : "?") as string;
      const vBal        = (balancesR[i]?.status  === "success" ? balancesR[i].result  : 0n) as bigint;
      const borrowBal   = (borrowsR[i]?.status   === "success" ? borrowsR[i].result   : 0n) as bigint;
      const exRate      = (exRatesR[i]?.status   === "success" ? exRatesR[i].result   : 0n) as bigint;
      const supRate     = (supRateR[i]?.status   === "success" ? supRateR[i].result   : 0n) as bigint;
      const borRate     = (borRateR[i]?.status   === "success" ? borRateR[i].result   : 0n) as bigint;

      if (vBal === 0n && borrowBal === 0n) continue;

      const underlyingAddr = underlyingAddrs[i];
      const underlyingDec  = underlyingAddr === WBNB_ADDRESS ? 18 : (underlyingDecimalsMap.get(underlyingAddr) ?? 18);
      const priceUsd       = prices.get(underlyingAddr) ?? null;

      // Strip "v" prefix from symbol to get underlying symbol (e.g. "vUSDC" → "USDC")
      const underlyingSymbol = symbol.startsWith("v") ? symbol.slice(1) : symbol;

      const supplyApy = rateToApy(supRate);
      const borrowApy = rateToApy(borRate);

      // Supply position: vTokenBalance × exchangeRate / 1e18 → underlying smallest units
      if (vBal > 0n && exRate > 0n) {
        // exchangeRate mantissa = 1e18; result is in underlying smallest units
        const underlyingSmallest = (vBal * exRate) / (10n ** 18n);
        const amount   = Number(underlyingSmallest) / 10 ** underlyingDec;
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "venus",
            chain:         "bsc",
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

      // Borrow position: borrowBalanceStored is already in underlying smallest units
      if (borrowBal > 0n) {
        const amount   = Number(borrowBal) / 10 ** underlyingDec;
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "venus",
            chain:         "bsc",
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
    console.error("Venus BSC fetch error:", err);
  }

  return positions;
}
