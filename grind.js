const { Worker } = require("worker_threads");
const os = require("os");

const ADDRESS = "0x1Da4D0e37292c09aB56C99F8E39c21351184ebbA"; // your wallet address

const numWorkers = os.cpus().length;
console.log(`Starting ${numWorkers} workers...`);

let totalAttempts = 0;
const start = Date.now();
let found = false;

for (let i = 0; i < numWorkers; i++) {
  const worker = new Worker("./worker.js", {
    workerData: { addressHex: ADDRESS, workerId: i }
  });

  worker.on("message", (msg) => {
    if (msg.found && !found) {
      found = true;
      const elapsed = (Date.now() - start) / 1000;
      console.log(`\nFOUND! (worker ${msg.workerId}, ${msg.attempts} local attempts, ${elapsed.toFixed(1)}s elapsed)`);
      console.log("Salt:", msg.salt);
      console.log("MasterId:", msg.masterId);
      process.exit(0);
    } else if (!found) {
      totalAttempts += 1000000;
      const elapsed = (Date.now() - start) / 1000;
      console.log(`Total: ~${totalAttempts.toLocaleString()} attempts, ${Math.round(totalAttempts/elapsed).toLocaleString()}/sec, elapsed ${elapsed.toFixed(0)}s`);
    }
  });
}