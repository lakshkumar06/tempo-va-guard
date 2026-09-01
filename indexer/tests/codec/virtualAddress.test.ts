import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VirtualAddress } from "viem/tempo";
import {
  decodeVirtualAddress,
  encodeVirtualAddress,
  isVirtualAddress,
} from "../../src/codec/virtualAddress.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";

const KNOWN_VIRTUAL = "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001";

describe("virtual address codec", () => {
  it("matches the hand-verified address from scripts/derive-address.js", () => {
    const encoded = encodeVirtualAddress(
      asMasterId("0xb1977b69"),
      asUserTag("0x000000000001"),
    );
    expect(encoded).toBe(KNOWN_VIRTUAL);
  });

  it("decodes the known virtual address", () => {
    const decoded = decodeVirtualAddress(KNOWN_VIRTUAL);
    expect(decoded.masterId).toBe("0xb1977b69");
    expect(decoded.userTag).toBe("0x000000000001");
  });

  it("accepts userTag 0x000000000000", () => {
    const encoded = encodeVirtualAddress(
      asMasterId("0xdeadbeef"),
      asUserTag("0x000000000000"),
    );
    expect(isVirtualAddress(encoded)).toBe(true);
    expect(decodeVirtualAddress(encoded).userTag).toBe("0x000000000000");
  });

  it("returns false for a normal EOA address", () => {
    expect(isVirtualAddress("0xD79c4cF03a2244F599200073ac704392dd6a84a0")).toBe(
      false,
    );
  });

  it("round-trips via property test", () => {
    const masterIdArb = fc
      .uint8Array({ minLength: 4, maxLength: 4 })
      .map((b) => asMasterId(`0x${Buffer.from(b).toString("hex")}` as const));
    const userTagArb = fc
      .uint8Array({ minLength: 6, maxLength: 6 })
      .map((b) => asUserTag(`0x${Buffer.from(b).toString("hex")}` as const));

    fc.assert(
      fc.property(masterIdArb, userTagArb, (masterId, userTag) => {
        const encoded = encodeVirtualAddress(masterId, userTag);
        expect(isVirtualAddress(encoded)).toBe(true);
        expect(decodeVirtualAddress(encoded)).toEqual({ masterId, userTag });
      }),
    );
  });

  it("agrees with viem/ox VirtualAddress helpers", () => {
    const masterIdArb = fc
      .uint8Array({ minLength: 4, maxLength: 4 })
      .map((b) => `0x${Buffer.from(b).toString("hex")}` as const);
    const userTagArb = fc
      .uint8Array({ minLength: 6, maxLength: 6 })
      .map((b) => `0x${Buffer.from(b).toString("hex")}` as const);

    fc.assert(
      fc.property(masterIdArb, userTagArb, (masterId, userTag) => {
        const ours = encodeVirtualAddress(
          asMasterId(masterId),
          asUserTag(userTag),
        );
        const theirs = VirtualAddress.from({ masterId, userTag });

        expect(ours.toLowerCase()).toBe(theirs.toLowerCase());
        expect(isVirtualAddress(ours)).toBe(VirtualAddress.isVirtual(ours));

        const decoded = decodeVirtualAddress(ours);
        const parsed = VirtualAddress.parse(ours);
        expect(decoded.masterId.toLowerCase()).toBe(
          parsed.masterId.toLowerCase(),
        );
        expect(decoded.userTag.toLowerCase()).toBe(parsed.userTag.toLowerCase());
      }),
    );
  });
});
