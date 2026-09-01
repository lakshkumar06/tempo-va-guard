const { parentPort, workerData } = require("worker_threads");
const keccak256 = require("keccak");
const crypto = require("crypto");

const { addressHex, workerId } = workerData;
const addrBytes = Buffer.from(addressHex.slice(2), "hex");

const buf = Buffer.alloc(52);
addrBytes.copy(buf, 0);
crypto.randomFillSync(buf, 20, 32); // random starting salt per worker, so workers don't overlap

let attempts = 0;
const REPORT_EVERY = 1000000;

while (true) {
  // increment the salt portion each try (cheap, deterministic walk from a random start)
  for (let i = 51; i >= 20; i--) {
    buf[i]++;
    if (buf[i] !== 0) break;
  }

  const digest = keccak256("keccak256").update(buf).digest();
  attempts++;

  if (digest[0] === 0 && digest[1] === 0 && digest[2] === 0 && digest[3] === 0) {
    parentPort.postMessage({
      found: true,
      salt: "0x" + buf.slice(20, 52).toString("hex"),
      masterId: "0x" + digest.slice(4, 8).toString("hex"),
      attempts
    });
    return;
  }

  if (attempts % REPORT_EVERY === 0) {
    parentPort.postMessage({ found: false, attempts, workerId });
  }
}