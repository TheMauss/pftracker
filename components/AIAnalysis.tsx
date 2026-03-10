"use client";

import { useState, useRef } from "react";

interface Props {
  defaultFocus?: string;
}

export default function AIAnalysis({ defaultFocus }: Props) {
  const [focus, setFocus] = useState(defaultFocus ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setResult("");
    setError("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus || undefined }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Chyba");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setResult(text);
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="font-semibold text-white mb-3">AI Analýza portfolia</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Volitelný fokus (např. 'optimalizace yieldů', 'rizika borrowů')"
          className="flex-1 text-sm bg-gray-800 rounded px-3 py-2 text-gray-300 placeholder-gray-600 border border-gray-700 focus:outline-none focus:border-indigo-500"
          onKeyDown={(e) => e.key === "Enter" && !loading && runAnalysis()}
        />
        {loading ? (
          <button
            onClick={stop}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm rounded transition-colors"
          >
            Zastavit
          </button>
        ) : (
          <button
            onClick={runAnalysis}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors font-medium"
          >
            Analyzovat
          </button>
        )}
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded p-3 mb-3">
          {error}
        </div>
      )}

      {(result || loading) && (
        <div className="bg-gray-950 rounded-lg p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap min-h-16 border border-gray-800">
          {result}
          {loading && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>
      )}

      {!result && !loading && (
        <p className="text-xs text-gray-600">
          Claude analyzuje tvé portfolio a navrhne konkrétní akce — přesuny mezi protokoly,
          yield optimalizace, rizika borrowů a příležitosti.
        </p>
      )}
    </div>
  );
}
