export { INDEXER_VERSION } from "./version.js";
export {
  decodeVirtualAddress,
  encodeVirtualAddress,
  isVirtualAddress,
  VIRTUAL_MAGIC,
} from "./codec/virtualAddress.js";
export type {
  BrandedAddress,
  DecodedVirtualAddress,
  MasterId,
  UserTag,
} from "./types/brands.js";
export * from "./chain/index.js";
export * from "./pairer/index.js";
export * from "./classifier/index.js";
export * from "./db/index.js";
export { BlockProcessor, createTempRepository } from "./ingest/processor.js";
