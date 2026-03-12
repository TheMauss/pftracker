import { NextResponse } from "next/server";
import { getCachedPortfolio } from "@/lib/portfolio-cache";
import {
  fetchAllYieldRates,
  fetchLiveBridgeCosts,
  generateYieldRecommendations,
  isStable,
  isNative,
  normalizeAsset,
  normalizeNative,
  type YieldRate,
  type YieldRecommendation,
  type BridgeCosts,
} from "@/lib/yields";
import type { RawDefiPosition, RawTokenBalance } from "@/lib/types";


export interface YieldPosition {
  protocol: string;
  chain: string;
  asset: string;
  value_usd: number;
  apy: number;
  annual_yield_usd: number;
}

export interface NativeRecommendation {
  type: "stake" | "move";
  asset: string;        // normalized (ETH, SOL, HYPE, BTC)
  amount_usd: number;
  from_protocol?: string;
  from_chain?: string;
  current_apy: number;
  to_protocol: string;
  to_chain: string;
  target_apy: number;
  apy_gain: number;
  daily_gain_usd: number;
  annual_gain_usd: number;
  url?: string;
}

export interface YieldApiResponse {
  // Stablecoins
  total_stable_deployed_usd: number;
  weighted_apy: number;
  annual_yield_usd: number;
  idle_stable_usd: number;
  stable_positions: YieldPosition[];
  idle_stablecoins: Array<{ chain: string; asset: string; amount_usd: number }>;
  recommendations: YieldRecommendation[];
  // Native tokens
  total_native_deployed_usd: number;
  native_weighted_apy: number;
  native_annual_yield_usd: number;
  idle_native_usd: number;
  native_positions: YieldPosition[];
  idle_native_tokens: Array<{ chain: string; asset: string; amount_usd: number }>;
  native_recommendations: NativeRecommendation[];
  // Shared
  market_rates: YieldRate[];
  bridge_costs: BridgeCosts;
  fetched_at: string;
  errors: string[];
}

// Re-export RouteCost so consumers can import from here if needed
export type { RouteCost } from "@/lib/yields";

const NATIVE_PROTOCOL_URLS: Record<string, string> = {
  lido:        "https://stake.lido.fi",
  jito:        "https://www.jito.network/staking/",
  marinade:    "https://marinade.finance/staking/",
  hyperliquid: "https://app.hyperliquid.xyz/staking",
  kamino:      "https://app.kamino.finance",
  aave:        "https://app.aave.com",
  hyperlend:   "https://app.hyperlend.finance",
  pendle:      "https://app.pendle.finance/trade/markets",
};

function generateNativeRecommendations(
  nativePositions: YieldPosition[],
  idleNative: Array<{ chain: string; asset: string; amount_usd: number }>,
  rates: YieldRate[]
): NativeRecommendation[] {
  const MIN_APY_GAIN = 0.5;
  const MIN_AMOUNT = 20;

  const nativeRates = rates
    .filter((r) => r.category === "native" && r.supply_apy >= MIN_APY_GAIN)
    .sort((a, b) => b.supply_apy - a.supply_apy);

  const recs: NativeRecommendation[] = [];

  // Stake/deploy idle native tokens
  for (const idle of idleNative) {
    if (idle.amount_usd < MIN_AMOUNT) continue;
    const baseAsset = normalizeNative(idle.asset);
    const bestRate = nativeRates.find((r) => normalizeNative(r.asset) === baseAsset);
    if (!bestRate) continue;
    const daily = (idle.amount_usd * bestRate.supply_apy) / 100 / 365;
    recs.push({
      type: "stake",
      asset: baseAsset,
      amount_usd: idle.amount_usd,
      current_apy: 0,
      to_protocol: bestRate.protocol,
      to_chain: bestRate.chain,
      target_apy: bestRate.supply_apy,
      apy_gain: bestRate.supply_apy,
      daily_gain_usd: daily,
      annual_gain_usd: daily * 365,
      url: NATIVE_PROTOCOL_URLS[bestRate.protocol],
    });
  }

  // Move from lower to higher APY
  for (const pos of nativePositions) {
    const baseAsset = normalizeNative(pos.asset);
    const betterRate = nativeRates.find((r) => {
      if (normalizeNative(r.asset) !== baseAsset) return false;
      if (r.protocol === pos.protocol && r.chain === pos.chain) return false;
      return r.supply_apy > pos.apy + MIN_APY_GAIN;
    });
    if (!betterRate) continue;
    const gain = betterRate.supply_apy - pos.apy;
    const daily = (pos.value_usd * gain) / 100 / 365;
    recs.push({
      type: "move",
      asset: baseAsset,
      amount_usd: pos.value_usd,
      from_protocol: pos.protocol,
      from_chain: pos.chain,
      current_apy: pos.apy,
      to_protocol: betterRate.protocol,
      to_chain: betterRate.chain,
      target_apy: betterRate.supply_apy,
      apy_gain: gain,
      daily_gain_usd: daily,
      annual_gain_usd: daily * 365,
      url: NATIVE_PROTOCOL_URLS[betterRate.protocol],
    });
  }

  // Deduplicate by (type, asset, to_protocol, to_chain), keep best annual gain
  const seen = new Map<string, NativeRecommendation>();
  for (const r of recs.sort((a, b) => b.annual_gain_usd - a.annual_gain_usd)) {
    const key = `${r.type}:${r.asset}:${r.to_protocol}:${r.to_chain}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].slice(0, 3);
}

function aggregatePositions(positions: RawDefiPosition[], assetNormalizer: (s: string) => string): YieldPosition[] {
  type Agg = { protocol: string; chain: string; asset: string; value_usd: number; weighted_apy: number };
  const map = new Map<string, Agg>();
  for (const p of positions) {
    const asset = assetNormalizer(p.asset_symbol);
    const key = `${p.protocol}:${p.chain}:${asset}`;
    const ex = map.get(key);
    if (ex) {
      ex.value_usd += p.value_usd;
      ex.weighted_apy += (p.apy ?? 0) * p.value_usd;
    } else {
      map.set(key, { protocol: p.protocol, chain: p.chain, asset, value_usd: p.value_usd, weighted_apy: (p.apy ?? 0) * p.value_usd });
    }
  }
  return Array.from(map.values())
    .map((p) => {
      const apy = p.value_usd > 0 ? p.weighted_apy / p.value_usd : 0;
      return { protocol: p.protocol, chain: p.chain, asset: p.asset, value_usd: p.value_usd, apy, annual_yield_usd: (p.value_usd * apy) / 100 };
    })
    .sort((a, b) => b.value_usd - a.value_usd);
}

export async function GET() {
  try {
    const [portfolioResult, ratesResult, bridgeResult] = await Promise.allSettled([
      getCachedPortfolio(),
      fetchAllYieldRates(),
      fetchLiveBridgeCosts(),
    ]);

    const errors: string[] = [];
    const portfolio =
      portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
    const rates: YieldRate[] =
      ratesResult.status === "fulfilled" ? ratesResult.value : [];
    const bridgeCosts: BridgeCosts =
      bridgeResult.status === "fulfilled"
        ? bridgeResult.value
        : {
            cctp: {}, wormhole: {}, swap_fees: {},
            hl_withdrawal_usd: 1, hl_hyperevm_tx_usd: 0.003,
            eth_gas_gwei: 0.3, eth_usd: 2500, hype_usd: 15,
          };

    if (portfolioResult.status === "rejected")
      errors.push(`Portfolio fetch failed: ${portfolioResult.reason}`);
    if (ratesResult.status === "rejected")
      errors.push(`Rates fetch failed: ${ratesResult.reason}`);
    if (bridgeResult.status === "rejected")
      errors.push(`Bridge cost fetch failed (using fallback): ${bridgeResult.reason}`);

    const allPositions: RawDefiPosition[] =
      portfolio?.wallets.flatMap((w) => w.defi_positions) ?? [];
    const allTokens: RawTokenBalance[] =
      portfolio?.wallets.flatMap((w) => w.tokens) ?? [];

    const SUPPLY_TYPES = ["lend", "vault", "stake"] as const;

    // ── Stablecoin positions ──
    const stablePositions = allPositions.filter(
      (p) => isStable(p.asset_symbol) && !p.is_debt && SUPPLY_TYPES.includes(p.position_type as never)
    );
    const aggregatedPositions = aggregatePositions(stablePositions, normalizeAsset);

    const idleStables = allTokens.filter(
      (t) => isStable(t.token_symbol) && !t.is_derivative && t.value_usd > 1 && t.token_name !== "Hyperliquid Perp Equity"
    );

    const totalDeployed = aggregatedPositions.reduce((s, p) => s + p.value_usd, 0);
    const weightedAvgApy = totalDeployed > 0
      ? aggregatedPositions.reduce((s, p) => s + p.apy * p.value_usd, 0) / totalDeployed : 0;
    const annualYield = aggregatedPositions.reduce((s, p) => s + p.annual_yield_usd, 0);
    const totalIdle = idleStables.reduce((s, t) => s + t.value_usd, 0);

    const recommendations = generateYieldRecommendations(stablePositions, idleStables, rates, bridgeCosts);

    // ── Native token positions ──
    const nativePositions = allPositions.filter(
      (p) => isNative(p.asset_symbol) && !p.is_debt && SUPPLY_TYPES.includes(p.position_type as never)
    );
    const aggregatedNativePositions = aggregatePositions(nativePositions, normalizeNative);

    const idleNative = allTokens.filter(
      (t) => isNative(t.token_symbol) && !t.is_derivative && t.value_usd > 20
    );

    const totalNativeDeployed = aggregatedNativePositions.reduce((s, p) => s + p.value_usd, 0);
    const nativeWeightedAvgApy = totalNativeDeployed > 0
      ? aggregatedNativePositions.reduce((s, p) => s + p.apy * p.value_usd, 0) / totalNativeDeployed : 0;
    const nativeAnnualYield = aggregatedNativePositions.reduce((s, p) => s + p.annual_yield_usd, 0);
    const totalIdleNative = idleNative.reduce((s, t) => s + t.value_usd, 0);

    const nativeIdleMapped = idleNative.map((t) => ({ chain: t.chain, asset: t.token_symbol, amount_usd: t.value_usd }));
    const nativeRecommendations = generateNativeRecommendations(aggregatedNativePositions, nativeIdleMapped, rates);

    const response: YieldApiResponse = {
      total_stable_deployed_usd: totalDeployed,
      weighted_apy: weightedAvgApy,
      annual_yield_usd: annualYield,
      idle_stable_usd: totalIdle,
      stable_positions: aggregatedPositions,
      idle_stablecoins: idleStables.map((t) => ({ chain: t.chain, asset: t.token_symbol, amount_usd: t.value_usd })),
      recommendations,
      total_native_deployed_usd: totalNativeDeployed,
      native_weighted_apy: nativeWeightedAvgApy,
      native_annual_yield_usd: nativeAnnualYield,
      idle_native_usd: totalIdleNative,
      native_positions: aggregatedNativePositions,
      idle_native_tokens: nativeIdleMapped,
      native_recommendations: nativeRecommendations,
      market_rates: rates,
      bridge_costs: bridgeCosts,
      fetched_at: new Date().toISOString(),
      errors,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/yield error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
