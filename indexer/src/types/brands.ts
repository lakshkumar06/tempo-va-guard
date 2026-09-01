import type { Address, Hex } from "viem";

/** Checksummed 20-byte EVM address. */
export type BrandedAddress = Address & { readonly __brand: "Address" };

/** 4-byte TIP-1022 master identifier. */
export type MasterId = Hex & { readonly __brand: "MasterId" };

/** 6-byte opaque customer routing tag. */
export type UserTag = Hex & { readonly __brand: "UserTag" };

export function asAddress(value: string): BrandedAddress {
  return value as BrandedAddress;
}

export function asMasterId(value: Hex): MasterId {
  return value as MasterId;
}

export function asUserTag(value: Hex): UserTag {
  return value as UserTag;
}

export type DecodedVirtualAddress = {
  masterId: MasterId;
  userTag: UserTag;
};
