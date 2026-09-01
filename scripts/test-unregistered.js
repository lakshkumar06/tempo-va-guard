require("dotenv").config({ path: require("path").join(__dirname, "../sample-token/.env") });
const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PATHUSD = "0x20c0000000000000000000000000000000000000";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VIRTUAL_MAGIC = "0xFDFDFDFDFDFDFDFDFDFD";
const FAKE_MASTER_ID = "0xdeadbeef"; // made up, definitely not registered
const USER_TAG = "0x000000000099";

const TOKEN_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

function buildVirtualAddress(masterId, userTag) {
  const packed = ethers.concat([masterId, VIRTUAL_MAGIC, userTag]);
  return ethers.getAddress(packed);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(PATHUSD, TOKEN_ABI, wallet);

  const fakeVirtualAddress = buildVirtualAddress(FAKE_MASTER_ID, USER_TAG);
  console.log("Unregistered virtual address:", fakeVirtualAddress);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits("1", decimals);

  console.log("Attempting transfer of 1 pathUSD to it...");
  try {
    const tx = await token.transfer(fakeVirtualAddress, amount);
    await tx.wait();
    console.log("Unexpected success — this should not happen!");
} catch (err) {
    console.log("");
    console.log("=== REVERTED ===");

    const KNOWN_ERRORS = {
      "0xda56842c": "VirtualAddressUnregistered()",
      // add more selectors here as you test other errors
    };

    const errorData = err.data || err.info?.error?.data;
    if (errorData) {
      const selector = errorData.slice(0, 10);
      console.log("Raw error selector:", selector);
      console.log("Decoded error:", KNOWN_ERRORS[selector] || "unknown selector");
    } else {
      console.log("Error reason:", err.reason || err.shortMessage || err.message);
    }
  }
}

main();