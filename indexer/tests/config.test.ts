import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults for the stuck watcher", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.virtualAddresses).toHaveLength(1);
  });

  it("rejects malformed virtual addresses", () => {
    expect(() =>
      loadConfig({ VIRTUAL_ADDRESSES: "not-an-address" }),
    ).toThrow(/Invalid config/);
  });
});
