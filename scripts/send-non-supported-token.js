require("dotenv").config({ path: require("path").join(__dirname, "../sample-token/.env") });
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const TOKEN_ADDRESS = "0xd51c28223D96a64F6401e4Ed4cB5dBdA9Ae747ff"; // your deployed SimpleToken
const VIRTUAL_ADDRESS = "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001"; // your REGISTERED virtual address

const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "../sample-token/SimpleToken.abi.json"), "utf8"));

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

  const amount = ethers.parseUnits("100", 18);

  console.log("=== SENDING NON-TIP20 TOKEN TO VIRTUAL ADDRESS ===");
  console.log("Token:  ", TOKEN_ADDRESS, "(plain ERC-20, NOT TIP-20)");
  console.log("To:     ", VIRTUAL_ADDRESS);
  console.log("Amount: ", ethers.formatUnits(amount, 18), "TST");
  console.log("");

  const tx = await token.transfer(VIRTUAL_ADDRESS, amount);
  console.log("Tx submitted:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
  console.log("");

  console.log("=== TRANSFER EVENTS ===");
  const iface = new ethers.Interface(abi);
  let hops = 0;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === "Transfer") {
        hops++;
        console.log(`Hop ${hops}: from ${parsed.args.from} -> to ${parsed.args.to}, amount ${ethers.formatUnits(parsed.args.value, 18)}`);
      }
    } catch (e) {}
  }
  console.log("");
  console.log(`Total Transfer events: ${hops} (expect just 1 — no auto-forward for non-TIP20 tokens)`);
  console.log("");

  const virtualBalance = await token.balanceOf(VIRTUAL_ADDRESS);
  console.log("=== RESULT ===");
  console.log("Virtual address balance now:", ethers.formatUnits(virtualBalance, 18), "TST");
  console.log(virtualBalance > 0n ? "STUCK — funds sitting at the virtual address, no owner can claim them" : "Unexpected — forwarded?");
}

main().catch((err) => console.error("Failed:", err.message));