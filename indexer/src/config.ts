import { z } from "zod";
import { TEMPO_MODERATO_RPC_URL } from "./chain/types.js";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x-prefixed 20-byte address");

const configSchema = z.object({
  rpcUrl: z.string().url().default(TEMPO_MODERATO_RPC_URL),
  virtualAddresses: z.array(addressSchema).min(1),
  pollIntervalMs: z.coerce.number().int().positive().default(1_000),
  lookbackBlocks: z.coerce.number().int().nonnegative().default(30),
  port: z.coerce.number().int().positive().default(8787),
  apiToken: z.string().min(8).optional(),
  dbPath: z.string().default("./data/indexer.db"),
});

export type IndexerConfig = z.infer<typeof configSchema>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): IndexerConfig {
  const virtualAddresses = (
    env.VIRTUAL_ADDRESSES?.split(",").map((value) => value.trim()) ?? [
      "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
    ]
  ).filter(Boolean);

  const parsed = configSchema.safeParse({
    rpcUrl: env.RPC_URL,
    virtualAddresses,
    pollIntervalMs: env.POLL_MS,
    lookbackBlocks: env.LOOKBACK_BLOCKS,
    port: env.PORT,
    apiToken: env.INDEXER_API_TOKEN || undefined,
    dbPath: env.DB_PATH,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config: ${details}`);
  }

  return parsed.data;
}
