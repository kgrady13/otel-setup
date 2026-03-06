import { NextRequest, NextResponse } from "next/server";

export interface TraceEntry {
  id: string;
  receivedAt: number;
  bodyBytes: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

export interface TraceStats {
  totalBytes: number;
  totalRequests: number;
  firstRequestAt: number | null;
  lastRequestAt: number | null;
}

const MAX_ENTRIES = 500;
const entries: TraceEntry[] = [];
const stats: TraceStats = {
  totalBytes: 0,
  totalRequests: 0,
  firstRequestAt: null,
  lastRequestAt: null,
};

let nextId = 1;

function addEntry(payload: Record<string, unknown>, bodyBytes: number) {
  entries.push({
    id: String(nextId++),
    receivedAt: Date.now(),
    bodyBytes,
    payload,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.text();
  const bodyBytes = new TextEncoder().encode(body).byteLength;

  console.log(`[traces] POST received: ${bodyBytes} bytes, content-type: ${contentType}, url: ${request.nextUrl.pathname}`);

  const now = Date.now();
  stats.totalBytes += bodyBytes;
  stats.totalRequests += 1;
  if (!stats.firstRequestAt) stats.firstRequestAt = now;
  stats.lastRequestAt = now;

  if (contentType.includes("ndjson") || contentType.includes("x-ndjson")) {
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const perLineBytes = new TextEncoder().encode(trimmed).byteLength;
        addEntry(JSON.parse(trimmed), perLineBytes);
      } catch {
        // skip malformed lines
      }
    }
  } else {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        const perItemBytes = Math.round(bodyBytes / parsed.length);
        for (const item of parsed) {
          addEntry(item, perItemBytes);
        }
      } else {
        addEntry(parsed, bodyBytes);
      }
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, count: entries.length });
}

export async function GET(request: NextRequest) {
  const wantStats = request.nextUrl.searchParams.get("stats");
  if (wantStats !== null) {
    const totalGB = stats.totalBytes / (1024 * 1024 * 1024);

    let durationMs = 0;
    if (stats.firstRequestAt && stats.lastRequestAt) {
      durationMs = stats.lastRequestAt - stats.firstRequestAt;
    }

    const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
    let projectedMonthlyGB = 0;
    if (durationMs > 0) {
      const bytesPerMs = stats.totalBytes / durationMs;
      projectedMonthlyGB = (bytesPerMs * MS_PER_MONTH) / (1024 * 1024 * 1024);
    }

    return NextResponse.json({
      ...stats,
      totalGB: +totalGB.toFixed(6),
      durationMs,
      projectedMonthlyGB: +projectedMonthlyGB.toFixed(4),
    });
  }

  return NextResponse.json(entries);
}

export async function DELETE() {
  entries.length = 0;
  nextId = 1;
  stats.totalBytes = 0;
  stats.totalRequests = 0;
  stats.firstRequestAt = null;
  stats.lastRequestAt = null;
  return NextResponse.json({ ok: true });
}
