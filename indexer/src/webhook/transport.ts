import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export type WebhookDeliveryRequest = {
  endpoint: string;
  idempotencyKey: string;
  timestamp: string;
  signature: string;
  body: string;
};

export type WebhookDeliveryResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string; retryable: boolean };

export interface WebhookTransport {
  deliver(request: WebhookDeliveryRequest): Promise<WebhookDeliveryResult>;
}

export type FetchWebhookTransportOptions = {
  /** Abort delivery after this many ms (must stay below outbox lease). */
  timeoutMs?: number;
  /** Extra hostnames allowed beyond the endpoint's original host. Default: none. */
  allowedHosts?: readonly string[];
};

function isPrivateOrLocalIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return true;
}

/**
 * Validate webhook endpoint before fetch:
 * HTTPS only, no credentials, host allowlist, no private/link-local DNS targets.
 */
export async function assertSafeWebhookUrl(
  endpoint: string,
  allowedHosts?: readonly string[],
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("invalid webhook URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("webhook URL must use https");
  }
  if (url.username || url.password) {
    throw new Error("webhook URL must not include credentials");
  }

  const host = url.hostname.toLowerCase();
  if (allowedHosts && allowedHosts.length > 0) {
    const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
    if (!allowed.has(host)) {
      throw new Error(`webhook host ${host} is not allowlisted`);
    }
  }

  if (isIP(host) && isPrivateOrLocalIp(host)) {
    throw new Error("webhook URL resolves to a private or link-local address");
  }

  if (!isIP(host)) {
    const records = await lookup(host, { all: true });
    for (const record of records) {
      if (isPrivateOrLocalIp(record.address)) {
        throw new Error(
          "webhook URL resolves to a private or link-local address",
        );
      }
    }
  }

  return url;
}

export class FetchWebhookTransport implements WebhookTransport {
  private readonly timeoutMs: number;
  private readonly allowedHosts?: readonly string[];

  constructor(options: FetchWebhookTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.allowedHosts = options.allowedHosts;
  }

  async deliver(
    request: WebhookDeliveryRequest,
  ): Promise<WebhookDeliveryResult> {
    try {
      await assertSafeWebhookUrl(request.endpoint, this.allowedHosts);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(request.endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "idempotency-key": request.idempotencyKey,
            "x-tempo-timestamp": request.timestamp,
            "x-tempo-signature": request.signature,
          },
          body: request.body,
        });

        if (response.ok) {
          return { ok: true, status: response.status };
        }

        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}`,
          retryable: response.status >= 500 || response.status === 429,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      const retryable =
        message.includes("abort") ||
        message.includes("network") ||
        message.includes("fetch");
      return {
        ok: false,
        error: message,
        // SSRF / URL policy failures should not be retried forever.
        retryable:
          retryable &&
          !message.includes("private") &&
          !message.includes("https") &&
          !message.includes("allowlisted") &&
          !message.includes("credentials") &&
          !message.includes("invalid webhook"),
      };
    }
  }
}

export class RecordingWebhookTransport implements WebhookTransport {
  readonly deliveries: WebhookDeliveryRequest[] = [];
  private responses: WebhookDeliveryResult[] = [];

  queueResponses(...responses: WebhookDeliveryResult[]): void {
    this.responses.push(...responses);
  }

  async deliver(
    request: WebhookDeliveryRequest,
  ): Promise<WebhookDeliveryResult> {
    this.deliveries.push(request);
    return (
      this.responses.shift() ?? {
        ok: true,
        status: 200,
      }
    );
  }
}
