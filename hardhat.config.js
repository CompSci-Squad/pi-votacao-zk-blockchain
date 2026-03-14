import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { createRequire } from "module";
import { defineConfig } from "hardhat/config";

// dotenv is CJS; load via createRequire so it works in an ESM config
const require = createRequire(import.meta.url);
require("dotenv").config();

const RPC_URL = process.env.RPC_URL || "";
// Use a known-invalid placeholder key for local networks so Hardhat can start.
// For Sepolia, PRIVATE_KEY must be set in .env — the deploy script will warn if it's missing.
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha],
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Hardhat 3: in-process simulated network (replaces Hardhat 2's "hardhat" network)
    default: {
      type: "edr-simulated",
      chainId: 31337,
    },
    // Local Hardhat node (npx hardhat node)
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // Sepolia testnet
    sepolia: {
      type: "http",
      url: RPC_URL || "https://rpc.sepolia.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  mocha: {
    timeout: 40000,
  },
});
