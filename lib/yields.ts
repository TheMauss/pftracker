/**
 * Yield rate fetching + bridge/swap route cost calculation.
 * Server-only — uses viem.
 *
 * Bridge methodology:
 *  USDC: Circle CCTP (native mint/burn, no wrapped tokens)
 *  USDT: Wormhole, or cheaper: swap to USDC → CCTP → swap to USDT on dest
 *  HyperEVM in/out: via Hyperliquid bridge (Arbitrum ↔ HL spot ↔ HyperEVM)
 *    - Deposit (Arb→HL→HyperEVM): just Arbitrum gas + HyperEVM gas
 *    - Withdrawal (HyperEVM→HL→Arb): $1 fixed HL fee + negligible gas
 *
 * Swap fees (stablecoin pairs):
 *  Solana / Jupiter:       ~0.10% (higher than EVM)
 *  Ethereum / Curve 3pool: ~0.04%
 *  Arbitrum / Uniswap V3:  ~0.01% (0.01% fee tier pool)
 *  Base / Uniswap V3:      ~0.01%
 *  HyperEVM (DEX):         ~0.05% (estimate, less liquidity)
 */

import type { ChainId, ProtocolId, RawDefiPosition, RawTokenBalance } from "./types";
import { createPublicClient, http, parseAbi, defineChain } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

// ─── Stablecoin helpers ───────────────────────────────────────────────────────

export const STABLE_ASSETS = new Set([
  "USDC", "USDT", "USDC.e", "USDbC", "DAI", "USDS", "crvUSD",
  "PYUSD", "GHO", "USDe", "sUSDe", "LUSD", "FRAX", "feUSD",
  // HyperEVM stablecoins
  "USD₮0", "USDH", "USDHL", "USR",
]);

export const NATIVE_ASSETS = new Set([
  "ETH", "WETH",
  "BTC", "WBTC", "BTCB",
  "SOL", "WSOL",
  "HYPE", "WHYPE", "wstHYPE", "kHYPE", "stHYPE", "beHYPE",
  // HyperEVM wrapped native tokens
  "UETH", "UBTC", "USOL",
  "SUI",
  "stETH", "wstETH", "cbETH", "rETH", "ezETH", "rsETH", "eETH", "weETH",
  "jitoSOL", "mSOL", "bSOL",
]);

// Stablecoins that CCTP supports natively (mint/burn, not wrapped)
const CCTP_ASSETS = new Set(["USDC", "USDC.E", "USDBC"]);

export function isStable(symbol: string): boolean {
  return STABLE_ASSETS.has(symbol) || STABLE_ASSETS.has(normalizeAsset(symbol));
}

export function isNative(symbol: string): boolean {
  const sl = symbol.toLowerCase();
  for (const n of NATIVE_ASSETS) if (n.toLowerCase() === sl) return true;
  return false;
}

/** Map LST/LRT derivatives to their underlying native network token for display. */
export function normalizeNative(symbol: string): string {
  const s = symbol.toLowerCase();
  const ETH_DERIVS = ["steth", "wsteth", "cbeth", "reth", "ezeth", "rseth", "eeth", "weeth", "weth"];
  if (ETH_DERIVS.includes(s)) return "ETH";
  const BTC_DERIVS = ["wbtc", "btcb", "tbtc"];
  if (BTC_DERIVS.includes(s)) return "BTC";
  const SOL_DERIVS = ["msol", "bsol", "jitosol", "wsol"];
  if (SOL_DERIVS.includes(s)) return "SOL";
  const HYPE_DERIVS = ["whype", "wsthype", "khype", "sthype", "behype"];
  if (HYPE_DERIVS.includes(s)) return "HYPE";
  // HyperEVM wrapped tokens → underlying native
  if (s === "ueth") return "ETH";
  if (s === "ubtc") return "BTC";
  if (s === "usol") return "SOL";
  if (s === "wsui") return "SUI";
  return symbol;
}

export function normalizeAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s === "USDC.E" || s === "USDBC") return "USDC";
  return s;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface YieldRate {
  protocol: ProtocolId;
  chain: ChainId;
  asset: string;
  supply_apy: number;
  borrow_apy: number;
  type?: "variable" | "fixed";   // "fixed" = Pendle PT
  maturity?: string;             // ISO date, for Pendle PT / LP
  liquidity_usd?: number;
  /** Risk tier for display — lending = low, CLMM vault = medium */
  risk?: "low" | "medium" | "high";
  /** Asset category for tab separation */
  category?: "stable" | "native";
  /** Lockup / unbonding period in days. 0 = liquid (tradeable LST), >0 = locked */
  lockup_days?: number;
}

/** Route cost breakdown for moving stablecoins between chains/assets. */
export interface RouteCost {
  total_usd: number;
  bridge_usd: number;    // CCTP / Wormhole / HL bridge fee
  swap_usd: number;      // DEX swap fee(s)
  method: string;        // human-readable label
  notes: string[];       // step-by-step breakdown
}

/** Actionable link shown in the UI for a recommendation step. */
export interface RouteLink {
  label: string;
  url: string;
}

// ─── Action URL maps ──────────────────────────────────────────────────────────

const PROTOCOL_URLS: Record<string, string> = {
  kamino:    "https://app.kamino.finance",
  aave:      "https://app.aave.com",
  hyperlend: "https://app.hyperlend.finance",
  pendle:    "https://app.pendle.finance/trade/markets",
  drift:     "https://app.drift.trade",
  marginfi:  "https://app.marginfi.com",
  orca:      "https://www.orca.so",
  raydium:   "https://raydium.io/liquidity/",
  meteora:   "https://app.meteora.ag",
  felix:     "https://felix.finance",
  uniswap:   "https://app.uniswap.org",
  gmx:       "https://app.gmx.io",
};

const SWAP_URLS: Record<string, string> = {
  solana:      "https://jup.ag",
  ethereum:    "https://curve.fi/#/ethereum/swap",
  arbitrum:    "https://app.uniswap.org/swap",
  base:        "https://app.uniswap.org/swap",
  hyperevm:    "https://app.hyperswap.exchange",
  hyperliquid: "https://app.hyperliquid.xyz/trade",
  bsc:         "https://pancakeswap.finance/swap",
};

function getBridgeUrl(fromChain: string, toChain: string): string {
  if (
    fromChain === "hyperliquid" || toChain === "hyperliquid" ||
    fromChain === "hyperevm"    || toChain === "hyperevm"
  ) return "https://app.hyperliquid.xyz/bridge";
  return "https://app.across.to"; // CCTP via Across for EVM↔EVM and EVM↔Solana
}

export interface YieldRecommendation {
  type: "deploy" | "move";
  from_protocol?: string;
  from_chain?: string;
  from_asset?: string;      // may differ from target asset
  to_protocol: string;
  to_chain: string;
  asset: string;            // target asset
  amount_usd: number;
  current_apy: number;
  target_apy: number;
  apy_gain: number;
  daily_gain_usd: number;
  route_cost_usd: number;   // total cost (bridge + swap)
  bridge_cost_usd: number;
  swap_cost_usd: number;
  route_method: string;
  route_notes: string[];
  route_links: RouteLink[];
  breakeven_days: number | null;
  yield_type?: "variable" | "fixed";
  maturity?: string;
}

export interface BridgeCosts {
  /** CCTP USDC bridge cost per route (source:USDC → dest:USDC) */
  cctp: Record<string, number>;
  /** Wormhole USDT bridge cost per route (when direct USDT bridge is needed) */
  wormhole: Record<string, number>;
  /** DEX swap fee rate for stable-to-stable swaps, per chain (fraction: 0.001 = 0.1%) */
  swap_fees: Record<string, number>;
  /** Hyperliquid withdrawal fee to Arbitrum (fixed $1 protocol fee) */
  hl_withdrawal_usd: number;
  /** HyperEVM internal tx cost (200k gas at ~1 gwei HYPE, ~$0.003) */
  hl_hyperevm_tx_usd: number;
  eth_gas_gwei: number;
  eth_usd: number;
  hype_usd: number;
}

// ─── Live gas / price fetch ───────────────────────────────────────────────────

async function fetchGasAndPrices(): Promise<{
  ethGwei: number;
  arbGwei: number;
  ethUsd: number;
  hypeUsd: number;
}> {
  const key = process.env.ALCHEMY_API_KEY ?? "";

  const [ethGasRes, arbGasRes, ethPriceRes, hypePriceRes] = await Promise.allSettled([
    fetch(`https://eth-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
      signal: AbortSignal.timeout(5_000),
    }),
    fetch(`https://arb-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 2 }),
      signal: AbortSignal.timeout(5_000),
    }),
    fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) }
    ),
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal: AbortSignal.timeout(8_000),
    }),
  ]);

  let ethGwei = 0.3;   // realistic 2026 fallback
  let arbGwei = 0.02;  // Arbitrum is essentially free
  let ethUsd = 2500;
  let hypeUsd = 15;

  if (ethGasRes.status === "fulfilled" && ethGasRes.value.ok) {
    const d = await ethGasRes.value.json();
    const p = parseInt(d?.result ?? "0x0", 16) / 1e9;
    if (p > 0 && p < 50_000) ethGwei = p;
  }
  if (arbGasRes.status === "fulfilled" && arbGasRes.value.ok) {
    const d = await arbGasRes.value.json();
    const p = parseInt(d?.result ?? "0x0", 16) / 1e9;
    if (p > 0 && p < 50_000) arbGwei = p;
  }
  if (ethPriceRes.status === "fulfilled" && ethPriceRes.value.ok) {
    const d = await ethPriceRes.value.json();
    const price = d?.ethereum?.usd;
    if (typeof price === "number" && price > 0) ethUsd = price;
  }
  if (hypePriceRes.status === "fulfilled" && hypePriceRes.value.ok) {
    try {
      const [, ctxs] = (await hypePriceRes.value.json()) as [unknown, Array<{ coin: string; markPx?: string }>];
      const hype = ctxs.find((c) => c.coin === "HYPE/USDC");
      if (hype?.markPx) hypeUsd = parseFloat(hype.markPx);
    } catch { /* skip */ }
  }

  return { ethGwei, arbGwei, ethUsd, hypeUsd };
}

/**
 * Computes live bridge costs using real gas prices + known protocol fees.
 *
 * CCTP gas usage (measured from on-chain txs):
 *   ETH mainnet burn (depositForBurn):   ~85,000 gas
 *   ETH mainnet mint (receiveMessage):   ~75,000 gas
 *   Arbitrum (either side):              ~120,000 gas
 *   Base (either side):                  ~120,000 gas
 *   Solana CCTP tx:                      ~$0.001
 *
 * HyperLiquid bridge (Arbitrum ↔ HyperEVM via HL spot):
 *   Deposit (Arb→HL spot→HyperEVM):     Arbitrum gas + HyperEVM internal (~$0.003)
 *   Withdrawal (HyperEVM→HL spot→Arb): HL fixed fee $1 (validators pay Arb gas)
 *
 * Base→HyperEVM must go Base→Arbitrum (CCTP) then Arbitrum→HL bridge.
 */
export async function fetchLiveBridgeCosts(): Promise<BridgeCosts> {
  const { ethGwei, arbGwei, ethUsd, hypeUsd } = await fetchGasAndPrices();

  const r = (n: number) => Math.round(n * 100) / 100;

  // Gas cost helpers (ETH-denominated L1/L2)
  const gas = (units: number, gwei: number) => (units * gwei * 1e-9) * ethUsd;
  const ethBurn = gas(85_000, ethGwei);
  const ethMint = gas(75_000, ethGwei);
  // Arbitrum/Base gas is so cheap it's essentially free; floor at $0.01
  const arbTx = Math.max(0.01, gas(120_000, arbGwei));
  const solTx = 0.001;

  // HyperEVM internal transfer: 200k gas at 0.5-1 gwei HYPE
  // Gas token is HYPE, not ETH
  const hyperevmTx = Math.max(0.003, (200_000 * 1e-9) * hypeUsd);

  // HL withdrawal: fixed $1 protocol fee (validators cover Arbitrum gas)
  const HL_WITHDRAWAL = 1.00;

  // CCTP routes: USDC only, native mint/burn
  const cctp: Record<string, number> = {
    // Solana as source
    "solana→ethereum":   r(solTx + ethMint),
    "solana→arbitrum":   r(solTx + arbTx),
    "solana→base":       r(solTx + arbTx),   // Base uses same L2 gas tier
    "solana→hyperevm":   r(solTx + arbTx + hyperevmTx), // CCTP→Arb then HL bridge

    // Ethereum as source (expensive burn gas)
    "ethereum→solana":   r(ethBurn + solTx),
    "ethereum→arbitrum": r(ethBurn + arbTx),
    "ethereum→base":     r(ethBurn + arbTx),
    "ethereum→hyperevm": r(ethBurn + arbTx + hyperevmTx),

    // Arbitrum as source (cheap burn + dest gas)
    "arbitrum→solana":   r(arbTx + solTx),
    "arbitrum→ethereum": r(arbTx + ethMint),
    "arbitrum→base":     r(arbTx + arbTx),
    "arbitrum→hyperevm": r(arbTx + hyperevmTx), // HL deposit: Arb gas + HyperEVM internal

    // Base as source
    "base→solana":       r(arbTx + solTx),
    "base→ethereum":     r(arbTx + ethMint),
    "base→arbitrum":     r(arbTx + arbTx),
    "base→hyperevm":     r(arbTx + arbTx + hyperevmTx), // Base→Arb CCTP, then HL bridge

    // HyperEVM as source: HL withdrawal ($1 fixed) → Arbitrum → destination
    "hyperevm→solana":       r(HL_WITHDRAWAL + arbTx + solTx),
    "hyperevm→ethereum":     r(HL_WITHDRAWAL + arbTx + ethMint),
    "hyperevm→arbitrum":     r(HL_WITHDRAWAL + arbTx),
    "hyperevm→base":         r(HL_WITHDRAWAL + arbTx + arbTx),

    // HL L1 (spot) ↔ HyperEVM — internal bridge, just HyperEVM gas
    "hyperliquid→hyperevm":  r(hyperevmTx),
    "hyperevm→hyperliquid":  r(hyperevmTx),

    // HL L1 → external: withdraw to Arbitrum ($1) then CCTP if needed
    "hyperliquid→arbitrum":  r(HL_WITHDRAWAL + arbTx),
    "hyperliquid→ethereum":  r(HL_WITHDRAWAL + arbTx + ethMint),
    "hyperliquid→base":      r(HL_WITHDRAWAL + arbTx + arbTx),
    "hyperliquid→solana":    r(HL_WITHDRAWAL + arbTx + solTx),

    // External → HL L1: CCTP to Arbitrum then free HL deposit
    "arbitrum→hyperliquid":  r(arbTx),
    "ethereum→hyperliquid":  r(ethBurn + arbTx),
    "base→hyperliquid":      r(arbTx + arbTx),
    "solana→hyperliquid":    r(solTx + arbTx),
  };

  // Wormhole USDT direct bridges (non-CCTP, more expensive)
  // These are the costs when bridging USDT without first swapping to USDC.
  // In practice, swapping USDT→USDC then CCTP is usually cheaper for L2 destinations.
  const wormhole: Record<string, number> = {
    "solana→ethereum":   r(6.00),   // Wormhole relay + ETH mint gas
    "solana→arbitrum":   r(2.50),   // Wormhole to L2
    "solana→base":       r(2.50),
    "solana→hyperevm":   r(3.00),   // Wormhole to Arb + HL bridge
    "ethereum→solana":   r(ethBurn + 3.00), // ETH burn + Wormhole relay
    "ethereum→arbitrum": r(ethBurn + arbTx),
    "ethereum→base":     r(ethBurn + arbTx),
    "arbitrum→solana":   r(arbTx + 2.50),
    "arbitrum→ethereum": r(arbTx + ethMint + 1.50), // Stargate/Hop fee
    "arbitrum→base":     r(1.50),   // Stargate USDT
    "base→arbitrum":     r(1.50),
    "base→ethereum":     r(arbTx + ethMint + 1.50),
    "hyperevm→arbitrum": r(HL_WITHDRAWAL + arbTx),
    "hyperevm→solana":   r(HL_WITHDRAWAL + arbTx + 2.50),
  };

  // Stablecoin DEX swap fee rates (fraction, e.g. 0.001 = 0.1%)
  const swap_fees: Record<string, number> = {
    solana:      0.0010, // 0.10% — Jupiter aggregator platform fee
    ethereum:    0.0004, // 0.04% — Curve 3pool
    arbitrum:    0.0001, // 0.01% — Uniswap V3 0.01% tier (USDC/USDT pool)
    base:        0.0001, // 0.01% — Uniswap V3 0.01% tier
    hyperevm:    0.0005, // 0.05% — estimate (less DEX liquidity)
    hyperliquid: 0.0002, // 0.02% — HL spot CLOB
  };

  return {
    cctp,
    wormhole,
    swap_fees,
    hl_withdrawal_usd: HL_WITHDRAWAL,
    hl_hyperevm_tx_usd: r(hyperevmTx),
    eth_gas_gwei: Math.round(ethGwei * 100) / 100,
    eth_usd: Math.round(ethUsd),
    hype_usd: Math.round(hypeUsd * 100) / 100,
  };
}

// ─── Route cost calculator ────────────────────────────────────────────────────

/**
 * Computes the cheapest route to move `amountUsd` of `fromAsset` on `fromChain`
 * to `toAsset` on `toChain`.
 *
 * Strategy:
 *  1. Same chain + same asset → free
 *  2. Same chain, different asset → DEX swap only
 *  3. USDC → USDC, different chains → CCTP
 *  4. USDT → USDT, different chains → compare Wormhole vs (swap→CCTP→swap)
 *  5. Mixed assets, different chains → swap to USDC on cheaper chain + CCTP + swap if needed
 */
export function getRouteCost(
  fromChain: ChainId,
  toChain: ChainId,
  fromAsset: string,
  toAsset: string,
  amountUsd: number,
  costs: BridgeCosts
): RouteCost {
  const fa = normalizeAsset(fromAsset);
  const ta = normalizeAsset(toAsset);
  const sameChain = fromChain === toChain;
  const sameAsset = fa === ta;
  const swapSrc = costs.swap_fees[fromChain] ?? 0.001;
  const swapDst = costs.swap_fees[toChain] ?? 0.001;
  const r = (n: number) => Math.round(n * 100) / 100;
  const fmtPct = (f: number) => `${(f * 100).toFixed(2)}%`;

  // ── Case 1: same chain, same asset ──
  if (sameChain && sameAsset) {
    return { total_usd: 0, bridge_usd: 0, swap_usd: 0, method: "–", notes: [] };
  }

  // ── Case 2: same chain, different asset → DEX swap ──
  if (sameChain && !sameAsset) {
    const fee = r(amountUsd * swapSrc);
    return {
      total_usd: fee, bridge_usd: 0, swap_usd: fee,
      method: `Swap ${fa}→${ta}`,
      notes: [`DEX swap ${fa}→${ta} na ${fromChain} (${fmtPct(swapSrc)}) = $${fee}`],
    };
  }

  // ── Case 3: different chains ──
  const bridgeKey = `${fromChain}→${toChain}`;
  const cctpCost = costs.cctp[bridgeKey] ?? 5;

  // 3a. USDC → USDC via CCTP
  if (CCTP_ASSETS.has(fa) && CCTP_ASSETS.has(ta)) {
    const notes = [`CCTP USDC bridge ${fromChain}→${toChain}: $${cctpCost}`];
    if (fromChain === "hyperevm") notes.push(`(zahrnuje HL withdrawal fee $${costs.hl_withdrawal_usd})`);
    return { total_usd: cctpCost, bridge_usd: cctpCost, swap_usd: 0, method: "CCTP", notes };
  }

  // 3b. USDT → USDT: compare Wormhole direct vs Swap→CCTP→Swap
  if (fa === "USDT" && ta === "USDT") {
    const swapSrcCost = r(amountUsd * swapSrc);
    const swapDstCost = r(amountUsd * swapDst);
    const viaSwap = r(swapSrcCost + cctpCost + swapDstCost);
    const viaWorm = costs.wormhole[bridgeKey] ?? 99;

    if (viaSwap <= viaWorm) {
      return {
        total_usd: viaSwap, bridge_usd: cctpCost, swap_usd: r(swapSrcCost + swapDstCost),
        method: "Swap→CCTP→Swap",
        notes: [
          `Swap USDT→USDC na ${fromChain} (${fmtPct(swapSrc)}) = $${swapSrcCost}`,
          `CCTP bridge ${fromChain}→${toChain}: $${cctpCost}`,
          `Swap USDC→USDT na ${toChain} (${fmtPct(swapDst)}) = $${swapDstCost}`,
          `(Wormhole přímý: $${viaWorm} — dražší)`,
        ],
      };
    } else {
      return {
        total_usd: viaWorm, bridge_usd: viaWorm, swap_usd: 0,
        method: "Wormhole USDT",
        notes: [
          `Wormhole USDT bridge ${fromChain}→${toChain}: $${viaWorm}`,
          `(Swap→CCTP→Swap by stál $${viaSwap} — dražší)`,
        ],
      };
    }
  }

  // 3c. Mixed assets (USDC→USDT or USDT→USDC or others)
  // Strategy: convert to USDC at cheapest point, CCTP, convert to target if needed
  const needSwapSrc = !CCTP_ASSETS.has(fa); // need to swap to USDC on source chain
  const needSwapDst = !CCTP_ASSETS.has(ta); // need to swap USDC to target on dest chain

  const swapSrcCost = needSwapSrc ? r(amountUsd * swapSrc) : 0;
  const swapDstCost = needSwapDst ? r(amountUsd * swapDst) : 0;
  const total = r(swapSrcCost + cctpCost + swapDstCost);

  const method = [
    needSwapSrc ? `Swap→` : "",
    "CCTP",
    needSwapDst ? `→Swap` : "",
  ].join("");

  const notes: string[] = [];
  if (needSwapSrc)
    notes.push(`Swap ${fa}→USDC na ${fromChain} (${fmtPct(swapSrc)}) = $${swapSrcCost}`);
  notes.push(`CCTP bridge ${fromChain}→${toChain}: $${cctpCost}`);
  if (needSwapDst)
    notes.push(`Swap USDC→${ta} na ${toChain} (${fmtPct(swapDst)}) = $${swapDstCost}`);

  return { total_usd: total, bridge_usd: cctpCost, swap_usd: r(swapSrcCost + swapDstCost), method, notes };
}

// ─── Kamino ────────────────────────────────────────────────────────────────────

const KAMINO_MARKETS = [
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek",
  "ByYiZxp8QrdN9ocx5rvzDPGRDceL34WE4f2YsUjSpump",
];

async function fetchKaminoRates(): Promise<YieldRate[]> {
  const rates: YieldRate[] = [];
  const seen = new Set<string>();
  await Promise.all(
    KAMINO_MARKETS.map(async (market) => {
      try {
        const res = await fetch(
          `https://api.kamino.finance/kamino-market/${market}/reserves/metrics`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!res.ok) return;
        const data: Array<{ liquidityToken: string; supplyApy: string; borrowApy: string }> =
          await res.json();
        for (const r of data) {
          const isStableAsset = STABLE_ASSETS.has(r.liquidityToken);
          const isNativeAsset = isNative(r.liquidityToken);
          if (!isStableAsset && !isNativeAsset) continue;
          const key = `kamino:solana:${r.liquidityToken}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rates.push({
            protocol: "kamino",
            chain: "solana",
            asset: r.liquidityToken,
            supply_apy: parseFloat(r.supplyApy) * 100,
            borrow_apy: parseFloat(r.borrowApy) * 100,
            type: "variable",
            category: isNativeAsset ? "native" : "stable",
          });
        }
      } catch { /* skip */ }
    })
  );
  return rates;
}

// ─── Aave V3-fork (rayToApy) ──────────────────────────────────────────────────

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000n;

function rayToApy(rayRate: bigint): number {
  const ratePerSecond = Number(rayRate) / Number(RAY) / Number(SECONDS_PER_YEAR);
  return (Math.pow(1 + ratePerSecond, Number(SECONDS_PER_YEAR)) - 1) * 100;
}

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
  "function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

// Public RPC fallbacks when Alchemy key is not configured
const PUBLIC_RPC: Record<string, string> = {
  ethereum: "https://eth.llamarpc.com",
  base:     "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

function alchemyRpc(chain: string): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (key) {
    const pfx: Record<string, string> = {
      ethereum: "eth-mainnet", base: "base-mainnet", arbitrum: "arb-mainnet",
    };
    return `https://${pfx[chain]}.g.alchemy.com/v2/${key}`;
  }
  return PUBLIC_RPC[chain] ?? "https://eth.llamarpc.com";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIEM_CHAINS: Record<string, any> = { ethereum: mainnet, base, arbitrum };

async function fetchAaveForkedRates(
  protocol: ProtocolId,
  chain: ChainId,
  dataProvider: `0x${string}`,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viemChain: any,
  transport: ReturnType<typeof http>
): Promise<YieldRate[]> {
  const rates: YieldRate[] = [];
  const client = createPublicClient({ chain: viemChain, transport });
  try {
    const reserves = (await client.readContract({
      address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getAllReservesTokens",
    })) as Array<{ symbol: string; tokenAddress: string }>;

    const assets = reserves.filter((r) => STABLE_ASSETS.has(r.symbol) || isNative(r.symbol));
    if (!assets.length) return rates;

    type MC = { status: "success" | "failure"; result?: unknown };
    const batch = (await client.multicall({
      contracts: assets.map((r) => ({
        address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getReserveData" as const,
        args: [r.tokenAddress as `0x${string}`],
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    for (let i = 0; i < assets.length; i++) {
      const rd = (batch[i]?.status === "success" ? batch[i].result : null) as bigint[] | null;
      if (!rd) continue;
      const supplyApy = rayToApy(rd[5] as bigint);
      const isNativeAsset = isNative(assets[i].symbol);
      // Skip zero-APY stablecoins; native tokens shown even with low APY (informative)
      if (!isNativeAsset && supplyApy < 0.01) continue;
      if (isNativeAsset && supplyApy <= 0) continue;
      rates.push({
        protocol, chain,
        asset: assets[i].symbol,
        supply_apy: supplyApy,
        borrow_apy: rayToApy(rd[6] as bigint),
        type: "variable",
        category: isNativeAsset ? "native" : "stable",
      });
    }
  } catch { /* skip */ }
  return rates;
}

const AAVE_PROVIDERS: Record<string, `0x${string}`> = {
  ethereum: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
  base:     "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
  arbitrum: "0x6b4E260b765B3cA1514e618C0215A6B7839fF93e",
};

async function fetchAaveRates(chain: "ethereum" | "base" | "arbitrum"): Promise<YieldRate[]> {
  return fetchAaveForkedRates(
    "aave", chain as ChainId, AAVE_PROVIDERS[chain], VIEM_CHAINS[chain], http(alchemyRpc(chain))
  );
}

const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";
const HYPERLEND_PROVIDER = "0x5481bf8d3946E6A3168640c1D7523eB59F055a29" as const;
const hyperevmChain = defineChain({
  id: 999, name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPEREVM_RPC] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

async function fetchHyperlendRates(): Promise<YieldRate[]> {
  return fetchAaveForkedRates(
    "hyperlend", "hyperevm", HYPERLEND_PROVIDER, hyperevmChain, http(HYPEREVM_RPC, { timeout: 20_000 })
  );
}

// ─── Pendle ───────────────────────────────────────────────────────────────────

const PENDLE_STABLE_TOKENS = [
  "USDC", "USDT", "DAI", "USDS", "FRAX", "LUSD", "CRVUSD",
  "PYUSD", "GHO", "USDE", "SUSDE", "FEUSD", "SDAI",
];

function extractPendleUnderlying(marketName: string): string | null {
  const upper = marketName.toUpperCase();
  for (const t of PENDLE_STABLE_TOKENS) {
    if (upper.includes(t)) {
      if (t === "SUSDE") return "sUSDe";
      if (t === "CRVUSD") return "crvUSD";
      if (t === "FEUSD") return "feUSD";
      if (t === "SDAI") return "DAI";
      return t;
    }
  }
  return null;
}

// All ETH LSTs/LRTs collapse to "ETH" — the underlying native token
// Ordered so longer tokens are checked first to avoid false matches (WSTETH before STETH)
const PENDLE_NATIVE_ORDER: Array<[string, string]> = [
  ["WEETH",  "ETH"],
  ["EZETH",  "ETH"],
  ["RSETH",  "ETH"],
  ["WSTETH", "ETH"],
  ["STETH",  "ETH"],
  ["CBETH",  "ETH"],
  ["RETH",   "ETH"],
  ["EETH",   "ETH"],
  ["WBTC",   "BTC"],
  ["WETH",   "ETH"],
  ["HYPE",   "HYPE"],
  ["BTC",    "BTC"],
  ["SOL",    "SOL"],
  ["ETH",    "ETH"],
];

function extractPendleNative(marketName: string): string | null {
  const upper = marketName.toUpperCase();
  for (const [key, canonical] of PENDLE_NATIVE_ORDER) {
    if (upper.includes(key)) return canonical;
  }
  return null;
}

interface PendleMarket {
  name: string;
  expiry: string;
  details: {
    liquidity: number;
    impliedApy: number;
    aggregatedApy: number;
  };
  categoryIds?: string[];
}

const PENDLE_CHAIN_MAP: Array<{ chainId: number; chain: ChainId }> = [
  { chainId: 1,     chain: "ethereum" },
  { chainId: 42161, chain: "arbitrum" },
  { chainId: 999,   chain: "hyperevm" },
];

async function fetchPendleRates(): Promise<YieldRate[]> {
  const stableRates: YieldRate[] = [];
  // Native: collect best PT per (chain, asset) — many LST markets map to same base token
  const nativePTBest = new Map<string, YieldRate>(); // key: chain:asset

  await Promise.all(
    PENDLE_CHAIN_MAP.map(async ({ chainId, chain }) => {
      try {
        const res = await fetch(
          `https://api-v2.pendle.finance/core/v1/${chainId}/markets/active?order_by=liquidity:1&limit=200`,
          { signal: AbortSignal.timeout(12_000) }
        );
        if (!res.ok) return;
        const data: { results?: PendleMarket[] } = await res.json();

        for (const market of data.results ?? []) {
          if (market.details?.liquidity < 50_000) continue;
          if (market.expiry && new Date(market.expiry) < new Date()) continue;

          const ptApy = (market.details?.impliedApy   ?? 0) * 100;
          const lpApy = (market.details?.aggregatedApy ?? 0) * 100;

          // Try stable first
          const stableUnderlying = extractPendleUnderlying(market.name);
          const isStableCat = (market.categoryIds ?? []).some((c) =>
            c.toLowerCase().includes("stable")
          );

          if (stableUnderlying || isStableCat) {
            const asset = stableUnderlying ?? "USDC";
            if (ptApy >= 0.5) stableRates.push({
              protocol: "pendle", chain, asset, category: "stable",
              supply_apy: ptApy, borrow_apy: 0,
              type: "fixed", maturity: market.expiry,
              liquidity_usd: market.details.liquidity,
            });
            if (lpApy >= 0.5) stableRates.push({
              protocol: "pendle", chain, asset: `LP-${asset}`, category: "stable",
              supply_apy: lpApy, borrow_apy: 0,
              type: "variable", maturity: market.expiry,
              liquidity_usd: market.details.liquidity,
            });
            continue;
          }

          // Native (ETH, BTC, SOL, HYPE) — all ETH LSTs already mapped to "ETH"
          const nativeUnderlying = extractPendleNative(market.name);
          const isNativeCat = (market.categoryIds ?? []).some((c) =>
            ["eth", "btc", "sol", "hype", "lst", "lrt"].some((n) => c.toLowerCase().includes(n))
          );
          if (!nativeUnderlying && !isNativeCat) continue;

          const asset = nativeUnderlying ?? "ETH";
          // Keep only best APY PT per (chain, asset) — many LSTs map to same base
          if (ptApy >= 0.5) {
            const key = `${chain}:${asset}`;
            const ex = nativePTBest.get(key);
            if (!ex || ptApy > ex.supply_apy) {
              nativePTBest.set(key, {
                protocol: "pendle", chain, asset, category: "native",
                supply_apy: ptApy, borrow_apy: 0,
                type: "fixed", maturity: market.expiry,
                liquidity_usd: market.details.liquidity,
              });
            }
          }
          // Skip LP for native — too complex for the native staking view
        }
      } catch { /* skip chain */ }
    })
  );

  return [...stableRates, ...nativePTBest.values()];
}

// ─── Delta Neutral (Hyperliquid basis trade) ──────────────────────────────────

// ─── Delta Neutral + Price Arbitrage ─────────────────────────────────────────
//
// Two delta neutral strategy types:
//  1. Perps / Spot  — long spot + short perp on HL. Earn funding if longs pay.
//  2. Perps / Perps — short on exchange with higher funding, long on lower.
//
// Fee constants per leg (one-way):
//  HL taker (spot + perp):   0.035%
//  Lighter taker:            varies per market (BTC=0%, ETH≈0.05%); use 0.05% conservative
//
// Round-trip (open + close both legs):
//  Perps/Spot (HL only):           4 × 0.035% = 0.14%
//  Perps/Perps (HL + Lighter):     2 × (0.035% + 0.05%) = 0.17%
//
// Price arbitrage (HL perp vs Lighter perp):
//  RT fee = 2 × (HL_TAKER + LIGHTER_TAKER) = 0.17%
//  Minimum profitable spread: > 0.17%
//
// Lighter markets (market_id): ETH=0, BTC=1, SOL=2, HYPE=24
// Rate convention: 8h rate as decimal (same for HL and Lighter APIs).

const MAJOR_ASSETS      = new Set(["BTC", "ETH", "SOL", "HYPE"]);
const ARB_ASSETS        = ["BTC", "ETH", "SOL", "HYPE"] as const;
const HL_TAKER          = 0.035; // 0.035% taker per leg (spot + perp same rate on HL)
const LIGHTER_TAKER     = 0.05;  // 0.05% taker per leg (conservative; BTC is actually 0%)
/** Standard position size (capital) for all fee/profit calculations shown in UI */
export const POSITION_SIZE_USD = 100_000;
/** Leverage multiplier for delta neutral strategies — doubles notional and income */
export const LEVERAGE_DN = 2;

/** Lighter perp market IDs (confirmed from GET /api/v1/orderBooks) */
const LIGHTER_MARKET_IDS: Record<string, number> = { ETH: 0, BTC: 1, SOL: 2, HYPE: 24 };

export interface VenueFunding {
  venue: "hyperliquid" | "lighter";
  funding_8h_pct: number;  // e.g. 0.0100 = 0.01 per 8h
  oi_usd: number;
  mark_price_usd?: number;
}

export interface DeltaNeutralStrategy {
  type: "perps_spot" | "perps_perps";
  /** Human label for the two legs */
  label: string;
  venue_long: string;   // e.g. "HL Spot", "Lighter Perp"
  venue_short: string;  // e.g. "HL Perp"
  /** Daily income as % of notional (net funding differential) */
  daily_income_pct: number;
  /** Daily income in USD for POSITION_SIZE_USD */
  daily_income_usd: number;
  annual_apy: number;
  /** Annual yield in USD for POSITION_SIZE_USD */
  annual_yield_usd: number;
  /** Full round-trip fee as fraction (e.g. 0.0014 = 0.14%) — open + close both legs */
  total_fee_pct: number;
  /** RT fee in USD for POSITION_SIZE_USD */
  rt_fee_usd: number;
  /** null = not viable (funding negative/zero) */
  breakeven_days: number | null;
  /** APY 1 hour ago — null if no historical data yet */
  apy_1h: number | null;
  /** APY 24 hours ago — null if no historical data yet */
  apy_24h: number | null;
}

export interface DeltaNeutralAsset {
  asset: string;
  hl: VenueFunding | null;
  lighter: VenueFunding | null;
  /** Strategies sorted by breakeven_days ascending */
  strategies: DeltaNeutralStrategy[];
}

function r4(n: number) { return Math.round(n * 10000) / 10000; }

function dailyToApy(daily: number): number {
  return r4(daily * 365 * LEVERAGE_DN);
}

function histApy(
  type: "perps_spot" | "perps_perps",
  venueShort: string,
  hl: number | null,
  lighter: number | null
): number | null {
  if (type === "perps_spot") return hl !== null ? dailyToApy(r4(hl * 3)) : null;
  if (hl === null || lighter === null) return null;
  return venueShort === "HL Perp"
    ? dailyToApy(r4((hl - lighter) * 3))
    : dailyToApy(r4((lighter - hl) * 3));
}

function computeDNStrategies(
  asset: string,
  hl: VenueFunding | null,
  lighter: VenueFunding | null,
  hist?: {
    hl1h: number | null; lighter1h: number | null;
    hl24h: number | null; lighter24h: number | null;
  }
): DeltaNeutralStrategy[] {
  const strategies: DeltaNeutralStrategy[] = [];

  // Effective notional = capital × leverage (e.g. $100k × 2 = $200k)
  const notional = POSITION_SIZE_USD * LEVERAGE_DN;

  function makeStrategy(
    type: "perps_spot" | "perps_perps",
    label: string,
    venueLong: string,
    venueShort: string,
    daily: number,    // daily income in % of notional (e.g. 0.03 means 0.03%/day)
    totalFee: number  // RT fee as fraction of notional (e.g. 0.0014 = 0.14%)
  ): DeltaNeutralStrategy {
    const annualApyOnCapital = dailyToApy(daily);
    const breakevenDays = daily > 0 ? r4((totalFee * 100) / daily) : null;
    const apy_1h  = hist ? histApy(type, venueShort, hist.hl1h,  hist.lighter1h)  : null;
    const apy_24h = hist ? histApy(type, venueShort, hist.hl24h, hist.lighter24h) : null;
    return {
      type,
      label,
      venue_long: venueLong,
      venue_short: venueShort,
      daily_income_pct: daily,
      daily_income_usd: r4((daily / 100) * notional),
      annual_apy: annualApyOnCapital,
      annual_yield_usd: Math.round((daily * 365 / 100) * notional),
      total_fee_pct: totalFee,
      rt_fee_usd: Math.round(totalFee * notional),
      breakeven_days: breakevenDays,
      apy_1h,
      apy_24h,
    };
  }

  // ── Strategy A: Perps/Spot on HL ──
  // Long HL spot + Short HL perp. Earn funding when longs pay shorts.
  // RT fee: 2 × (HL_spot_taker + HL_perp_taker) — open both legs + close both legs
  //         = 2 × (0.035% + 0.035%) = 0.14%
  if (hl) {
    strategies.push(makeStrategy(
      "perps_spot",
      `${asset} Spot long + ${asset} Perp short (HL)`,
      "HL Spot", "HL Perp",
      r4(hl.funding_8h_pct * 3),
      r4(2 * (HL_TAKER + HL_TAKER) / 100) // 0.14%
    ));
  }

  // ── Strategy B: Perps/Perps — HL short + Lighter long ──
  // Earn the spread when HL funding > Lighter funding.
  // RT fee: 2 × (HL_perp_taker + Lighter_perp_taker) — open both legs + close both legs
  //         = 2 × (0.035% + 0.05%) = 0.17%
  if (hl && lighter) {
    strategies.push(makeStrategy(
      "perps_perps",
      `HL ${asset} Perp short + Lighter ${asset} Perp long`,
      "Lighter Perp", "HL Perp",
      r4((hl.funding_8h_pct - lighter.funding_8h_pct) * 3),
      r4(2 * (HL_TAKER + LIGHTER_TAKER) / 100) // 0.17%
    ));
  }

  // ── Strategy C: Perps/Perps — Lighter short + HL long ──
  // Earn the spread when Lighter funding > HL funding.
  // RT fee: same 2 × (HL + Lighter) = 0.17%
  if (hl && lighter) {
    strategies.push(makeStrategy(
      "perps_perps",
      `Lighter ${asset} Perp short + HL ${asset} Perp long`,
      "HL Perp", "Lighter Perp",
      r4((lighter.funding_8h_pct - hl.funding_8h_pct) * 3),
      r4(2 * (HL_TAKER + LIGHTER_TAKER) / 100) // 0.17%
    ));
  }

  // Sort: viable first (by breakeven asc), non-viable last
  return strategies.sort((a, b) => {
    if (a.breakeven_days === null && b.breakeven_days === null) return 0;
    if (a.breakeven_days === null) return 1;
    if (b.breakeven_days === null) return -1;
    return a.breakeven_days - b.breakeven_days;
  });
}

async function fetchHLFundingMajors(): Promise<VenueFunding[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HL API ${res.status}`);

  const [meta, ctxs] = (await res.json()) as [
    { universe: Array<{ name: string }> },
    Array<{ funding: string; openInterest: string; markPx: string }>,
  ];

  const results: VenueFunding[] = [];
  for (let i = 0; i < meta.universe.length; i++) {
    const name = meta.universe[i].name;
    if (!MAJOR_ASSETS.has(name)) continue;
    const ctx = ctxs[i];
    if (!ctx?.markPx) continue;
    const markPx = parseFloat(ctx.markPx);
    results.push({
      venue: "hyperliquid",
      funding_8h_pct: r4(parseFloat(ctx.funding ?? "0") * 100),
      oi_usd: Math.round(parseFloat(ctx.openInterest) * markPx),
      mark_price_usd: markPx,
    });
    // Attach asset name via parallel array — returned as map keyed by asset
    (results[results.length - 1] as VenueFunding & { _asset: string })._asset = name;
  }
  return results;
}

/** Normalise Lighter symbol like "BTC-USD", "BTC/USDC", "BTCUSD" → "BTC" */
function normalizeLighterSymbol(sym: string): string {
  return sym.toUpperCase()
    .replace(/-?(USD[CT]?|PERP|USD)$/i, "")
    .replace(/[^A-Z]/g, "");
}

async function fetchLighterFundingMajors(): Promise<Map<string, VenueFunding>> {
  const res = await fetch("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Lighter API ${res.status}`);

  const data = (await res.json()) as {
    funding_rates: Array<{ market_id: number; exchange: string; symbol: string; rate: number }>;
  };

  const map = new Map<string, VenueFunding>();
  for (const fr of data.funding_rates) {
    if (fr.exchange !== "lighter") continue;
    const asset = normalizeLighterSymbol(fr.symbol);
    if (!MAJOR_ASSETS.has(asset)) continue;
    map.set(asset, {
      venue: "lighter",
      // rate is 8h decimal (same convention as HL); multiply by 100 → %
      funding_8h_pct: r4(fr.rate * 100),
      oi_usd: 0, // not provided in this endpoint
    });
  }
  return map;
}

// ─── Price Arbitrage (HL perp vs Lighter perp) ───────────────────────────────

export interface PriceArbitrage {
  asset: string;
  hl_price: number | null;
  lighter_price: number | null;
  /** |(hl − lighter)| / avg × 100  (in % units, e.g. 0.17 means 0.17%) */
  spread_pct: number | null;
  /** spread_pct − rt_fee_pct  (in % units) */
  net_pct: number | null;
  /** Net profit in USD for POSITION_SIZE_USD position */
  net_usd: number | null;
  /** Total round-trip fee in % units (e.g. 0.17 means 0.17%) */
  rt_fee_pct: number;
  /** RT fee in USD for POSITION_SIZE_USD position */
  rt_fee_usd: number;
  direction: "short_hl_long_lighter" | "short_lighter_long_hl" | null;
  profitable: boolean;
}

async function fetchHLMarkPrices(): Promise<Map<string, number>> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HL allMids ${res.status}`);
  const mids = (await res.json()) as Record<string, string>;
  const out = new Map<string, number>();
  for (const asset of ARB_ASSETS) {
    const p = parseFloat(mids[asset] ?? "0");
    if (p > 0) out.set(asset, p);
  }
  return out;
}

/** Fetch per-market taker fee from Lighter orderBooks API. */
async function fetchLighterMarketFees(): Promise<Map<string, number>> {
  const res = await fetch("https://mainnet.zklighter.elliot.ai/api/v1/orderBooks", {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Lighter orderBooks ${res.status}`);
  const data = (await res.json()) as {
    order_books: Array<{ market_id: number; taker_fee: string }>;
  };
  const out = new Map<string, number>();
  for (const [asset, marketId] of Object.entries(LIGHTER_MARKET_IDS)) {
    const book = data.order_books.find((b) => b.market_id === marketId);
    if (book) out.set(asset, parseFloat(book.taker_fee) * 100); // decimal → %
  }
  return out;
}

/** Fetch mid prices for major assets from Lighter order book. */
async function fetchLighterMidPrices(): Promise<Map<string, number>> {
  const entries = await Promise.allSettled(
    Object.entries(LIGHTER_MARKET_IDS).map(async ([asset, marketId]) => {
      const res = await fetch(
        `https://mainnet.zklighter.elliot.ai/api/v1/orderBookOrders?market_id=${marketId}&side=bid&limit=1`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) throw new Error(`Lighter orders ${res.status}`);
      const d = (await res.json()) as {
        bids: Array<{ price: string }>;
        asks: Array<{ price: string }>;
      };
      const bid = parseFloat(d.bids?.[0]?.price ?? "0");
      const ask = parseFloat(d.asks?.[0]?.price ?? "0");
      if (!bid || !ask) throw new Error("empty book");
      return { asset, mid: (bid + ask) / 2 };
    })
  );
  const out = new Map<string, number>();
  for (const r of entries) {
    if (r.status === "fulfilled") out.set(r.value.asset, r.value.mid);
  }
  return out;
}

export async function fetchPriceArbitrage(): Promise<PriceArbitrage[]> {
  const [hlRes, lighterRes, feesRes] = await Promise.allSettled([
    fetchHLMarkPrices(),
    fetchLighterMidPrices(),
    fetchLighterMarketFees(),
  ]);

  const hlPrices      = hlRes.status === "fulfilled"     ? hlRes.value     : new Map<string, number>();
  const lighterPrices = lighterRes.status === "fulfilled" ? lighterRes.value : new Map<string, number>();
  const lighterFees   = feesRes.status === "fulfilled"   ? feesRes.value   : new Map<string, number>();

  const results = ARB_ASSETS.map((asset) => {
    const hlPrice      = hlPrices.get(asset) ?? null;
    const lighterPrice = lighterPrices.get(asset) ?? null;
    const lTaker       = lighterFees.get(asset) ?? LIGHTER_TAKER;
    const rtFee    = r4(HL_TAKER * 2 + lTaker * 2);
    const rtFeeUsd = Math.round((rtFee / 100) * POSITION_SIZE_USD);

    if (!hlPrice || !lighterPrice) {
      return { asset, hl_price: hlPrice, lighter_price: lighterPrice,
               spread_pct: null, net_pct: null, net_usd: null,
               rt_fee_pct: rtFee, rt_fee_usd: rtFeeUsd,
               direction: null, profitable: false } as PriceArbitrage;
    }

    const avg       = (hlPrice + lighterPrice) / 2;
    const spread    = r4(Math.abs(hlPrice - lighterPrice) / avg * 100);
    const net       = r4(spread - rtFee);
    const netUsd    = Math.round((net / 100) * POSITION_SIZE_USD);
    const direction = hlPrice > lighterPrice ? "short_hl_long_lighter" : "short_lighter_long_hl";
    return { asset, hl_price: hlPrice, lighter_price: lighterPrice,
             spread_pct: spread, net_pct: net, net_usd: netUsd,
             rt_fee_pct: rtFee, rt_fee_usd: rtFeeUsd,
             direction, profitable: net > 0 } as PriceArbitrage;
  });

  // Persist to DB (throttled)
  try {
    const { shouldSavePriceArb, savePriceArbHistory } = await import("@/lib/db");
    if (shouldSavePriceArb()) {
      const now = new Date().toISOString();
      const records = results
        .filter((r) => r.hl_price !== null && r.lighter_price !== null && r.spread_pct !== null)
        .map((r) => ({
          asset: r.asset, hl_price: r.hl_price!, lt_price: r.lighter_price!,
          spread_pct: r.spread_pct!, net_pct: r.net_pct!, fetched_at: now,
        }));
      if (records.length) savePriceArbHistory(records);
    }
  } catch { /* DB unavailable */ }

  return results;
}

export async function fetchDeltaNeutralData(): Promise<DeltaNeutralAsset[]> {
  const [hlRes, lighterRes] = await Promise.allSettled([
    fetchHLFundingMajors(),
    fetchLighterFundingMajors(),
  ]);

  // Build HL map: asset → VenueFunding
  const hlMap = new Map<string, VenueFunding>();
  if (hlRes.status === "fulfilled") {
    for (const f of hlRes.value) {
      const asset = (f as VenueFunding & { _asset?: string })._asset;
      if (asset) hlMap.set(asset, f);
    }
  }

  const lighterMap = lighterRes.status === "fulfilled" ? lighterRes.value : new Map();

  // ── Persist to DB (throttled) + lookup historical rates ──────────────────
  try {
    const { shouldSaveFunding, saveFundingHistory, getFundingNear } = await import("@/lib/db");
    const now = new Date().toISOString();

    if (shouldSaveFunding()) {
      const records: { asset: string; venue: string; rate_8h: number; fetched_at: string }[] = [];
      for (const asset of MAJOR_ASSETS) {
        const hl = hlMap.get(asset);
        const lt = lighterMap.get(asset);
        if (hl) records.push({ asset, venue: "hyperliquid", rate_8h: hl.funding_8h_pct, fetched_at: now });
        if (lt) records.push({ asset, venue: "lighter",     rate_8h: lt.funding_8h_pct, fetched_at: now });
      }
      if (records.length) saveFundingHistory(records);
    }

    const t1h  = new Date(Date.now() - 3_600_000).toISOString();
    const t24h = new Date(Date.now() - 86_400_000).toISOString();

    return Array.from(MAJOR_ASSETS).map((asset) => {
      const hl = hlMap.get(asset) ?? null;
      const lighter = lighterMap.get(asset) ?? null;
      const hist = {
        hl1h:       getFundingNear(asset, "hyperliquid", t1h),
        lighter1h:  getFundingNear(asset, "lighter",     t1h),
        hl24h:      getFundingNear(asset, "hyperliquid", t24h),
        lighter24h: getFundingNear(asset, "lighter",     t24h),
      };
      return { asset, hl, lighter, strategies: computeDNStrategies(asset, hl, lighter, hist) };
    });
  } catch {
    // DB unavailable — return without historical data
    return Array.from(MAJOR_ASSETS).map((asset) => {
      const hl = hlMap.get(asset) ?? null;
      const lighter = lighterMap.get(asset) ?? null;
      return { asset, hl, lighter, strategies: computeDNStrategies(asset, hl, lighter) };
    });
  }
}

// ─── Drift lending rates ──────────────────────────────────────────────────────
//
// API: https://data.api.drift.trade/stats/{symbol}/rateHistory/deposit|borrow
// Returns: { success: true, rates: [[unixTs, "0.0345"], ...] }  (ascending by time)
// The last entry is the most recent rate.

async function fetchDriftRates(): Promise<YieldRate[]> {
  const SYMBOLS = ["USDC", "USDT"];
  const rates: YieldRate[] = [];

  await Promise.allSettled(
    SYMBOLS.map(async (symbol) => {
      try {
        const [depRes, borRes] = await Promise.allSettled([
          fetch(`https://data.api.drift.trade/stats/${symbol}/rateHistory/deposit`, {
            signal: AbortSignal.timeout(8_000),
          }),
          fetch(`https://data.api.drift.trade/stats/${symbol}/rateHistory/borrow`, {
            signal: AbortSignal.timeout(8_000),
          }),
        ]);

        if (depRes.status !== "fulfilled" || !depRes.value.ok) return;
        const depData = (await depRes.value.json()) as {
          success: boolean;
          rates: [number, string][];
        };
        if (!depData.success || !depData.rates?.length) return;

        // Last entry = most recent (ascending order)
        const depositApy = parseFloat(depData.rates[depData.rates.length - 1][1]) * 100;
        if (depositApy < 0.01) return;

        let borrowApy = 0;
        if (borRes.status === "fulfilled" && borRes.value.ok) {
          const borData = (await borRes.value.json()) as {
            success: boolean;
            rates: [number, string][];
          };
          if (borData.success && borData.rates?.length) {
            borrowApy = parseFloat(borData.rates[borData.rates.length - 1][1]) * 100;
          }
        }

        rates.push({
          protocol: "drift" as ProtocolId,
          chain: "solana" as ChainId,
          asset: symbol,
          supply_apy: depositApy,
          borrow_apy: borrowApy,
          type: "variable",
          risk: "low",
        });
      } catch { /* skip */ }
    })
  );

  return rates;
}

// ─── Kamino CLMM vault rates ──────────────────────────────────────────────────
//
// Kamino's REST API (/strategies) returns basic metadata without APY.
// APY requires fetching per-strategy detail or using the SDK.
// We try the detail endpoint; if it returns APY fields, we use them.
// Falls back to empty array — marked as higher risk (CLMM + IL exposure).

const STABLE_MINTS_SOL = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",  // USDS
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",  // PYUSD
]);

interface KaminoVaultBasic {
  address: string;
  type: string;
  status: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol?: string;
  tokenBSymbol?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractKaminoVaultApy(obj: any): number | null {
  // Try various field names Kamino might use for APY
  const candidates = [
    obj?.apy7d, obj?.apy24h, obj?.apy30d,
    obj?.totalApy, obj?.apyOneDay, obj?.apySevenDay,
    obj?.metrics?.apy7d, obj?.metrics?.apy24h, obj?.metrics?.totalApy,
    obj?.performance?.apy7d, obj?.performance?.apy,
  ];
  for (const v of candidates) {
    if (typeof v === "number" && v > 0) {
      // Normalise: if < 2 assume decimal fraction → multiply by 100
      return v < 2 ? v * 100 : v;
    }
  }
  return null;
}

export async function fetchKaminoVaultRates(): Promise<YieldRate[]> {
  try {
    const res = await fetch(
      "https://api.kamino.finance/strategies?status=LIVE",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];

    const strategies: KaminoVaultBasic[] = await res.json();

    // Keep only PEGGED/STABLE strategies where BOTH tokens are stablecoins
    const stableVaults = strategies.filter(
      (s) =>
        (s.type === "PEGGED" || s.type === "STABLE") &&
        STABLE_MINTS_SOL.has(s.tokenAMint) &&
        STABLE_MINTS_SOL.has(s.tokenBMint)
    );

    if (!stableVaults.length) return [];

    // Attempt to get APY from per-strategy detail endpoint (top 8 by list order)
    const details = await Promise.allSettled(
      stableVaults.slice(0, 8).map((s) =>
        fetch(`https://api.kamino.finance/strategies/${s.address}`, {
          signal: AbortSignal.timeout(8_000),
        }).then((r) => (r.ok ? r.json() : null))
      )
    );

    const rates: YieldRate[] = [];
    for (let i = 0; i < details.length; i++) {
      const r = details[i];
      const detail = r.status === "fulfilled" ? r.value : null;
      const strategy = stableVaults[i];
      const combined = detail ? { ...strategy, ...detail } : strategy;

      const apy = extractKaminoVaultApy(combined);
      if (!apy || apy < 0.5) continue;

      const tokenA = combined.tokenASymbol ?? "USDC";
      const tokenB = combined.tokenBSymbol ?? "USDT";

      rates.push({
        protocol: "kamino" as ProtocolId,
        chain: "solana" as ChainId,
        asset: `${normalizeAsset(tokenA)}/${normalizeAsset(tokenB)}`,
        supply_apy: apy,
        borrow_apy: 0,
        type: "variable",
        risk: "medium",
      });
    }

    return rates;
  } catch {
    return [];
  }
}

// ─── Native liquid staking rates ──────────────────────────────────────────────
//
// Sources:
//   Lido stETH:          https://eth-api.lido.fi/v1/protocol/steth/apr/last → { data: { apr: 0.039 } }
//   Jito jitoSOL:        https://kobe.mainnet.jito.network/api/v1/apy        → decimal APY
//   Marinade mSOL:       https://api.marinade.finance/msol/apy/365d           → decimal APY
//   HYPE (HL staking):   validatorSummaries → compute APY from total staked + estimated emission

async function fetchHypeStakingRate(): Promise<YieldRate | null> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "validatorSummaries" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validators = await res.json() as any[];
    if (!Array.isArray(validators) || !validators.length) return null;

    // Sum total staked across all validators (stake field is in HYPE units)
    const totalStaked = validators.reduce((s: number, v: unknown) => {
      const val = v as { stake?: string | number };
      return s + parseFloat(String(val.stake ?? "0"));
    }, 0);
    if (totalStaked < 1_000_000) return null; // sanity: expect at least 1M HYPE staked

    // Emission: ~2.37% of total supply (1B HYPE) per year ≈ 23.7M HYPE distributed to stakers
    const ANNUAL_EMISSION_HYPE = 23_700_000;
    const apy = Math.min((ANNUAL_EMISSION_HYPE / totalStaked) * 100, 30);
    if (apy < 0.5) return null;

    return {
      protocol: "hyperliquid" as ProtocolId,
      chain: "hyperliquid" as ChainId,
      asset: "HYPE",
      supply_apy: Math.round(apy * 100) / 100,
      borrow_apy: 0,
      type: "variable",
      category: "native",
      risk: "low",
      lockup_days: 7, // ~7-day unbonding period when undelegating from validator
    };
  } catch { return null; }
}

async function fetchNativeStakingRates(): Promise<YieldRate[]> {
  const rates: YieldRate[] = [];
  const [lidoRes, jitoRes, marinadeRes, hypeRes] = await Promise.allSettled([
    fetch("https://eth-api.lido.fi/v1/protocol/steth/apr/last", { signal: AbortSignal.timeout(8_000) }),
    fetch("https://kobe.mainnet.jito.network/api/v1/apy",       { signal: AbortSignal.timeout(8_000) }),
    fetch("https://api.marinade.finance/msol/apy/365d",          { signal: AbortSignal.timeout(8_000) }),
    fetchHypeStakingRate(),
  ]);

  // Lido — stake ETH, receive stETH, ~3-4% APY
  if (lidoRes.status === "fulfilled" && lidoRes.value.ok) {
    try {
      const d = await lidoRes.value.json() as { data?: { apr?: number } };
      const apr = d?.data?.apr;
      if (typeof apr === "number" && apr > 0) {
        rates.push({
          protocol: "lido", chain: "ethereum", asset: "ETH",
          supply_apy: apr * 100, borrow_apy: 0,
          type: "variable", category: "native", risk: "low",
          lockup_days: 0, // stETH is a liquid ERC-20 — tradeable any time
        });
      }
    } catch { /* skip */ }
  }

  // Jito — stake SOL, receive jitoSOL, earns MEV + staking rewards
  if (jitoRes.status === "fulfilled" && jitoRes.value.ok) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await jitoRes.value.json() as any;
      const raw = d?.apy ?? d?.value ?? d?.sevenDayApy ?? d?.apyData?.apy;
      if (typeof raw === "number" && raw > 0) {
        rates.push({
          protocol: "jito", chain: "solana", asset: "SOL",
          supply_apy: raw < 1 ? raw * 100 : raw,
          borrow_apy: 0, type: "variable", category: "native", risk: "low",
          lockup_days: 0, // jitoSOL is liquid — instant unstake via liquidity pool
        });
      }
    } catch { /* skip */ }
  }

  // Marinade — stake SOL, receive mSOL
  if (marinadeRes.status === "fulfilled" && marinadeRes.value.ok) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await marinadeRes.value.json() as any;
      const raw = d?.value ?? d?.apy ?? d?.avgApy;
      if (typeof raw === "number" && raw > 0) {
        rates.push({
          protocol: "marinade", chain: "solana", asset: "SOL",
          supply_apy: raw < 1 ? raw * 100 : raw,
          borrow_apy: 0, type: "variable", category: "native", risk: "low",
          lockup_days: 0, // mSOL is liquid — can be swapped instantly on Solana
        });
      }
    } catch { /* skip */ }
  }

  // HYPE — validator delegation staking on Hyperliquid L1
  if (hypeRes.status === "fulfilled" && hypeRes.value) {
    rates.push(hypeRes.value);
  }

  return rates;
}

// ─── Combined fetch ────────────────────────────────────────────────────────────

export async function fetchAllYieldRates(): Promise<YieldRate[]> {
  const results = await Promise.allSettled([
    fetchKaminoRates(),
    fetchAaveRates("ethereum"),
    fetchAaveRates("base"),
    fetchAaveRates("arbitrum"),
    fetchHyperlendRates(),
    fetchPendleRates(),
    fetchDriftRates(),
    fetchKaminoVaultRates(),
    fetchNativeStakingRates(),
  ]);
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

// ─── Recommendation engine ────────────────────────────────────────────────────

/**
 * Generates yield optimization recommendations across all stablecoin assets and chains.
 * Considers cross-asset moves (e.g., USDT→USDC swap + bridge) when calculating costs.
 */
export function generateYieldRecommendations(
  stablePositions: RawDefiPosition[],
  idleStables: RawTokenBalance[],
  rates: YieldRate[],
  costs: BridgeCosts
): YieldRecommendation[] {
  // Only PT + variable lending rates; exclude LP positions (different risk profile)
  const targetRates = rates
    .filter((r) => !r.asset.startsWith("LP-") && isStable(r.asset))
    .sort((a, b) => b.supply_apy - a.supply_apy);

  // Minimum thresholds to avoid noise
  const MIN_APY_GAIN = 1.0;  // ≥1% APY improvement required
  const MIN_AMOUNT = 100;    // ≥$100 to be worth considering

  const recs: YieldRecommendation[] = [];

  function evaluate(
    fromChain: ChainId,
    fromAsset: string,
    fromProtocol: string | undefined,
    fromApy: number,
    amountUsd: number
  ) {
    for (const rate of targetRates) {
      // Skip same slot
      if (
        fromProtocol &&
        rate.protocol === fromProtocol &&
        rate.chain === fromChain &&
        normalizeAsset(rate.asset) === normalizeAsset(fromAsset)
      ) continue;

      const apyGain = rate.supply_apy - fromApy;
      if (apyGain < MIN_APY_GAIN) continue;
      if (amountUsd < MIN_AMOUNT) continue;

      const route = getRouteCost(
        fromChain, rate.chain as ChainId,
        fromAsset, rate.asset,
        amountUsd, costs
      );

      const dailyGain = (amountUsd * apyGain) / 100 / 365;
      if (dailyGain <= 0) continue;

      const breakevenDays = route.total_usd > 0 ? route.total_usd / dailyGain : 0;

      // Max break-even: 30 days for variable, 60 days for fixed (Pendle PT)
      const maxBreakeven = rate.type === "fixed" ? 60 : 30;
      if (route.total_usd > 0 && breakevenDays > maxBreakeven) continue;

      // ── Action links ──────────────────────────────────────────────────────
      const isCrossChain = fromChain !== (rate.chain as ChainId);
      const links: RouteLink[] = [];

      // 1. Bridge link (cross-chain moves)
      if (isCrossChain) {
        const isHL = fromChain === "hyperliquid" || rate.chain === "hyperliquid" ||
                     fromChain === "hyperevm"    || rate.chain === "hyperevm";
        links.push({
          label: isHL ? "HL Bridge" : route.method.includes("Wormhole") ? "Wormhole" : "Across (CCTP)",
          url: getBridgeUrl(fromChain, rate.chain),
        });
      }

      // 2. Swap link — source chain DEX if a swap is needed there
      if (route.swap_usd > 0) {
        const srcSwapUrl = SWAP_URLS[fromChain] ?? "https://app.uniswap.org/swap";
        links.push({ label: `Swap (${fromChain})`, url: srcSwapUrl });
        // If dest chain also needs a swap (Swap→CCTP→Swap) and DEX differs
        if (isCrossChain && SWAP_URLS[rate.chain] && SWAP_URLS[rate.chain] !== srcSwapUrl) {
          links.push({ label: `Swap (${rate.chain})`, url: SWAP_URLS[rate.chain] });
        }
      }

      // 3. Target protocol link
      const pUrl = PROTOCOL_URLS[rate.protocol];
      if (pUrl) {
        const pLabel = rate.protocol.charAt(0).toUpperCase() + rate.protocol.slice(1);
        links.push({ label: pLabel, url: pUrl });
      }

      recs.push({
        type: fromProtocol ? "move" : "deploy",
        from_protocol: fromProtocol,
        from_chain: fromProtocol ? fromChain : undefined,
        from_asset: normalizeAsset(fromAsset),
        to_protocol: rate.protocol,
        to_chain: rate.chain,
        asset: normalizeAsset(rate.asset),
        amount_usd: amountUsd,
        current_apy: fromApy,
        target_apy: rate.supply_apy,
        apy_gain: apyGain,
        daily_gain_usd: dailyGain,
        route_cost_usd: route.total_usd,
        bridge_cost_usd: route.bridge_usd,
        swap_cost_usd: route.swap_usd,
        route_method: route.method,
        route_notes: route.notes,
        route_links: links,
        breakeven_days: breakevenDays > 0 ? Math.ceil(breakevenDays) : null,
        yield_type: rate.type,
        maturity: rate.maturity,
      });
    }
  }

  // Idle stablecoins
  for (const idle of idleStables) {
    if (idle.value_usd < MIN_AMOUNT) continue;
    evaluate(idle.chain, idle.token_symbol, undefined, 0, idle.value_usd);
  }

  // Existing positions
  for (const pos of stablePositions) {
    if (pos.value_usd < MIN_AMOUNT) continue;
    evaluate(pos.chain, pos.asset_symbol, pos.protocol, pos.apy ?? 0, pos.value_usd);
  }

  // Deduplicate: same (from, to) key → keep best daily gain
  const seen = new Map<string, YieldRecommendation>();
  for (const rec of recs.sort((a, b) => b.daily_gain_usd - a.daily_gain_usd)) {
    const key = [
      rec.type,
      rec.from_protocol ?? "idle",
      rec.from_chain ?? "–",
      rec.from_asset ?? "–",
      rec.to_protocol,
      rec.to_chain,
      rec.asset,
    ].join(":");
    if (!seen.has(key)) seen.set(key, rec);
  }

  // Sort: lowest breakeven first (null = same-chain = 0), then highest daily gain
  // Limit to top 3 — no spam
  return [...seen.values()]
    .sort((a, b) => {
      const dA = a.breakeven_days ?? 0;
      const dB = b.breakeven_days ?? 0;
      if (dA !== dB) return dA - dB;
      return b.daily_gain_usd - a.daily_gain_usd;
    })
    .slice(0, 3);
}
