require("dotenv").config({ path: require("path").join(__dirname, "../sample-token/.env") });
const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PATHUSD = "0x20c0000000000000000000000000000000000000";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RECIPIENT = "0xD79c4cF03a2244F599200073ac704392dd6a84a0";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set — copy pow/.env.example to sample-token/.env");
  }

  const token = new ethers.Contract(PATHUSD, ABI, wallet);
  const decimals = await token.decimals();
  const amount = ethers.parseUnits("10", decimals); // send 10 pathUSD

  const tx = await token.transfer(RECIPIENT, amount);
  console.log("Sent! Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main();