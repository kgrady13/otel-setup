"use client";

import { useEffect, useState, useCallback } from "react";

interface TraceEntry {
  id: string;
  receivedAt: number;
  bodyBytes: number;
  payload: Record<string, unknown>;
}

interface TraceStats {
  totalBytes: number;
  totalRequests: number;
  totalGB: number;
  durationMs: number;
  projectedMonthlyGB: number;
  firstRequestAt: number | null;
  lastRequestAt: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export default function Home() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [polling, setPolling] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchEntries = useCallback(async () => {
    try {
      const [entriesRes, statsRes] = await Promise.all([
        fetch("/api/traces"),
        fetch("/api/traces?stats"),
      ]);
      if (entriesRes.ok) setEntries(await entriesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      // ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    if (!polling) return;
    const interval = setInterval(fetchEntries, 3000);
    return () => clearInterval(interval);
  }, [polling, fetchEntries]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearAll = async () => {
    await fetch("/api/traces", { method: "DELETE" });
    setEntries([]);
    setStats(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-[family-name:var(--font-geist-mono)]">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Trace Viewer</h1>
            <p className="text-xs text-gray-500 mt-1">Direct OTLP export — no drain, no extra cost</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setPolling((p) => !p)}
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                polling
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              {polling ? "Polling" : "Paused"}
            </button>
            <button
              onClick={fetchEntries}
              className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600"
            >
              Refresh
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1.5 rounded text-sm font-medium bg-red-700 hover:bg-red-600"
            >
              Clear
            </button>
          </div>
        </div>

        {stats && stats.totalRequests > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Data received</div>
              <div className="text-lg font-bold">{formatBytes(stats.totalBytes)}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.totalRequests} exports</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Monthly volume</div>
              {stats.durationMs >= 300_000 ? (
                <>
                  <div className="text-lg font-bold">{stats.projectedMonthlyGB.toFixed(2)} GB</div>
                  <div className="text-xs text-gray-500 mt-1">projected over 30 days</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-gray-500">—</div>
                  <div className="text-xs text-gray-500 mt-1">need 5min+ of data</div>
                </>
              )}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Observation window</div>
              <div className="text-lg font-bold">{stats.durationMs > 0 ? formatDuration(stats.durationMs) : "—"}</div>
              <div className="text-xs text-gray-500 mt-1">
                {stats.durationMs > 0
                  ? `avg ${formatBytes(Math.round(stats.totalBytes / stats.totalRequests))}/export`
                  : "1 export so far"}
              </div>
            </div>
          </div>
        )}

        <p className="text-sm text-gray-400 mb-4">
          {entries.length} trace entries received via direct OTLP export.
        </p>

        {entries.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            Waiting for traces from the web app&hellip;
            <br />
            <span className="text-xs mt-2 inline-block">
              The web app exports OTLP traces directly to <code className="bg-gray-800 px-1.5 py-0.5 rounded">/api/traces</code>
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {[...entries].reverse().map((entry) => {
              const isExpanded = expanded.has(entry.id);
              const p = entry.payload;
              const traceId = (p.traceId ?? p.trace_id ?? "") as string;
              const spanId = (p.spanId ?? p.span_id ?? "") as string;
              const message =
                (p.message ?? p.name ?? p.msg ?? JSON.stringify(p).slice(0, 80)) as string;

              return (
                <div
                  key={entry.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    className="w-full text-left px-4 py-3 flex items-start gap-4 hover:bg-gray-800/50"
                  >
                    <span className="text-xs text-gray-500 shrink-0 pt-0.5">
                      {new Date(entry.receivedAt).toLocaleTimeString()}
                    </span>
                    <span className="text-sm flex-1 truncate">{message}</span>
                    {traceId && (
                      <span className="text-xs text-blue-400 shrink-0 font-mono">
                        {traceId.slice(0, 16)}...
                      </span>
                    )}
                    {spanId && (
                      <span className="text-xs text-purple-400 shrink-0 font-mono">
                        {spanId.slice(0, 8)}...
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <pre className="px-4 py-3 text-xs bg-gray-950 border-t border-gray-800 overflow-x-auto">
                      {JSON.stringify(entry.payload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
