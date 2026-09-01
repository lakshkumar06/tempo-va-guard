require("dotenv").config({ path: require("path").join(__dirname, "../sample-token/.env") });
const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PATHUSD = "0x20c0000000000000000000000000000000000000";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VIRTUAL_ADDRESS = "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001";

const TOKEN_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env — check your env variable name");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(PATHUSD, TOKEN_ABI, wallet);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits("5", decimals); // send 5 pathUSD

  console.log("=== SENDING ===");
  console.log("From:        ", wallet.address);
  console.log("To (virtual):", VIRTUAL_ADDRESS);
  console.log("Amount:      ", ethers.formatUnits(amount, decimals), "pathUSD");
  console.log("");

  const balanceBefore = await token.balanceOf(wallet.address);
  console.log("Sender balance before:", ethers.formatUnits(balanceBefore, decimals), "pathUSD");

  const tx = await token.transfer(VIRTUAL_ADDRESS, amount);
  console.log("");
  console.log("Tx submitted. Hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();

  console.log("");
  console.log("=== CONFIRMED ===");
  console.log("Tx hash:      ", receipt.hash);
  console.log("Block number: ", receipt.blockNumber);
  console.log("Gas used:     ", receipt.gasUsed.toString());
  console.log("Status:       ", receipt.status === 1 ? "SUCCESS" : "FAILED");
  console.log("");

  console.log("=== TRANSFER EVENTS (raw logs) ===");
  const iface = new ethers.Interface(TOKEN_ABI);
  let hopNumber = 1;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === "Transfer") {
        console.log(`Hop ${hopNumber}:`);
        console.log("  from:  ", parsed.args.from);
        console.log("  to:    ", parsed.args.to);
        console.log("  amount:", ethers.formatUnits(parsed.args.value, decimals), "pathUSD");
        console.log("");
        hopNumber++;
      }
    } catch (e) {
      // not a Transfer event, skip
    }
  }

  const balanceAfter = await token.balanceOf(wallet.address);
  const virtualBalance = await token.balanceOf(VIRTUAL_ADDRESS);

  console.log("=== FINAL BALANCES ===");
  console.log("Sender balance after:", ethers.formatUnits(balanceAfter, decimals), "pathUSD");
  console.log("Virtual address balance:", ethers.formatUnits(virtualBalance, decimals), "pathUSD (should be 0)");
}

main().catch((err) => {
  console.error("Transfer failed:", err.message);
});