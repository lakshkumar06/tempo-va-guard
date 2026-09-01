const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const REGISTRY_ADDRESS = "0xFDC0000000000000000000000000000000000000";
const PRIVATE_KEY = "0x54b9432595087fd5def46ac24e23d97e27ab75230a8b17b0a038fbaedae7762b"; // same wallet as before

const SALT = "0x8d8cec2f6b29ec2dd4d6a93e0ce88f3579b089d6f11f122f599df59c4424b925";

const REGISTRY_ABI = [
  "function registerVirtualMaster(bytes32 salt) returns (bytes4 masterId)",
  "event MasterRegistered(bytes4 indexed masterId, address indexed masterAddress)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

  console.log("Submitting registration with salt:", SALT);
  const tx = await registry.registerVirtualMaster(SALT);
  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // Parse the MasterRegistered event from the logs
  const iface = new ethers.Interface(REGISTRY_ABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === "MasterRegistered") {
        console.log("MasterRegistered event found!");
        console.log("  masterId:", parsed.args.masterId);
        console.log("  masterAddress:", parsed.args.masterAddress);
      }
    } catch (e) {
      // not this event, skip
    }
  }
}

main().catch((err) => {
  console.error("Registration failed:", err.message);
});