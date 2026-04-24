import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { trace, metrics, type Tracer, type Meter } from "@opentelemetry/api";

let initialized = false;
let sdk: NodeSDK | null = null;

export function initTelemetry(serviceName = "mcp-conductor", serviceVersion = "0.2.0"): void {
  if (initialized) return;
  initialized = true;
  const url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!url) {
    console.error("[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT not set — traces disabled");
    return;
  }
  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${url}/v1/traces` }),
  });
  sdk.start();
  console.error(`[telemetry] OTLP exporter → ${url}`);
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    initialized = false;
    return;
  }
  try {
    await sdk.shutdown();
  } finally {
    sdk = null;
    initialized = false;
  }
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

export function getMeter(name: string): Meter {
  return metrics.getMeter(name);
}
