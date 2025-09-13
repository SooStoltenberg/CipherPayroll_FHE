import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  const owner = process.env.PAYROLL_OWNER || deployer;

  const res = await deploy("Payroll", {
    from: deployer,
    args: [owner],          // constructor(address _owner)
    log: true,
    waitConfirmations: 1,   // при желании увеличь
  });

  log(`Payroll deployed at ${res.address}`);
};

export default func;
func.tags = ["Payroll"];
