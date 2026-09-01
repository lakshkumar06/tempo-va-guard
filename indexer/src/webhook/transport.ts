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

export class FetchWebhookTransport implements WebhookTransport {
  async deliver(
    request: WebhookDeliveryRequest,
  ): Promise<WebhookDeliveryResult> {
    try {
      const response = await fetch(request.endpoint, {
        method: "POST",
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
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "network error",
        retryable: true,
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
