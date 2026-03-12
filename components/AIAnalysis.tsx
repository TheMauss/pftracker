"use client";

import { useState, useRef } from "react";

interface Props { defaultFocus?: string; }

export default function AIAnalysis({ defaultFocus }: Props) {
  const [focus, setFocus]     = useState(defaultFocus ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string>("");
  const [error, setError]     = useState<string>("");
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
      if (!res.ok) { setError((await res.json()).error ?? "Chyba"); return; }
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
      if ((err as Error).name !== "AbortError") setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function stop() { abortRef.current?.abort(); setLoading(false); }

  return (
    <div className="card rounded-2xl overflow-hidden relative">
      {/* Top hairline — orange accent */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,112,64,0.5) 40%, rgba(255,112,64,0.5) 60%, transparent 100%)" }}
      />

      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-3">
          {/* AI icon */}
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0"
            style={{
              background: "rgba(255,112,64,0.1)",
              border: "1px solid rgba(255,112,64,0.2)",
              color: "#ff7040",
              boxShadow: loading ? "0 0 16px rgba(255,112,64,0.2)" : "none",
              transition: "box-shadow 0.3s",
            }}
          >
            ✦
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>AI Analýza</div>
            <div className="text-[10px] mt-0.5 font-medium" style={{ color: "#404040" }}>Claude · claude-sonnet-4-6</div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "#ff7040" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ff7040" }} />
            Generuji…
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-5 space-y-3">
        {/* Input row */}
        <div className="flex gap-2">
          <input
            type="text"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Fokus analýzy (yield optimalizace, rizika borrowů…)"
            className="input-field flex-1 text-xs rounded-xl px-3.5 py-2.5"
            onKeyDown={(e) => e.key === "Enter" && !loading && runAnalysis()}
          />
          {loading ? (
            <button
              onClick={stop}
              className="btn-danger text-xs px-4 py-2 rounded-xl font-semibold shrink-0"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={runAnalysis}
              className="btn-primary text-xs px-5 py-2 rounded-xl shrink-0"
            >
              Analyzovat
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="text-xs rounded-xl p-3"
            style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.2)", color: "#ff6b80" }}
          >
            {error}
          </div>
        )}

        {/* Result */}
        {(result || loading) && (
          <div
            className="rounded-xl p-4 text-xs leading-relaxed whitespace-pre-wrap"
            style={{
              background: "rgba(8,8,8,0.8)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "#c0c0c0",
              minHeight: 80,
            }}
          >
            {result}
            {loading && (
              <span
                className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm align-middle"
                style={{ background: "#ff7040" }}
              />
            )}
          </div>
        )}

        {/* Placeholder text */}
        {!result && !loading && (
          <p className="text-[10px] leading-relaxed" style={{ color: "#2a2a2a" }}>
            Claude analyzuje tvé portfolio a navrhne konkrétní akce — přesuny mezi protokoly, yield optimalizace, rizika borrowů.
          </p>
        )}
      </div>
    </div>
  );
}
