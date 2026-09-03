import { describe, expect, it } from "vitest";
import { assertSafeWebhookUrl } from "../../src/webhook/transport.js";

describe("assertSafeWebhookUrl", () => {
  it("requires https", async () => {
    await expect(
      assertSafeWebhookUrl("http://example.com/hook"),
    ).rejects.toThrow(/https/);
  });

  it("rejects credentials in the URL", async () => {
    await expect(
      assertSafeWebhookUrl("https://user:pass@example.com/hook"),
    ).rejects.toThrow(/credentials/);
  });

  it("rejects private IPv4 literals", async () => {
    await expect(
      assertSafeWebhookUrl("https://127.0.0.1/hook"),
    ).rejects.toThrow(/private/);
  });

  it("enforces host allowlist when configured", async () => {
    await expect(
      assertSafeWebhookUrl("https://evil.example/hook", ["hooks.good.example"]),
    ).rejects.toThrow(/allowlisted/);
  });
});
