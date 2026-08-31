const { ethers } = require("ethers");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const REGISTRY_ADDRESS = "0xFDC0000000000000000000000000000000000000";
const PRIVATE_KEY = "0x54b9432595087fd5def46ac24e23d97e27ab75230a8b17b0a038fbaedae7762b";

const REGISTRY_ABI = [
  "function registerVirtualMaster(bytes32 salt) returns (bytes4 masterId)",
  "event MasterRegistered(bytes4 indexed masterId, address indexed masterAddress)"
];

async function findValidSalt(masterAddress) {
  console.log("Grinding for a valid salt (needs ~2^32 tries on average)...");
  let salt, hash;
  let attempts = 0;
  while (true) {
    salt = ethers.hexlify(ethers.randomBytes(32));
    hash = ethers.keccak256(ethers.solidityPacked(["address", "bytes32"], [masterAddress, salt]));
    attempts++;
    if (hash.slice(0, 10) === "0x00000000") { // first 4 bytes zero
      console.log(`Found valid salt after ${attempts} attempts`);
      return salt;
    }
    if (attempts % 1000000 === 0) console.log(`...${attempts} attempts so far`);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

  const salt = await findValidSalt(wallet.address);

  console.log("Submitting registration...");
  const tx = await registry.registerVirtualMaster(salt);
  const receipt = await tx.wait();

  console.log("Registered! Tx hash:", receipt.hash);
  console.log("Check logs for MasterRegistered event to get your masterId");
}

main();