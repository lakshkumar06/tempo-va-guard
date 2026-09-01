import {
  type Address,
  concat,
  getAddress,
  hexToBytes,
  isAddress,
  pad,
  slice,
  toHex,
} from "viem";
import {
  asAddress,
  asMasterId,
  asUserTag,
  type BrandedAddress,
  type DecodedVirtualAddress,
  type MasterId,
  type UserTag,
} from "../types/brands.js";

/** Fixed 10-byte marker at bytes [4:14] per TIP-1022. */
export const VIRTUAL_MAGIC =
  "0xfdfdfdfdfdfdfdfdfdfd" as const;

const MASTER_ID_BYTES = 4;
const MAGIC_BYTES = 10;
const USER_TAG_BYTES = 6;
const ADDRESS_BYTES = 20;

export class InvalidVirtualAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVirtualAddressError";
  }
}

function assertExactByteLength(hex: string, bytes: number, label: string): void {
  const actual = hexToBytes(hex as `0x${string}`).length;
  if (actual !== bytes) {
    throw new InvalidVirtualAddressError(
      `${label} must be exactly ${bytes} bytes, got ${actual}`,
    );
  }
}

function normalizeAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new InvalidVirtualAddressError(`Invalid address: ${address}`);
  }
  return getAddress(address);
}

/**
 * Returns true when bytes [4:14] equal the TIP-1022 virtual magic.
 * Does not check whether masterId is registered onchain.
 */
export function isVirtualAddress(address: string): boolean {
  try {
    const resolved = normalizeAddress(address);
    const magic = slice(resolved, 4, 14).toLowerCase();
    return magic === VIRTUAL_MAGIC;
  } catch {
    return false;
  }
}

/** Build a virtual address from masterId + userTag. */
export function encodeVirtualAddress(
  masterId: MasterId,
  userTag: UserTag,
): BrandedAddress {
  assertExactByteLength(masterId, MASTER_ID_BYTES, "masterId");
  assertExactByteLength(userTag, USER_TAG_BYTES, "userTag");

  const packed = concat([
    pad(masterId, { size: MASTER_ID_BYTES }),
    pad(VIRTUAL_MAGIC, { size: MAGIC_BYTES }),
    pad(userTag, { size: USER_TAG_BYTES }),
  ]);

  assertExactByteLength(packed, ADDRESS_BYTES, "virtual address");
  return asAddress(getAddress(packed));
}

/** Decode masterId and userTag from a virtual address. */
export function decodeVirtualAddress(address: string): DecodedVirtualAddress {
  const resolved = normalizeAddress(address);
  const magic = slice(resolved, 4, 14).toLowerCase();

  if (magic !== VIRTUAL_MAGIC) {
    throw new InvalidVirtualAddressError(
      `Address ${resolved} does not contain the TIP-1022 virtual marker`,
    );
  }

  return {
    masterId: asMasterId(slice(resolved, 0, 4).toLowerCase() as MasterId),
    userTag: asUserTag(slice(resolved, 14, 20).toLowerCase() as UserTag),
  };
}

/** Random masterId/userTag helpers for tests. */
export function randomBytesHex(length: number): `0x${string}` {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
