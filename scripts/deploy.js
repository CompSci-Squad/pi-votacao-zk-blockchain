import hre from "hardhat";

async function main() {
  console.log("Deploying VotingContract to", hre.network.name, "...");

  // 1. Deploy the Verifier first
  const Verifier = await hre.ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("Verifier deployed to:", verifierAddress);

  // 2. Deploy VotingContract pointing to the Verifier
  const VotingContract = await hre.ethers.getContractFactory("VotingContract");
  const votingContract = await VotingContract.deploy(verifierAddress);
  await votingContract.waitForDeployment();
  const votingAddress = await votingContract.getAddress();
  console.log("VotingContract deployed to:", votingAddress);

  // 3. Verify on Etherscan (only on non-local networks)
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting for block confirmations before verifying...");
    // Wait for a few confirmations so Etherscan can index the contract
    const CONFIRMATIONS = 5;
    await votingContract.deploymentTransaction().wait(CONFIRMATIONS);

    console.log("Verifying Verifier on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: verifierAddress,
        constructorArguments: [],
      });
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("Verifier already verified.");
      } else {
        console.error("Verifier verification failed:", err.message);
      }
    }

    console.log("Verifying VotingContract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: votingAddress,
        constructorArguments: [verifierAddress],
      });
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("VotingContract already verified.");
      } else {
        console.error("VotingContract verification failed:", err.message);
      }
    }
  }

  console.log("\n--- Deployment summary ---");
  console.log("Network          :", hre.network.name);
  console.log("Verifier         :", verifierAddress);
  console.log("VotingContract   :", votingAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
