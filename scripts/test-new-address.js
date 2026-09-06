require("dotenv").config({ path: require("path").join(__dirname, "../sample-token/.env") });
const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PATHUSD = "0x20c0000000000000000000000000000000000000";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Same registered masterId (0xb1977b69), unused userTag
const NEW_VIRTUAL_ADDRESS = "0xB1977B69FDfDFDFDFdFDFDfdfDFd000000000099";

const ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set — copy pow/.env.example to sample-token/.env");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(PATHUSD, ABI, wallet);
  const decimals = await token.decimals();
  const amount = ethers.parseUnits("3", decimals);

  console.log("Sending to NEW/unused userTag under SAME registered masterId...");
  console.log("Virtual address:", NEW_VIRTUAL_ADDRESS);

  const tx = await token.transfer(NEW_VIRTUAL_ADDRESS, amount);
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "FAILED");

  const iface = new ethers.Interface(ABI);
  let hops = 0;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === "Transfer") {
        hops++;
        console.log(
          `Hop ${hops}: ${parsed.args.from} -> ${parsed.args.to}, ${ethers.formatUnits(parsed.args.value, decimals)}`
        );
      }
    } catch {
      // not a Transfer event
    }
  }
}

main().catch((err) => console.log("REVERTED:", err.reason || err.shortMessage || err.message));
