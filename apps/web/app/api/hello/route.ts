import { NextResponse } from "next/server";
import { trace } from "@opentelemetry/api";

export const dynamic = "force-dynamic";

const tracer = trace.getTracer("my-frontend");

export async function GET() {
  return await tracer.startActiveSpan("GET /api/hello", async (span) => {
    try {
      const data = await tracer.startActiveSpan("fetchGreeting", async (inner) => {
        try {
          // Simulate downstream work
          const greeting = { message: "hello", timestamp: Date.now() };
          inner.setAttribute("greeting.length", JSON.stringify(greeting).length);
          return greeting;
        } finally {
          inner.end();
        }
      });

      span.setAttribute("response.status", 200);
      return NextResponse.json(data);
    } finally {
      span.end();
    }
  });
}
