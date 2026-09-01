import { describe, expect, it } from "vitest";
import { INDEXER_VERSION } from "../src/version.js";

describe("indexer scaffold", () => {
  it("exports version", () => {
    expect(INDEXER_VERSION).toBe("0.1.0");
  });
});
