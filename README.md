# OpenTelemetry in Next.js on Vercel: Sending Traces to Your Collectors

**This repo is a working demo.** It's a Turborepo monorepo with two Next.js 16 apps:

- `apps/web` — instrumented with OpenTelemetry, exports traces via OTLP HTTP
- `apps/log-viewer` — receives and displays traces in a simple UI

## Quick Start

```bash
pnpm install
pnpm dev
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3001/api/traces` in `apps/web/.env.local`, then visit:

- http://localhost:3000/api/hello — generates traces
- http://localhost:3001 — view them in the trace viewer

This guide covers how to instrument a Next.js 16 app deployed on Vercel with OpenTelemetry and send traces directly to an external backend (e.g. GCP). No Vercel-specific pipeline or "drain" is required — your functions export traces over standard OTLP HTTP, the same as any other service in your architecture.

---

## How It Works

Your Next.js functions run OpenTelemetry instrumentation and export spans directly to your collector over OTLP HTTP. The data goes straight from the function to your endpoint. This is platform-agnostic, uses the standard OTel SDK, and has no Vercel-specific cost (no MIU impact for the export itself).

```
[ Next.js Function ] --OTLP/HTTP--> [ Your GCP Collector ]
```

---

## Option A: `@vercel/otel` with Custom Exporter (Recommended)

`@vercel/otel` is a thin wrapper around the standard OTel SDK that adds Edge runtime compatibility and handles Next.js-specific setup. Under the hood it's still OTel-standard — your collector receives the same OTLP payloads as from any other service.

### Install

```bash
pnpm i @opentelemetry/api @vercel/otel
```

### Create `instrumentation.ts` (project root or `src/`)

```ts
import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: "example-frontend",
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT!,
    }),
  });
}
```

### Set Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables (or `.env.local` for local dev):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-gcp-collector.example.com/v1/traces
```

That's it. Your traces go straight to your collector.

---

## Option B: Standard OTel SDK (Fully Platform-Agnostic)

### Install

```bash
pnpm i @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/resources \
  @opentelemetry/semantic-conventions @opentelemetry/sdk-trace-node \
  @opentelemetry/exporter-trace-otlp-http
```

### Create `instrumentation.node.ts`

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "my-frontend",
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: {
      Authorization: `Bearer ${process.env.OTEL_AUTH_TOKEN}`,
    },
  }),
});

sdk.start();
```

### Create `instrumentation.ts` (project root or `src/`)

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
```

### Set Environment Variables

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-gcp-collector.example.com/v1/traces
OTEL_AUTH_TOKEN=your-token-here
```

> **Note:** `@opentelemetry/sdk-node` does not support Edge runtime. This is fine if your business logic runs on Node.js runtime.

> **Limitation:** If you use manual OpenTelemetry SDK configuration without `@vercel/otel`, you will not be able to use [Session Tracing](https://vercel.com/docs/tracing) or [Trace Drains](https://vercel.com/docs/drains/reference/traces) on Vercel.

---

## Controlling Data Volume (Sampling)

For high-traffic apps, you want to sample at the SDK level so data is filtered **before** it leaves the function. This is where you control cost.

### With `@vercel/otel` (Option A)

```bash
OTEL_TRACES_SAMPLER=traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

### With the Standard SDK (Option B)

```ts
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(
    process.env.NODE_ENV === "production" ? 0.1 : 1.0, // 10% in prod
  ),
  // ... rest of config
});
```

---

## Connecting Frontend Traces to Backend Services

To get one end-to-end distributed trace from Next.js through to your GCP microservices, you need context propagation. This injects the `traceparent` header into outbound fetches so your service mesh can continue the trace.

### With `@vercel/otel` (Option A)

```ts
registerOTel({
  serviceName: "example-frontend",
  traceExporter: new OTLPHttpJsonTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT!,
  }),
  instrumentationConfig: {
    fetch: {
      propagateContextUrls: ["your-bff.example.com", "*.internal.example.com"],
      dontPropagateContextUrls: ["cdn.example.com"],
    },
  },
});
```

### With the Standard SDK (Option B)

Context propagation is enabled by default for all outbound HTTP requests when using `@opentelemetry/instrumentation-fetch` or `@opentelemetry/instrumentation-http`. No additional config needed.

---

## Adding Custom Spans

Same API regardless of which option you chose:

```ts
import { trace } from "@opentelemetry/api";

export async function fetchProductData(productId: string) {
  return await trace
    .getTracer("my-frontend")
    .startActiveSpan("fetchProductData", async (span) => {
      try {
        span.setAttribute("product.id", productId);
        const result = await getProduct(productId);
        span.setAttribute("product.found", !!result);
        return result;
      } finally {
        span.end();
      }
    });
}
```

---

## FAQ

| Question                                           | Answer                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do I need Vercel Drains?                           | No. Direct export sends traces straight to your collector. Drains are a separate Vercel feature for forwarding Vercel's own platform logs/metrics — not needed here. |
| Is this platform-agnostic?                         | Yes. Both options emit standard OTLP — your collector can't tell the difference.                                                                                     |
| Does this cost MIUs?                               | No. The OTLP export happens directly from the function to your endpoint.                                                                                             |
| Does this work with our GCP collectors?            | Yes. Any OTLP-compatible endpoint works. GCP Cloud Trace has an OTLP endpoint, or you can point at your own collector.                                               |
| How do I control data volume?                      | SDK-level sampling (`TraceIdRatioBasedSampler` or env vars). Data is filtered before it ever leaves the function.                                                    |
| How do I get one trace from Next.js → GCP backend? | Context propagation. The `traceparent` header is injected into outbound fetches, and your GCP service mesh picks it up.                                              |

## References

- [Next.js Docs — OpenTelemetry Guide](https://nextjs.org/docs/app/guides/open-telemetry)
- [Next.js Docs — Instrumentation](https://nextjs.org/docs/pages/guides/instrumentation)
- [Vercel Docs — Tracing Instrumentation](https://vercel.com/docs/tracing/instrumentation)
- [OpenTelemetry JS — Getting Started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
