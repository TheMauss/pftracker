import { NextRequest, NextResponse } from "next/server";
import {
  getSnapshotHistory,
  getWallets,
  getWalletHistory,
  getSnapshotNDaysAgo,
  getFirstSnapshot,
  getLatestSnapshot,
} from "@/lib/db";
import type { SnapshotsResponse } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;

    const history = getSnapshotHistory(from, to);
    const wallets = getWallets();

    // Per-wallet history
    const wallet_history = wallets.map((w) => ({
      wallet_id: w.id,
      wallet_label: w.label,
      chain: w.chain,
      history: getWalletHistory(w.id, from, to),
    }));

    // PnL calculations
    const latest = getLatestSnapshot();
    const snap1d = getSnapshotNDaysAgo(1);
    const snap7d = getSnapshotNDaysAgo(7);
    const snap30d = getSnapshotNDaysAgo(30);
    const snapFirst = getFirstSnapshot();

    const currentTotal = latest?.total_usd ?? 0;

    const pnlTotal = {
      total_1d: snap1d ? currentTotal - snap1d.total_usd : null,
      total_7d: snap7d ? currentTotal - snap7d.total_usd : null,
      total_30d: snap30d ? currentTotal - snap30d.total_usd : null,
      total_all:
        snapFirst && snapFirst.id !== latest?.id
          ? currentTotal - snapFirst.total_usd
          : null,
    };

    // Per-wallet PnL
    const by_wallet = wallets.map((w) => {
      const wHistory = wallet_history.find((wh) => wh.wallet_id === w.id);
      const wLatest = wHistory?.history.at(-1);
      const currentVal = wLatest?.total_usd ?? 0;

      const getHistoryAt = (nDays: number) => {
        if (!wHistory?.history.length) return null;
        const cutoff = new Date(Date.now() - nDays * 86400000).toISOString();
        const found = [...wHistory.history]
          .reverse()
          .find((h) => h.taken_at <= cutoff);
        return found?.total_usd ?? null;
      };

      const val1d = getHistoryAt(1);
      const val7d = getHistoryAt(7);
      const val30d = getHistoryAt(30);
      const valFirst = wHistory?.history[0]?.total_usd ?? null;

      return {
        wallet_id: w.id,
        wallet_label: w.label,
        wallet_address: w.address,
        chain: w.chain,
        current_usd: currentVal,
        pnl_1d: val1d !== null ? currentVal - val1d : null,
        pnl_7d: val7d !== null ? currentVal - val7d : null,
        pnl_30d: val30d !== null ? currentVal - val30d : null,
        pnl_all:
          valFirst !== null && wHistory!.history.length > 1
            ? currentVal - valFirst
            : null,
      };
    });

    const response: SnapshotsResponse = {
      history: history.map((h) => ({
        snapshot_id: h.snapshot_id,
        taken_at: h.taken_at,
        total_usd: h.total_usd,
      })),
      wallet_history,
      pnl: {
        ...pnlTotal,
        by_wallet,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/snapshots error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
