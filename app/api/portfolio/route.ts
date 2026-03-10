import { NextResponse } from "next/server";
import { getLivePortfolio } from "@/lib/snapshot";
import type { PortfolioResponse, ChainAllocation, ProtocolAllocation } from "@/lib/types";

// Cache live portfolio for 60 seconds
export const revalidate = 60;

export async function GET() {
  try {
    const { totalUsd, wallets } = await getLivePortfolio();

    // Aggregate by chain
    const chainMap = new Map<string, number>();
    const protocolMap = new Map<string, { value: number; chain: string }>();
    const allTokens = wallets.flatMap((w) =>
      w.tokens.filter((t) => !t.is_derivative)
    );

    for (const w of wallets) {
      // Chain from tokens
      for (const t of w.tokens.filter((t) => !t.is_derivative)) {
        chainMap.set(t.chain, (chainMap.get(t.chain) ?? 0) + t.value_usd);
      }
      // Chain from DeFi
      for (const p of w.defi_positions) {
        if (!p.is_debt) {
          chainMap.set(p.chain, (chainMap.get(p.chain) ?? 0) + p.value_usd);
          const key = `${p.protocol}:${p.chain}`;
          const existing = protocolMap.get(key);
          protocolMap.set(key, {
            value: (existing?.value ?? 0) + p.value_usd,
            chain: p.chain,
          });
        }
      }
    }

    const by_chain: ChainAllocation[] = Array.from(chainMap.entries())
      .map(([chain, value_usd]) => ({
        chain: chain as PortfolioResponse["by_chain"][0]["chain"],
        value_usd,
        pct: totalUsd > 0 ? (value_usd / totalUsd) * 100 : 0,
      }))
      .sort((a, b) => b.value_usd - a.value_usd);

    const by_protocol: ProtocolAllocation[] = Array.from(protocolMap.entries())
      .map(([key, data]) => ({
        protocol: key.split(":")[0],
        chain: data.chain as PortfolioResponse["by_chain"][0]["chain"],
        value_usd: data.value,
        pct: totalUsd > 0 ? (data.value / totalUsd) * 100 : 0,
      }))
      .sort((a, b) => b.value_usd - a.value_usd);

    const top_tokens = allTokens
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, 20);

    const unknown_price_count = allTokens.filter(
      (t) => t.price_usd === null || t.price_usd === undefined
    ).length;

    const totalDepositUsd = wallets.reduce(
      (sum, w) => sum + w.defi_deposit_usd,
      0
    );
    const totalBorrowUsd = wallets.reduce(
      (sum, w) => sum + w.defi_borrow_usd,
      0
    );

    const response: PortfolioResponse = {
      total_usd: totalUsd,
      token_usd: wallets.reduce((sum, w) => sum + w.token_usd, 0),
      defi_deposit_usd: totalDepositUsd,
      defi_borrow_usd: totalBorrowUsd,
      wallets: wallets.map((w) => ({
        wallet: w.wallet,
        token_usd: w.token_usd,
        defi_deposit_usd: w.defi_deposit_usd,
        defi_borrow_usd: w.defi_borrow_usd,
        total_usd: w.total_usd,
        tokens: w.tokens,
        defi_positions: w.defi_positions,
        errors: w.errors,
      })),
      by_chain,
      by_protocol,
      top_tokens,
      unknown_price_count,
      fetched_at: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/portfolio error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
