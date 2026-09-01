require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const abi = JSON.parse(fs.readFileSync("SimpleToken.abi.json", "utf8"));
const bytecode = "0x" + fs.readFileSync("SimpleToken.bin", "utf8");

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  const initialSupply = ethers.parseUnits("1000000", 18);

  console.log("Deploying SimpleToken (plain ERC-20, NOT TIP-20)...");
  const contract = await factory.deploy(initialSupply);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("");
  console.log("Deployed at:", address);
  console.log("Deployer balance:", ethers.formatUnits(await contract.balanceOf(wallet.address), 18), "TST");

  fs.writeFileSync("simple-token-address.txt", address);
  console.log("");
  console.log("Address saved to simple-token-address.txt");
}

main().catch((err) => console.error("Deploy failed:", err.message));