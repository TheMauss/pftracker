/**
 * Core snapshot orchestration.
 * Fetches all wallets + DeFi positions, aggregates, and writes to DB.
 */

import { formatInTimeZone } from "date-fns-tz";
import {
  getWallets,
  getStockPositions,
  writeSnapshot,
  getSnapshotForToday,
  type SnapshotInsertData,
} from "./db";
import { clearPriceCache } from "./prices";
import { fetchStockPrices } from "./stocks";
import { fetchSolanaBalances } from "./chains/solana";
import { fetchEvmBalances } from "./chains/evm";
import { fetchHyperliquidBalances } from "./chains/hyperliquid";
import { fetchKaminoPositions } from "./defi/solana-kamino";
import { fetchJlpPosition, JLP_MINT } from "./defi/solana-jlp";
import { fetchDriftPositions } from "./defi/solana-drift";
// MarginFi, Orca, Raydium, Meteora APIs are currently broken/changed (404s)
// import { fetchMarginFiPositions } from "./defi/solana-marginfi";
// import { fetchOrcaPositions } from "./defi/solana-orca";
// import { fetchRaydiumPositions } from "./defi/solana-raydium";
// import { fetchMeteoraPositions } from "./defi/solana-meteora";
import { fetchFelixPositions } from "./defi/hyper-felix";
import { fetchHyperlendPositions } from "./defi/hyper-hyperlend";
import { fetchPendlePositions } from "./defi/hyper-pendle";
import { fetchAavePositions } from "./defi/evm-aave";
// Uniswap subgraph is dead (hosted service shut down), always returns $0
// import { fetchUniswapPositions } from "./defi/evm-uniswap";
import { fetchGmxPositions } from "./defi/evm-gmx";
import { fetchCompoundPositions } from "./defi/evm-compound";
import { fetchSparkPositions } from "./defi/evm-spark";
import { fetchMorphoPositions } from "./defi/evm-morpho";
import { fetchVenusPositions } from "./defi/evm-venus";
import { fetchMoonwellPositions } from "./defi/evm-moonwell";
import { fetchSeamlessPositions } from "./defi/evm-seamless";
import { fetchSuiBalances } from "./chains/sui";
import { fetchBitcoinBalance } from "./chains/bitcoin";
import { fetchNaviPositions } from "./defi/sui-navi";
import { fetchScallopPositions } from "./defi/sui-scallop";
import type { Wallet, RawTokenBalance, RawDefiPosition } from "./types";

const PRAGUE_TZ = "Europe/Prague";

export interface SnapshotResult {
  snapshotId: number;
  totalUsd: number;
  status: "ok" | "partial";
  errors: string[];
}

export async function takeSnapshot(overwrite = false): Promise<SnapshotResult> {
  const now = new Date();
  const pragueDate = formatInTimeZone(now, PRAGUE_TZ, "yyyy-MM-dd");
  const pragueDateTime = formatInTimeZone(now, PRAGUE_TZ, "yyyy-MM-dd HH:mm:ss");

  // Idempotency: skip if snapshot for today already exists (unless overwrite)
  if (!overwrite) {
    const existing = getSnapshotForToday(pragueDate);
    if (existing) {
      console.log(`[snapshot] Snapshot for ${pragueDate} already exists (id=${existing.id}), skipping.`);
      return {
        snapshotId: existing.id,
        totalUsd: existing.total_usd,
        status: existing.status as "ok" | "partial",
        errors: [],
      };
    }
  }

  console.log(`[snapshot] Taking snapshot for ${pragueDate}...`);
  clearPriceCache();

  const wallets = getWallets();
  const errors: string[] = [];

  const walletData: SnapshotInsertData["wallets"] = [];

  for (const wallet of wallets) {
    const walletErrors: string[] = [];
    const tokens: RawTokenBalance[] = [];
    const defiPositions: RawDefiPosition[] = [];

    // ─── Fetch base token balances ──────────────────────────────────────────
    try {
      const chainTokens = await fetchChainBalances(wallet);
      tokens.push(...chainTokens);
    } catch (err) {
      const msg = `[${wallet.chain}/${wallet.address.slice(0, 8)}] token fetch failed: ${err}`;
      walletErrors.push(msg);
      console.error(msg);
    }

    // ─── Fetch DeFi positions ───────────────────────────────────────────────
    const defiResults = await fetchAllDefiPositions(wallet, tokens);
    defiPositions.push(...defiResults.positions);
    walletErrors.push(...defiResults.errors);

    // ─── Aggregate values ──────────────────────────────────────────────────
    const tokenUsd = tokens
      .filter((t) => !t.is_derivative)
      .reduce((sum, t) => sum + (t.value_usd ?? 0), 0);

    const defiDepositUsd = defiPositions
      .filter((p) => !p.is_debt)
      .reduce((sum, p) => sum + (p.value_usd ?? 0), 0);

    const defiBorrowUsd = defiPositions
      .filter((p) => p.is_debt)
      .reduce((sum, p) => sum + (p.value_usd ?? 0), 0);

    const totalUsd = tokenUsd + defiDepositUsd - defiBorrowUsd;

    errors.push(...walletErrors);

    walletData.push({
      wallet_id: wallet.id,
      total_usd: totalUsd,
      token_usd: tokenUsd,
      defi_deposit_usd: defiDepositUsd,
      defi_borrow_usd: defiBorrowUsd,
      tokens: tokens.map((t) => ({
        token_symbol: t.token_symbol,
        token_name: t.token_name ?? null,
        token_address: t.token_address ?? null,
        chain: t.chain,
        amount: t.amount,
        price_usd: t.price_usd ?? null,
        value_usd: t.value_usd,
        is_derivative: t.is_derivative ?? false,
      })),
      defi_positions: defiPositions.map((p) => ({
        protocol: p.protocol,
        chain: p.chain,
        position_type: p.position_type,
        asset_symbol: p.asset_symbol,
        asset_address: p.asset_address ?? null,
        amount: p.amount,
        price_usd: p.price_usd ?? null,
        value_usd: p.value_usd,
        is_debt: p.is_debt ?? false,
        apy: p.apy ?? null,
        extra_data: p.extra_data ?? null,
      })),
    });
  }

  // ─── Add stock positions value ────────────────────────────────────────────
  let stocksUsd = 0;
  try {
    const stockPositions = getStockPositions();
    if (stockPositions.length > 0) {
      const manualPositions = stockPositions.filter((p) => p.source === "manual");
      const importedPositions = stockPositions.filter((p) => p.source !== "manual");
      const tickers = [...new Set(importedPositions.map((p) => p.ticker))];
      const quotes = tickers.length ? await fetchStockPrices(tickers) : new Map();

      for (const p of stockPositions) {
        if (p.source === "manual") {
          stocksUsd += (p.price_usd ?? 0) * p.quantity;
        } else {
          const price = quotes.get(p.ticker)?.price ?? null;
          if (price) stocksUsd += price * p.quantity;
        }
      }
      // suppress unused variable warning
      void manualPositions;
    }
  } catch (err) {
    errors.push(`[stocks] fetch failed: ${err}`);
    console.error("[snapshot] stocks fetch failed:", err);
  }

  const totalUsd = walletData.reduce((sum, w) => sum + w.total_usd, 0) + stocksUsd;
  const status = errors.length > 0 ? "partial" : "ok";

  const snapshotId = writeSnapshot({
    total_usd: totalUsd,
    status,
    taken_at: pragueDateTime,
    wallets: walletData,
  });

  console.log(
    `[snapshot] Done. id=${snapshotId}, total=$${totalUsd.toFixed(2)}, status=${status}, errors=${errors.length}`
  );

  return { snapshotId, totalUsd, status, errors };
}

const EVM_CHAINS = ["ethereum", "base", "arbitrum", "bsc"] as const;

async function fetchChainBalances(wallet: Wallet): Promise<RawTokenBalance[]> {
  if (wallet.chain === "solana") {
    return fetchSolanaBalances(wallet.address);
  }

  if (wallet.chain === "sui") {
    return fetchSuiBalances(wallet.address);
  }

  if (wallet.chain === "bitcoin") {
    return fetchBitcoinBalance(wallet.address);
  }

  if (wallet.chain === "evm") {
    // EVM address → fetch all chains in parallel
    const [evmResults, hlTokens, hyperEvmTokens] = await Promise.all([
      Promise.all(
        EVM_CHAINS.map((chain) =>
          fetchEvmBalances(wallet.address, chain).catch(() => [] as RawTokenBalance[])
        )
      ),
      fetchHyperliquidBalances(wallet.address).catch(() => [] as RawTokenBalance[]),
      fetchEvmBalances(wallet.address, "hyperevm").catch(() => [] as RawTokenBalance[]),
    ]);
    return [...evmResults.flat(), ...hlTokens, ...hyperEvmTokens];
  }

  return [];
}

async function fetchAllDefiPositions(
  wallet: Wallet,
  tokens: RawTokenBalance[]
): Promise<{ positions: RawDefiPosition[]; errors: string[] }> {
  const positions: RawDefiPosition[] = [];
  const errors: string[] = [];

  const DEFI_TIMEOUT_MS = 45_000;

  const fetchWithCatch = async (
    name: string,
    fn: () => Promise<RawDefiPosition[]>
  ) => {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${DEFI_TIMEOUT_MS / 1000}s`)), DEFI_TIMEOUT_MS)
      );
      const result = await Promise.race([fn(), timeout]);
      positions.push(...result);
    } catch (err) {
      const msg = `[DeFi:${name}/${wallet.address.slice(0, 8)}] ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  };

  if (wallet.chain === "sui") {
    await Promise.all([
      fetchWithCatch("navi",    () => fetchNaviPositions(wallet.address)),
      fetchWithCatch("scallop", () => fetchScallopPositions(wallet.address)),
    ]);
  }

  if (wallet.chain === "solana") {
    const jlpToken = tokens.find((t) => t.token_address === JLP_MINT);
    await Promise.all([
      fetchWithCatch("kamino", () => fetchKaminoPositions(wallet.address)),
      fetchWithCatch("drift", () => fetchDriftPositions(wallet.address)),
      // MarginFi, Orca, Raydium, Meteora APIs are currently broken/changed (404s)
      // fetchWithCatch("marginfi", () => fetchMarginFiPositions(wallet.address)),
      // fetchWithCatch("orca", () => fetchOrcaPositions(wallet.address)),
      // fetchWithCatch("raydium", () => fetchRaydiumPositions(wallet.address)),
      // fetchWithCatch("meteora", () => fetchMeteoraPositions(wallet.address)),
      ...(jlpToken && jlpToken.amount > 0
        ? [fetchWithCatch("jlp", async () => {
            const pos = await fetchJlpPosition(wallet.address, jlpToken.amount);
            return pos ? [pos] : [];
          })]
        : []),
    ]);
  }

  if (wallet.chain === "evm") {
    await Promise.all([
      // HyperEVM DeFi
      fetchWithCatch("hyperlend",      () => fetchHyperlendPositions(wallet.address)),
      fetchWithCatch("felix",          () => fetchFelixPositions(wallet.address)),
      fetchWithCatch("pendle-hyperevm",() => fetchPendlePositions(wallet.address, "hyperevm")),
      // Ethereum DeFi
      fetchWithCatch("aave-eth",       () => fetchAavePositions(wallet.address, "ethereum")),
      fetchWithCatch("compound-eth",   () => fetchCompoundPositions(wallet.address, "ethereum")),
      fetchWithCatch("spark",          () => fetchSparkPositions(wallet.address)),
      fetchWithCatch("morpho-eth",     () => fetchMorphoPositions(wallet.address, "ethereum")),
      // Uniswap subgraph is dead (hosted service shut down), always returns $0
      // fetchWithCatch("uniswap-eth", () => fetchUniswapPositions(wallet.address, "ethereum")),
      fetchWithCatch("pendle-eth",     () => fetchPendlePositions(wallet.address, "ethereum")),
      // Arbitrum DeFi
      fetchWithCatch("aave-arb",       () => fetchAavePositions(wallet.address, "arbitrum")),
      // fetchWithCatch("uniswap-arb", () => fetchUniswapPositions(wallet.address, "arbitrum")),
      fetchWithCatch("compound-arb",   () => fetchCompoundPositions(wallet.address, "arbitrum")),
      fetchWithCatch("pendle-arb",     () => fetchPendlePositions(wallet.address, "arbitrum")),
      fetchWithCatch("gmx",            () => fetchGmxPositions(wallet.address)),
      // Base DeFi
      fetchWithCatch("aave-base",      () => fetchAavePositions(wallet.address, "base")),
      fetchWithCatch("compound-base",  () => fetchCompoundPositions(wallet.address, "base")),
      fetchWithCatch("morpho-base",    () => fetchMorphoPositions(wallet.address, "base")),
      fetchWithCatch("moonwell",       () => fetchMoonwellPositions(wallet.address)),
      fetchWithCatch("seamless",       () => fetchSeamlessPositions(wallet.address)),
      // fetchWithCatch("uniswap-base", () => fetchUniswapPositions(wallet.address, "base")),
      // BSC DeFi
      fetchWithCatch("venus",          () => fetchVenusPositions(wallet.address)),
    ]);
  }

  return { positions, errors };
}

/**
 * Builds a live portfolio snapshot without writing to DB.
 * Used by the /api/portfolio endpoint.
 */
export async function getLivePortfolio() {
  clearPriceCache();
  const wallets = getWallets();
  const results = [];
  let totalUsd = 0;

  for (const wallet of wallets) {
    const errors: string[] = [];
    const tokens: RawTokenBalance[] = [];
    const defiPositions: RawDefiPosition[] = [];

    try {
      const chainTokens = await fetchChainBalances(wallet);
      tokens.push(...chainTokens);
    } catch (err) {
      errors.push(`Token fetch failed: ${err}`);
    }

    const defiResults = await fetchAllDefiPositions(wallet, tokens);
    defiPositions.push(...defiResults.positions);
    errors.push(...defiResults.errors);

    const tokenUsd = tokens
      .filter((t) => !t.is_derivative)
      .reduce((sum, t) => sum + t.value_usd, 0);
    const defiDepositUsd = defiPositions
      .filter((p) => !p.is_debt)
      .reduce((sum, p) => sum + p.value_usd, 0);
    const defiBorrowUsd = defiPositions
      .filter((p) => p.is_debt)
      .reduce((sum, p) => sum + p.value_usd, 0);
    const walletTotal = tokenUsd + defiDepositUsd - defiBorrowUsd;

    totalUsd += walletTotal;

    results.push({
      wallet,
      token_usd: tokenUsd,
      defi_deposit_usd: defiDepositUsd,
      defi_borrow_usd: defiBorrowUsd,
      total_usd: walletTotal,
      tokens,
      defi_positions: defiPositions,
      errors,
    });
  }

  return { totalUsd, wallets: results };
}
