/**
 * AI portfolio analysis using Claude.
 * Builds a structured prompt from portfolio data and streams the response.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PortfolioResponse } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export function buildPortfolioPrompt(
  portfolio: PortfolioResponse,
  pnl: {
    total_1d: number | null;
    total_7d: number | null;
    total_30d: number | null;
    total_all: number | null;
  },
  focus?: string
): string {
  const totalUsd = portfolio.total_usd;
  const depositUsd = portfolio.defi_deposit_usd;
  const borrowUsd = portfolio.defi_borrow_usd;
  const ltv =
    depositUsd > 0 ? ((borrowUsd / depositUsd) * 100).toFixed(1) : "0";

  // Collect all DeFi positions across wallets
  const allDefi = portfolio.wallets.flatMap((w) =>
    w.defi_positions.map((p) => ({ ...p, walletLabel: w.wallet.label }))
  );

  const lends = allDefi.filter((p) => !p.is_debt && p.position_type !== "lp");
  const borrows = allDefi.filter((p) => p.is_debt);
  const lps = allDefi.filter(
    (p) => p.position_type === "lp" || p.position_type === "vault"
  );
  const pendlePositions = allDefi.filter(
    (p) => p.position_type === "pt" || p.position_type === "yt"
  );

  // Top tokens by value
  const allTokens = portfolio.wallets
    .flatMap((w) => w.tokens)
    .filter((t) => !t.is_derivative)
    .sort((a, b) => b.value_usd - a.value_usd)
    .slice(0, 15);

  const formatUsd = (v: number | null) =>
    v === null ? "N/A" : `$${v.toFixed(2)}`;
  const formatPct = (v: number) => `${v.toFixed(1)}%`;

  let prompt = `You are an expert DeFi portfolio analyst. Analyze the following crypto portfolio and provide actionable insights in Czech language. Be specific with numbers and actionable with recommendations.

## Portfolio Overview
- **Total Value**: ${formatUsd(totalUsd)}
- **DeFi Deposited**: ${formatUsd(depositUsd)}
- **DeFi Borrowed**: ${formatUsd(borrowUsd)}
- **Overall LTV**: ${ltv}%
- **Wallets**: ${portfolio.wallets.length}

## Performance (PnL)
- 24h: ${formatUsd(pnl.total_1d)} ${pnl.total_1d !== null && totalUsd > 0 ? `(${((pnl.total_1d / totalUsd) * 100).toFixed(2)}%)` : ""}
- 7d: ${formatUsd(pnl.total_7d)}
- 30d: ${formatUsd(pnl.total_30d)}
- All-time: ${formatUsd(pnl.total_all)}

## Chain Allocation
${portfolio.by_chain
  .sort((a, b) => b.value_usd - a.value_usd)
  .map((c) => `- ${c.chain}: ${formatUsd(c.value_usd)} (${formatPct(c.pct)})`)
  .join("\n")}

## Top Holdings
${allTokens
  .map(
    (t) =>
      `- ${t.token_symbol} on ${t.chain}: ${formatUsd(t.value_usd)}${t.price_usd ? ` @ $${t.price_usd.toFixed(4)}` : ""}`
  )
  .join("\n")}

## DeFi Lending Positions
${
  lends.length === 0
    ? "None"
    : lends
        .map(
          (p) =>
            `- ${p.protocol.toUpperCase()} (${p.chain}): Lend ${p.asset_symbol} = ${formatUsd(p.value_usd)}${p.apy != null ? ` @ ${(p.apy as number).toFixed(2)}% APY` : ""}`
        )
        .join("\n")
}

## DeFi Borrow Positions
${
  borrows.length === 0
    ? "None"
    : borrows
        .map(
          (p) =>
            `- ${p.protocol.toUpperCase()} (${p.chain}): Borrow ${p.asset_symbol} = ${formatUsd(p.value_usd)}${p.apy != null ? ` @ ${Math.abs(p.apy as number).toFixed(2)}% cost` : ""}`
        )
        .join("\n")
}

## LP & Vault Positions
${
  lps.length === 0
    ? "None"
    : lps
        .map(
          (p) =>
            `- ${p.protocol.toUpperCase()} (${p.chain}): ${p.asset_symbol} = ${formatUsd(p.value_usd)}${p.apy != null ? ` @ ${(p.apy as number).toFixed(2)}% APY` : ""}`
        )
        .join("\n")
}

## Pendle Positions (PT/YT)
${
  pendlePositions.length === 0
    ? "None"
    : pendlePositions
        .map(
          (p) =>
            `- Pendle ${p.position_type.toUpperCase()} ${p.asset_symbol} (${p.chain}): ${formatUsd(p.value_usd)}${p.apy != null ? ` @ ${(p.apy as number).toFixed(2)}% fixed` : ""}`
        )
        .join("\n")
}

## Unknown Price Tokens
${portfolio.unknown_price_count} tokens with unknown prices (excluded from totals)
`;

  if (focus) {
    prompt += `\n## User Focus\n${focus}\n`;
  }

  prompt += `
## Your Task
Provide a comprehensive analysis in Czech language covering:

1. **Zdraví portfolia** — celkové zhodnocení, koncentrace rizik, diverzifikace
2. **Yield optimalizace** — porovnej APY napříč protokoly, navrhni přesuny pro vyšší výnos
3. **Rizika** — identifikuj nadměrné LTV, IL risk v LP, expirující Pendle PT, nízké health factory
4. **Konkrétní doporučení** — minimálně 3 specifické akce s odůvodněním (s čísly)
5. **Zajímavé příležitosti** — nové protokoly, Pendle trhy, yield strategie vhodné pro tento profil

Buď konkrétní a uváděj čísla. Délka: 400-600 slov.`;

  return prompt;
}

/**
 * Stream portfolio analysis from Claude.
 * Returns a ReadableStream of text chunks.
 */
export async function streamPortfolioAnalysis(
  portfolio: PortfolioResponse,
  pnl: {
    total_1d: number | null;
    total_7d: number | null;
    total_30d: number | null;
    total_all: number | null;
  },
  focus?: string
): Promise<ReadableStream<Uint8Array>> {
  const prompt = buildPortfolioPrompt(portfolio, pnl, focus);

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
