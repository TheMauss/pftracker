import { NextRequest } from "next/server";
import { getLivePortfolio } from "@/lib/snapshot";
import { streamPortfolioAnalysis } from "@/lib/ai";
import {
  getSnapshotNDaysAgo,
  getFirstSnapshot,
  getLatestSnapshot,
} from "@/lib/db";
import type { PortfolioResponse, ChainAllocation, ProtocolAllocation } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY není nastaven v .env.local", { status: 503 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const focus: string | undefined = body?.focus;

    // Fetch live portfolio
    const { totalUsd, wallets } = await getLivePortfolio();

    // Build aggregations
    const chainMap = new Map<string, number>();
    const protocolMap = new Map<string, { value: number; chain: string }>();
    const allTokens = wallets.flatMap((w) =>
      w.tokens.filter((t) => !t.is_derivative)
    );

    for (const w of wallets) {
      for (const t of w.tokens.filter((t) => !t.is_derivative)) {
        chainMap.set(t.chain, (chainMap.get(t.chain) ?? 0) + t.value_usd);
      }
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

    const by_chain: ChainAllocation[] = Array.from(chainMap.entries()).map(
      ([chain, value_usd]) => ({
        chain: chain as ChainAllocation["chain"],
        value_usd,
        pct: totalUsd > 0 ? (value_usd / totalUsd) * 100 : 0,
      })
    );

    const by_protocol: ProtocolAllocation[] = Array.from(
      protocolMap.entries()
    ).map(([key, data]) => ({
      protocol: key.split(":")[0],
      chain: data.chain as ProtocolAllocation["chain"],
      value_usd: data.value,
      pct: totalUsd > 0 ? (data.value / totalUsd) * 100 : 0,
    }));

    const portfolio: PortfolioResponse = {
      total_usd: totalUsd,
      token_usd: wallets.reduce((s, w) => s + w.token_usd, 0),
      defi_deposit_usd: wallets.reduce((s, w) => s + w.defi_deposit_usd, 0),
      defi_borrow_usd: wallets.reduce((s, w) => s + w.defi_borrow_usd, 0),
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
      top_tokens: allTokens
        .sort((a, b) => b.value_usd - a.value_usd)
        .slice(0, 15),
      unknown_price_count: allTokens.filter((t) => !t.price_usd).length,
      fetched_at: new Date().toISOString(),
    };

    // PnL from DB
    const latest = getLatestSnapshot();
    const snap1d = getSnapshotNDaysAgo(1);
    const snap7d = getSnapshotNDaysAgo(7);
    const snap30d = getSnapshotNDaysAgo(30);
    const snapFirst = getFirstSnapshot();
    const cur = latest?.total_usd ?? totalUsd;

    const pnl = {
      total_1d: snap1d ? cur - snap1d.total_usd : null,
      total_7d: snap7d ? cur - snap7d.total_usd : null,
      total_30d: snap30d ? cur - snap30d.total_usd : null,
      total_all:
        snapFirst && snapFirst.id !== latest?.id
          ? cur - snapFirst.total_usd
          : null,
    };

    const stream = await streamPortfolioAnalysis(portfolio, pnl, focus);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("/api/analyze error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
