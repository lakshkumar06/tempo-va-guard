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
export {
  ConfirmationGate,
  ContinuityGuard,
  resolveFinalizedBlock,
  type FinalityMode,
  type RollbackOptions,
} from "./ingest/confirmation.js";
export { createApiServer } from "./api/server.js";
export { OutboxDispatcher } from "./webhook/dispatcher.js";
export { OutboxRepository } from "./webhook/outbox.js";
export { FakeClock, SystemClock } from "./webhook/clock.js";
export {
  FetchWebhookTransport,
  RecordingWebhookTransport,
} from "./webhook/transport.js";
