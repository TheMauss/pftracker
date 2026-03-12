"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface StockPos {
  id: number;
  source: string;
  ticker: string;
  name: string | null;
  quantity: number;
  avg_price: number | null;
  price_usd: number | null;
  value_usd: number | null;
  display_name: string;
  category: string;
}

interface StocksResponse {
  positions: StockPos[];
  total_usd: number;
}

interface EditFields {
  ticker: string;
  name: string;
  quantity: string;
  avg_price: string;
  price_usd: string;
  category: string;
}

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
}
function fmtQty(n: number) {
  if (n >= 1000) return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function parseNum(s: string) { return parseFloat(s.replace(",", ".")) || 0; }

const SOURCE_LABELS: Record<string, string> = { etoro: "eToro", revolut: "Revolut", manual: "Ručně" };
const SOURCE_COLORS: Record<string, string> = { etoro: "#3cffa0", revolut: "#ff7040", manual: "#a090ff" };

const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-xs outline-none";
const inputSty = { background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", color: "#f0f0f0" };

export default function StocksPage() {
  const [data, setData]           = useState<StocksResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [debugPreview, setDebugPreview] = useState<string | null>(null);
  const etoroRef  = useRef<HTMLInputElement>(null);
  const revolvRef = useRef<HTMLInputElement>(null);

  // Manual form
  const [mTicker,   setMTicker]   = useState("");
  const [mQty,      setMQty]      = useState("");
  const [mAvg,      setMAvg]      = useState("");
  const [mPrice,    setMPrice]    = useState("");
  const [mName,     setMName]     = useState("");
  const [mCategory, setMCategory] = useState("Akcie");
  const [mSaving, setMSaving] = useState(false);
  const [mError,  setMError]  = useState<string | null>(null);

  // Inline edit
  const [editId,     setEditId]     = useState<number | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ ticker: "", name: "", quantity: "", avg_price: "", price_usd: "", category: "Akcie" });
  const [editSaving, setEditSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stocks");
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleUpload(source: string, file: File) {
    setUploading(source); setImportError(null); setDebugPreview(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("source", source);
    try {
      const res  = await fetch("/api/stocks", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setImportError(json.error ?? "Chyba při importu"); if (json.debug_preview) setDebugPreview(json.debug_preview); return; }
      await fetchData();
    } catch (e) { setImportError(String(e)); }
    finally { setUploading(null); }
  }

  async function handleDeleteSource(source: string) {
    if (!confirm(`Smazat všechny pozice z ${SOURCE_LABELS[source] ?? source}?`)) return;
    await fetch(`/api/stocks?source=${source}`, { method: "DELETE" });
    await fetchData();
  }

  async function handleDeleteById(id: number, ticker: string) {
    if (!confirm(`Smazat pozici ${ticker}?`)) return;
    await fetch(`/api/stocks?id=${id}`, { method: "DELETE" });
    if (editId === id) setEditId(null);
    await fetchData();
  }

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    setMError(null);
    const ticker = mTicker.trim().toUpperCase();
    const qty    = parseNum(mQty);
    if (!ticker || qty <= 0) { setMError("Zadej ticker a množství."); return; }
    setMSaving(true);
    try {
      const res = await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          quantity:  qty,
          avg_price: mAvg   ? parseNum(mAvg)   : null,
          price_usd: mPrice ? parseNum(mPrice) : null,
          name:      mName.trim() || null,
          category:  mCategory.trim() || "Akcie",
        }),
      });
      const json = await res.json();
      if (!res.ok) { setMError(json.error ?? "Chyba"); return; }
      setMTicker(""); setMQty(""); setMAvg(""); setMPrice(""); setMName(""); setMCategory("Akcie");
      await fetchData();
    } catch (err) { setMError(String(err)); }
    finally { setMSaving(false); }
  }

  function startEdit(p: StockPos) {
    setEditId(p.id);
    setEditFields({
      ticker:    p.ticker,
      name:      p.name ?? "",
      quantity:  String(p.quantity),
      avg_price: p.avg_price != null ? String(p.avg_price) : "",
      price_usd: p.price_usd != null ? String(p.price_usd) : "",
      category:  p.category,
    });
  }

  async function saveEdit(id: number, isManual: boolean) {
    const qty = parseNum(editFields.quantity);
    if (qty <= 0) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        ticker:    editFields.ticker.trim().toUpperCase() || undefined,
        name:      editFields.name.trim() || null,
        quantity:  qty,
        avg_price: editFields.avg_price ? parseNum(editFields.avg_price) : null,
        category:  editFields.category.trim() || "Akcie",
      };
      if (isManual) {
        body.price_usd = editFields.price_usd ? parseNum(editFields.price_usd) : null;
      }
      await fetch(`/api/stocks?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditId(null);
      await fetchData();
    } finally { setEditSaving(false); }
  }

  const ef = (key: keyof EditFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditFields((f) => ({ ...f, [key]: e.target.value }));

  const sources = data ? [...new Set(data.positions.map((p) => p.source))] : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>Akcie</h1>
          <p className="text-xs mt-0.5" style={{ color: "#505050" }}>Import a správa akciových pozic</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="btn-ghost text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5">
          <span className={loading ? "animate-spin" : ""}>↻</span>
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>

      {/* Broker import */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([
          { source: "etoro",   label: "eToro",            desc: "Account Statement XLSX — Profil → Account Statement", ref: etoroRef,  color: "#3cffa0" },
          { source: "revolut", label: "Revolut Investing", desc: "Statement CSV — Profil → Dokumenty → Výpisy → Investice", ref: revolvRef, color: "#ff7040" },
        ] as const).map(({ source, label, desc, ref, color }) => {
          const hasData = sources.includes(source);
          return (
            <div key={source} className="card rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}40, transparent)` }} />
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-bold" style={{ color: "#f0f0f0" }}>{label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "#505050" }}>{desc}</div>
                </div>
                {hasData && (
                  <button onClick={() => handleDeleteSource(source)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: "#505050" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#ff3d5a"; (e.currentTarget as HTMLElement).style.background = "rgba(255,61,90,0.08)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#505050"; (e.currentTarget as HTMLElement).style.background = ""; }}>
                    Smazat
                  </button>
                )}
              </div>
              <input ref={ref} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(source, f); e.target.value = ""; }} />
              <button onClick={() => ref.current?.click()} disabled={uploading === source}
                className="w-full rounded-xl py-2.5 text-xs font-semibold"
                style={{ background: hasData ? "rgba(255,255,255,0.04)" : `${color}15`, border: `1px solid ${hasData ? "rgba(255,255,255,0.08)" : `${color}30`}`, color: hasData ? "#606060" : color }}>
                {uploading === source ? "Importuji…" : hasData ? "Aktualizovat" : "Nahrát soubor"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Manual form */}
      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#f0f0f0" }}>Přidat ručně</h2>
        <form onSubmit={handleManualAdd} className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          {([
            { label: "Ticker *",    val: mTicker,   set: setMTicker,   ph: "AAPL",       mono: true  },
            { label: "Počet *",     val: mQty,      set: setMQty,      ph: "10",         mono: false },
            { label: "Avg. cena $", val: mAvg,      set: setMAvg,      ph: "150.00",     mono: false },
            { label: "Akt. cena $", val: mPrice,    set: setMPrice,    ph: "185.50",     mono: false },
            { label: "Název",       val: mName,     set: setMName,     ph: "Apple Inc.", mono: false },
            { label: "Kategorie",   val: mCategory, set: setMCategory, ph: "Akcie",      mono: false },
          ] as const).map(({ label, val, set, ph, mono }) => (
            <div key={label} className="flex flex-col gap-1">
              <label className="stat-label">{label}</label>
              <input value={val} onChange={(e) => (set as (v: string) => void)(e.target.value)} placeholder={ph}
                className={`${inputCls}${mono ? " font-mono uppercase" : ""}`} style={inputSty}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")} />
            </div>
          ))}
          <div className="col-span-2 md:col-span-6 flex items-center gap-3">
            <button type="submit" disabled={mSaving}
              className="rounded-xl px-5 py-2 text-xs font-semibold"
              style={{ background: "rgba(60,255,160,0.12)", border: "1px solid rgba(60,255,160,0.25)", color: "#3cffa0" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(60,255,160,0.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(60,255,160,0.12)")}>
              {mSaving ? "Přidávám…" : "Přidat"}
            </button>
            {mError && <span className="text-xs" style={{ color: "#ff6b80" }}>{mError}</span>}
          </div>
        </form>
      </div>

      {importError && (
        <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(255,61,90,0.07)", border: "1px solid rgba(255,61,90,0.2)", color: "#ff6b80" }}>
          {importError}
          {debugPreview && <pre className="mt-2 text-[10px] overflow-x-auto whitespace-pre-wrap" style={{ color: "#606060", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>{debugPreview}</pre>}
        </div>
      )}

      {/* Summary */}
      {data && data.positions.length > 0 && (
        <div className="card rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(60,255,160,0.4), transparent)" }} />
          <div className="flex items-center justify-between">
            <div><div className="stat-label mb-1">Celková hodnota</div><div className="stat-value" style={{ color: "#3cffa0" }}>{fmtUsd(data.total_usd)}</div></div>
            <div className="text-right"><div className="stat-label mb-1">Pozice</div><div className="text-2xl font-bold" style={{ color: "#f0f0f0" }}>{data.positions.length}</div></div>
          </div>
        </div>
      )}

      {/* Positions table */}
      {loading ? (
        <div className="h-48 card rounded-2xl animate-pulse" />
      ) : data && data.positions.length > 0 ? (
        <div className="card rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Pozice</h2>
            <span className="stat-label">{data.positions.length} tickerů</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {(["Ticker", "Název", "Kategorie", "Počet", "Cena", "Avg.", "Hodnota", ""] as const).map((h, i) => (
                    <th key={i} className={`px-5 py-2.5 stat-label ${i >= 3 && i < 7 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => {
                  const isManual  = p.source === "manual";
                  const isEditing = editId === p.id;

                  if (isEditing) {
                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: "rgba(255,255,255,0.02)" }}>
                        <td className="px-5 py-2">
                          <input value={editFields.ticker} onChange={ef("ticker")} className={`${inputCls} font-mono uppercase`} style={inputSty} />
                        </td>
                        <td className="px-5 py-2">
                          <input value={editFields.name} onChange={ef("name")} placeholder="Název" className={inputCls} style={inputSty} />
                        </td>
                        <td className="px-5 py-2">
                          <input value={editFields.category} onChange={ef("category")} placeholder="Akcie" className={inputCls} style={inputSty} />
                        </td>
                        <td className="px-5 py-2">
                          <input value={editFields.quantity} onChange={ef("quantity")} className={inputCls} style={{ ...inputSty, textAlign: "right" }} />
                        </td>
                        <td className="px-5 py-2">
                          {isManual
                            ? <input value={editFields.price_usd} onChange={ef("price_usd")} placeholder="Akt. cena" className={inputCls} style={{ ...inputSty, textAlign: "right" }} />
                            : <span className="block text-right" style={{ color: "#404040" }}>Yahoo</span>}
                        </td>
                        <td className="px-5 py-2">
                          <input value={editFields.avg_price} onChange={ef("avg_price")} placeholder="Avg." className={inputCls} style={{ ...inputSty, textAlign: "right" }} />
                        </td>
                        <td className="px-5 py-2" style={{ color: "#404040" }}>—</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(p.id, isManual)} disabled={editSaving}
                              className="text-[10px] px-2.5 py-1 rounded-lg font-semibold"
                              style={{ background: "rgba(60,255,160,0.12)", border: "1px solid rgba(60,255,160,0.25)", color: "#3cffa0" }}>
                              {editSaving ? "…" : "✓"}
                            </button>
                            <button onClick={() => setEditId(null)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: "#505050" }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <td className="px-5 py-3 font-bold tracking-wide" style={{ color: "#f0f0f0" }}>{p.ticker}</td>
                      <td className="px-5 py-3 max-w-[140px] truncate" style={{ color: "#505050" }}>
                        {p.display_name !== p.ticker ? p.display_name : ""}
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[10px] font-semibold" style={{ color: "#606060" }}>
                          {p.category}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#c0c0c0" }}>{fmtQty(p.quantity)}</td>
                      <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#f0f0f0" }}>
                        {p.price_usd != null ? fmtUsd(p.price_usd) : <span style={{ color: "#303030" }}>—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#505050" }}>
                        {p.avg_price != null ? fmtUsd(p.avg_price) : <span style={{ color: "#303030" }}>—</span>}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums" style={{ color: "#f0f0f0" }}>
                        {p.value_usd != null ? fmtUsd(p.value_usd) : <span style={{ color: "#404040" }}>—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => startEdit(p)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: "#404040" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#c0c0c0"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#404040"; (e.currentTarget as HTMLElement).style.background = ""; }}>
                            ✎
                          </button>
                          <button onClick={() => handleDeleteById(p.id, p.ticker)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: "#404040" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#ff3d5a"; (e.currentTarget as HTMLElement).style.background = "rgba(255,61,90,0.08)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#404040"; (e.currentTarget as HTMLElement).style.background = ""; }}>
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}>
                  <td colSpan={6} className="px-5 py-3 font-semibold" style={{ color: "#606060" }}>Celkem</td>
                  <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: "#3cffa0" }}>{fmtUsd(data.total_usd)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : !loading && (
        <div className="card rounded-2xl p-16 text-center text-xs" style={{ color: "#404040" }}>
          Žádné akcie. Nahraj soubor nebo přidej pozici ručně.
        </div>
      )}
    </div>
  );
}
