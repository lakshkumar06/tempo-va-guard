const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://rpc.moderato.tempo.xyz";
const TOKEN_ADDRESS = "0xd51c28223D96a64F6401e4Ed4cB5dBdA9Ae747ff";
const WALLET_ADDRESS = "0x1Da4D0e37292c09aB56C99F8E39c21351184ebbA"; // your wallet

const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "../sample-token/SimpleToken.abi.json"), "utf8"));

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, provider);

  const balance = await token.balanceOf(WALLET_ADDRESS);
  console.log("Your wallet's TST balance:", ethers.formatUnits(balance, 18));
}

main();