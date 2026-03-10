"use client";

import { useEffect, useState, useCallback } from "react";
import HistoryChart from "@/components/HistoryChart";
import PnLTable from "@/components/PnLTable";
import type { SnapshotsResponse } from "@/lib/types";

export default function HistoryPage() {
  const [data, setData] = useState<SnapshotsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/snapshots");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function triggerSnapshot() {
    const secret = prompt("Zadej SNAPSHOT_SECRET:");
    if (!secret) return;
    const res = await fetch("/api/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-snapshot-secret": secret,
      },
      body: JSON.stringify({}),
    });
    const result = await res.json();
    if (res.ok) {
      alert(`Snapshot vytvořen! ID: ${result.snapshotId}, Total: $${result.totalUsd?.toFixed(2)}`);
      fetchData();
    } else {
      alert(`Chyba: ${result.error}`);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Historie portfolia</h1>
        <div className="flex gap-2">
          <button
            onClick={triggerSnapshot}
            className="px-3 py-1.5 text-sm bg-indigo-700 hover:bg-indigo-600 text-white rounded transition-colors"
          >
            Manuální snapshot
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Načítám..." : "Obnovit"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-80 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
          <div className="h-48 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
        </div>
      ) : (
        <>
          <HistoryChart data={data} />
          <PnLTable data={data} />
        </>
      )}
    </div>
  );
}
