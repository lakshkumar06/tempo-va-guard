const { ethers } = require("ethers");

const MASTER_ID = "0xb1977b69"; // your registered masterId
const VIRTUAL_MAGIC = "0xFDFDFDFDFDFDFDFDFDFD"; // fixed, from the spec
const USER_TAG = "0x000000000001"; // pick any 6-byte tag, e.g. "customer #1"

function buildVirtualAddress(masterId, userTag) {
  const packed = ethers.concat([masterId, VIRTUAL_MAGIC, userTag]);
  if (ethers.dataLength(packed) !== 20) {
    throw new Error("Wrong length — should be exactly 20 bytes");
  }
  return ethers.getAddress(packed); // returns checksummed address
}

const virtualAddress = buildVirtualAddress(MASTER_ID, USER_TAG);
console.log("Your virtual address:", virtualAddress);

// 0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001