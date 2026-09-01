const solc = require("solc");
const fs = require("fs");

const source = fs.readFileSync("SimpleToken.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "SimpleToken.sol": { content: source } },
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const contract = output.contracts["SimpleToken.sol"]["SimpleToken"];
fs.writeFileSync("SimpleToken.abi.json", JSON.stringify(contract.abi, null, 2));
fs.writeFileSync("SimpleToken.bin", contract.evm.bytecode.object);
console.log("Compiled successfully.");