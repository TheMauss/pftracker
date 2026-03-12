/**
 * Fetches Felix Protocol positions on HyperEVM.
 * Felix = Liquity V2 fork (CDPs/Troves) + Morpho lending markets.
 *
 * Troves: User deposits collateral (WHYPE, feUBTC, kHYPE, wstHYPE) and borrows feUSD.
 *   - CollateralRegistry: 0x9De1e57049c475736289Cb006212F3E1DCe4711B
 *   - 4 branches, each with TroveManager + TroveNFT
 *
 * Morpho Vaults: ERC-4626 vaults for USDT0 and USDH.
 * feUSD token: 0x02c6a2fa58cc01a18b8d9e00ea48d65e4df26c70
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi, defineChain } from "viem";

const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";

const hyperevmChain = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPEREVM_RPC] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

// ─── Felix Trove (Liquity V2 CDP) contracts ──────────────────────────────────

const FELIX_BRANCHES: Array<{
  name: string;
  collSymbol: string;
  troveManager: `0x${string}`;
  troveNFT: `0x${string}`;
}> = [
  { name: "WHYPE",   collSymbol: "HYPE",   troveManager: "0x3100F4e7BDA2ED2452d9A57EB30260ab071BBe62", troveNFT: "0x5AD1512e7006FdBD0f3EbB8aa35c5e9234a03AA7" },
  { name: "feUBTC",  collSymbol: "UBTC",   troveManager: "0xbbe5f227275f24B64bD290a91f55723a00214885", troveNFT: "0xad8A43Ac8Da98990efa4D5eC7B91135965D5846B" },
  { name: "kHYPE",   collSymbol: "kHYPE",  troveManager: "0x7c07bB77b1cF9A5b40D92F805c10d90C90957E4a", troveNFT: "0x9d08780dEeC2270b8296F520B3fb28346aBF6036" },
  { name: "wstHYPE", collSymbol: "wstHYPE", troveManager: "0x58446C58CaA8A6F6Cc8bE343f812EbF0B997c001", troveNFT: "0x7D29515fc4EAeF2a01c46218b4cb8d2D8Ae437E4" },
];

const TROVE_MANAGER_ABI = parseAbi([
  // Liquity V2 LatestTroveData struct order (confirmed against Felix WHYPE on-chain):
  // [0] entireDebt, [1] entireColl, [2] redistBoldDebtGain, [3] redistCollGain,
  // [4] accruedInterest, [5] recordedDebt, [6] annualInterestRate,
  // [7] weightedRecordedDebt, [8] accruedBatchManagementFee, [9] lastInterestRateAdjTime
  "function getLatestTroveData(uint256 troveId) view returns (uint256 entireDebt, uint256 entireColl, uint256 redistBoldDebtGain, uint256 redistCollGain, uint256 accruedInterest, uint256 recordedDebt, uint256 annualInterestRate, uint256 weightedRecordedDebt, uint256 accruedBatchManagementFee, uint256 lastInterestRateAdjTime)",
]);

const NFT_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

// ─── Morpho Vaults ───────────────────────────────────────────────────────────

const VAULT_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
]);

const FELIX_MORPHO_VAULTS: Array<{
  address: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
}> = [
  { address: "0x9896a8605763106e57A51aa0a97Fe8099E806bb3", assetSymbol: "USDT0", assetDecimals: 6 },
  { address: "0x207ccaE51Ad2E1C240C4Ab4c94b670D438d2201C", assetSymbol: "USDH", assetDecimals: 18 },
];

const FEUSD = "0x02c6a2fa58cc01a18b8d9e00ea48d65e4df26c70" as const;

// Collateral price lookup via Hyperliquid spot API
async function fetchCollateralPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return prices;
    const [, ctxs] = (await res.json()) as [
      unknown,
      Array<{ coin: string; markPx: string }>
    ];
    for (const ctx of ctxs) {
      if (ctx.coin === "HYPE/USDC" && ctx.markPx) {
        const hypePrice = parseFloat(ctx.markPx);
        prices["HYPE"] = hypePrice;
        prices["kHYPE"] = hypePrice;
        prices["wstHYPE"] = hypePrice;
      }
      if (ctx.coin === "PURR/USDC" && ctx.markPx) {
        // placeholder - won't match anything but shows the pattern
      }
    }
  } catch {}

  // BTC price from perp
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const [meta, ctxs] = (await res.json()) as [
        { universe: Array<{ name: string }> },
        Array<{ markPx: string }>
      ];
      for (let i = 0; i < meta.universe.length; i++) {
        if (meta.universe[i].name === "BTC") {
          prices["UBTC"] = parseFloat(ctxs[i].markPx);
          break;
        }
      }
    }
  } catch {}

  return prices;
}

export async function fetchFelixPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: hyperevmChain,
    transport: http(HYPEREVM_RPC, { timeout: 30_000, retryCount: 2, retryDelay: 1_000 }),
  });

  try {
    // ─── Step 1: Check TroveNFT balances across all branches via multicall ────
    type MC = { status: "success" | "failure"; result?: unknown };

    const nftBalanceBatch = (await client.multicall({
      contracts: FELIX_BRANCHES.map((b) => ({
        address: b.troveNFT,
        abi: NFT_ABI,
        functionName: "balanceOf" as const,
        args: [walletAddress as `0x${string}`],
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const branchesWithTroves = FELIX_BRANCHES.map((b, i) => {
      const entry = nftBalanceBatch[i];
      const count = (entry?.status === "success" ? entry.result : 0n) as bigint;
      return { branch: b, troveCount: Number(count) };
    }).filter((x) => x.troveCount > 0);

    if (branchesWithTroves.length > 0) {
      // Get trove IDs
      const tokenIdCalls = branchesWithTroves.flatMap(({ branch, troveCount }) =>
        Array.from({ length: troveCount }, (_, i) => ({
          address: branch.troveNFT,
          abi: NFT_ABI,
          functionName: "tokenOfOwnerByIndex" as const,
          args: [walletAddress as `0x${string}`, BigInt(i)],
          _branch: branch,
        }))
      );

      const tokenIdBatch = (await client.multicall({
        contracts: tokenIdCalls.map(({ _branch, ...call }) => call),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as MC[];

      // Get trove data for each found trove
      const troveCalls = tokenIdCalls.map((call, i) => {
        const entry = tokenIdBatch[i];
        const troveId = (entry?.status === "success" ? entry.result : 0n) as bigint;
        return {
          address: call._branch.troveManager,
          abi: TROVE_MANAGER_ABI,
          functionName: "getLatestTroveData" as const,
          args: [troveId],
          _branch: call._branch,
        };
      });

      const troveDataBatch = (await client.multicall({
        contracts: troveCalls.map(({ _branch, ...call }) => call),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as MC[];

      // Fetch prices for collateral tokens that have troves
      const needsPrices = new Set(troveCalls.map((c) => c._branch.collSymbol));
      const prices = needsPrices.size > 0 ? await fetchCollateralPrices() : {};

      for (let i = 0; i < troveCalls.length; i++) {
        const entry = troveDataBatch[i];
        if (entry?.status !== "success") continue;
        const data = entry.result as bigint[];
        const branch = troveCalls[i]._branch;

        const entireDebt       = Number(data[0]) / 1e18; // feUSD (18 decimals)
        const entireColl       = Number(data[1]) / 1e18; // collateral (18 decimals)
        // annualInterestRate is at index 6 (WAD fraction, e.g. 0.071 = 7.1%)
        // Use BigInt arithmetic to avoid precision loss (rates like 7% = 7e16 > MAX_SAFE_INTEGER)
        const rateWad = data[6] as bigint;
        const annualInterestRate = Number(rateWad * 10000n / 10n ** 18n) / 100; // WAD → %

        if (entireColl < 0.000001 && entireDebt < 0.01) continue;

        const collPrice = prices[branch.collSymbol] ?? null;
        const collValueUsd = collPrice ? entireColl * collPrice : 0;

        // Collateral position (supplied)
        if (entireColl > 0) {
          positions.push({
            protocol: "felix",
            chain: "hyperevm",
            position_type: "lend",
            asset_symbol: branch.collSymbol,
            asset_address: branch.troveManager,
            amount: entireColl,
            price_usd: collPrice,
            value_usd: collValueUsd,
            is_debt: false,
            apy: null,
            extra_data: { type: "trove_collateral", branch: branch.name },
          });
        }

        // Debt position (borrowed feUSD)
        if (entireDebt > 0.01) {
          positions.push({
            protocol: "felix",
            chain: "hyperevm",
            position_type: "borrow",
            asset_symbol: "feUSD",
            asset_address: FEUSD,
            amount: entireDebt,
            price_usd: 1.0,
            value_usd: entireDebt,
            is_debt: true,
            apy: annualInterestRate > 0 ? -annualInterestRate : null,
            extra_data: { type: "trove_debt", branch: branch.name },
          });
        }
      }
    }

    // ─── Step 2: Check Morpho Vault deposits ─────────────────────────────────
    const vaultBatch = (await client.multicall({
      contracts: [
        ...FELIX_MORPHO_VAULTS.map((v) => ({
          address: v.address,
          abi: VAULT_ABI,
          functionName: "balanceOf" as const,
          args: [walletAddress as `0x${string}`],
        })),
        { address: FEUSD, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [walletAddress as `0x${string}`] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const sharesResults = vaultBatch.slice(0, FELIX_MORPHO_VAULTS.length);
    const feusdEntry = vaultBatch[FELIX_MORPHO_VAULTS.length];

    const nonZeroVaults = FELIX_MORPHO_VAULTS.map((v, i) => {
      const entry = sharesResults[i];
      const shares = (entry?.status === "success" ? entry.result : 0n) as bigint;
      return { vault: v, shares };
    }).filter((x) => x.shares > 0n);

    if (nonZeroVaults.length > 0) {
      const convertBatch = (await client.multicall({
        contracts: nonZeroVaults.map(({ vault, shares }) => ({
          address: vault.address,
          abi: VAULT_ABI,
          functionName: "convertToAssets" as const,
          args: [shares],
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as MC[];

      for (let i = 0; i < nonZeroVaults.length; i++) {
        const { vault } = nonZeroVaults[i];
        const entry = convertBatch[i];
        const userAssets = (entry?.status === "success" ? entry.result : 0n) as bigint;
        const amount = Number(userAssets) / Math.pow(10, vault.assetDecimals);
        if (amount < 0.01) continue;

        positions.push({
          protocol: "felix",
          chain: "hyperevm",
          position_type: "lend",
          asset_symbol: vault.assetSymbol,
          asset_address: vault.address,
          amount,
          price_usd: 1.0,
          value_usd: amount,
          is_debt: false,
          apy: null,
          extra_data: { vault: vault.address, type: "morpho_vault" },
        });
      }
    }

    // feUSD wallet balance
    const feusdBalance = (feusdEntry?.status === "success" ? feusdEntry.result : 0n) as bigint;
    const feusdAmount = Number(feusdBalance) / 1e18;
    if (feusdAmount > 0.01) {
      positions.push({
        protocol: "felix",
        chain: "hyperevm",
        position_type: "vault",
        asset_symbol: "feUSD",
        asset_address: FEUSD,
        amount: feusdAmount,
        price_usd: 1.0,
        value_usd: feusdAmount,
        is_debt: false,
        apy: null,
        extra_data: { type: "stablecoin_balance" },
      });
    }
  } catch (err) {
    console.error("Felix fetch error:", err);
  }

  return positions;
}
