import { encodeAbiParameters, parseAbiParameters, toEventSelector, type Hash } from "viem";
import { makeTransferLog } from "../../src/chain/fakeChain.js";
import { padAddressTopic, type IndexedLog, TIP20_TOKENS } from "../../src/chain/types.js";
import { encodeVirtualAddress } from "../../src/codec/virtualAddress.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";

const TRANSFER_WITH_MEMO_TOPIC = toEventSelector(
  "event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 memo)",
);
const MINT_TOPIC = toEventSelector(
  "event Mint(address indexed to, uint256 amount)",
);
const MASTER = "0xD79c4cF03a2244F599200073ac704392dd6a84a0" as const;
const SENDER = "0x1111111111111111111111111111111111111111" as const;
const VIRTUAL = encodeVirtualAddress(
  asMasterId("0xb1977b69"),
  asUserTag("0x000000000001"),
);
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function txMeta(blockNumber = 100n, txHash = "0xabc" as Hash) {
  return {
    blockNumber,
    blockHash: "0xblock" as Hash,
    transactionHash: txHash,
  };
}

function makeTransferWithMemoLog(params: {
  token: typeof TOKEN;
  from: typeof SENDER;
  to: typeof VIRTUAL;
  amount: bigint;
  memo: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
}): IndexedLog {
  return {
    address: params.token,
    blockHash: params.blockHash,
    blockNumber: params.blockNumber,
    data: encodeAbiParameters(
      parseAbiParameters("uint256 amount, bytes32 memo"),
      [params.amount, params.memo],
    ),
    logIndex: params.logIndex,
    removed: false,
    topics: [
      TRANSFER_WITH_MEMO_TOPIC,
      padAddressTopic(params.from),
      padAddressTopic(params.to),
    ],
    transactionHash: params.transactionHash,
    transactionIndex: 0,
  };
}

function makeMintLog(params: {
  token: typeof TOKEN;
  to: typeof VIRTUAL;
  amount: bigint;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
}): IndexedLog {
  return {
    address: params.token,
    blockHash: params.blockHash,
    blockNumber: params.blockNumber,
    data: encodeAbiParameters(parseAbiParameters("uint256 amount"), [
      params.amount,
    ]),
    logIndex: params.logIndex,
    removed: false,
    topics: [MINT_TOPIC, padAddressTopic(params.to)],
    transactionHash: params.transactionHash,
    transactionIndex: 0,
  };
}

const TOKEN = TIP20_TOKENS[0];

export function buildTransferFixtureLogs(): IndexedLog[] {
  const meta = txMeta();
  return [
    makeTransferLog({
      token: TOKEN,
      from: SENDER,
      to: VIRTUAL,
      amount: 5_000_000n,
      logIndex: 0,
      ...meta,
    }),
    makeTransferLog({
      token: TOKEN,
      from: VIRTUAL,
      to: MASTER,
      amount: 5_000_000n,
      logIndex: 1,
      ...meta,
    }),
  ];
}

export function buildTransferWithMemoFixtureLogs(): IndexedLog[] {
  const meta = txMeta(101n, "0xdef" as Hash);
  const memo =
    "0x00000000000000000000000000000000000000000000000000000000000000c0" as const;

  return [
    makeTransferLog({
      token: TOKEN,
      from: SENDER,
      to: VIRTUAL,
      amount: 1_000_000n,
      logIndex: 0,
      ...meta,
    }),
    makeTransferWithMemoLog({
      token: TOKEN,
      from: SENDER,
      to: VIRTUAL,
      amount: 1_000_000n,
      memo,
      logIndex: 1,
      ...meta,
    }),
    makeTransferLog({
      token: TOKEN,
      from: VIRTUAL,
      to: MASTER,
      amount: 1_000_000n,
      logIndex: 2,
      ...meta,
    }),
  ];
}

export function buildMintFixtureLogs(): IndexedLog[] {
  const meta = txMeta(102n, "0x111" as Hash);
  return [
    makeTransferLog({
      token: TOKEN,
      from: ZERO,
      to: VIRTUAL,
      amount: 2_000_000n,
      logIndex: 0,
      ...meta,
    }),
    makeMintLog({
      token: TOKEN,
      to: VIRTUAL,
      amount: 2_000_000n,
      logIndex: 1,
      ...meta,
    }),
    makeTransferLog({
      token: TOKEN,
      from: VIRTUAL,
      to: MASTER,
      amount: 2_000_000n,
      logIndex: 2,
      ...meta,
    }),
  ];
}

export function buildNonTip20StuckFixtureLogs(): IndexedLog[] {
  const meta = txMeta(103n, "0x222" as Hash);
  return [
    makeTransferLog({
      token: "0xd51c28223D96a64F6401e4Ed4cB5dBdA9Ae747ff",
      from: SENDER,
      to: VIRTUAL,
      amount: 100n * 10n ** 18n,
      logIndex: 0,
      ...meta,
    }),
  ];
}

export function buildSelfForwardFixtureLogs(): IndexedLog[] {
  const meta = txMeta(104n, "0x333" as Hash);
  return [
    makeTransferLog({
      token: TOKEN,
      from: MASTER,
      to: VIRTUAL,
      amount: 500_000n,
      logIndex: 0,
      ...meta,
    }),
    makeTransferLog({
      token: TOKEN,
      from: VIRTUAL,
      to: MASTER,
      amount: 500_000n,
      logIndex: 1,
      ...meta,
    }),
  ];
}

export function buildDirectToMasterFixtureLogs(): IndexedLog[] {
  const meta = txMeta(105n, "0x444" as Hash);
  return [
    makeTransferLog({
      token: TOKEN,
      from: SENDER,
      to: MASTER,
      amount: 250_000n,
      logIndex: 0,
      ...meta,
    }),
  ];
}
