// deploy/00_deploy_mock_usdc.js
module.exports = async function (hre) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, log } = deployments;

  const { deployer } = await getNamedAccounts();

  // куда зачислить стартовый минт (по умолчанию — деплойер)
  const TREASURY = process.env.TREASURY || deployer;

  // "человеческая" сумма без десятичных (например 1000000 = 1,000,000)
  // переводим в base units с 6 знаками (USDC)
  const human = BigInt(process.env.USDC_INITIAL_MINT || "1000000"); // 1e6 по умолчанию
  const decimals = 6n;
  const amountBase = human * 10n ** decimals;

  log(`Deploying MockUSDC to treasury=${TREASURY}, mint=${human.toString()} * 10^6 = ${amountBase.toString()}`);

  await deploy("MockUSDC", {
    from: deployer,
    args: [TREASURY, amountBase.toString()], // ← только 2 аргумента
    log: true,
    waitConfirmations: 1,
  });
};

module.exports.tags = ["MockUSDC"];
