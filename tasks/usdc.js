// tasks/usdc.js
const { task } = require("hardhat/config");

// берём просто первого доступного signer'а на сети (деплой-кошелёк)
async function pickSigner(hre) {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  if (!signers.length) throw new Error("Нет доступных аккаунтов для подписи");
  return signers[0];
}

task("usdc:address", "Показать адрес задеплоенного MockUSDC")
  .setAction(async (_, hre) => {
    const d = await hre.deployments.get("MockUSDC");
    console.log(d.address);
  });

task("usdc:mint", "Mint MockUSDC (amount в ЦЕЛЫХ токенах)")
  .addParam("to", "Адрес получателя")
  .addParam("amount", "Сумма в целых USDC, напр. 50000")
  .setAction(async ({ to, amount }, hre) => {
    const { deployments, ethers } = hre;
    const d = await deployments.get("MockUSDC");          // требует deployments/sepolia/MockUSDC.json
    const signer = await pickSigner(hre);

    const usdc = await ethers.getContractAt("MockUSDC", d.address, signer);
    const value = ethers.parseUnits(String(amount), 6);   // 6 знаков у USDC

    console.log(`Mint ${amount} USDC (${value.toString()} base) → ${to}`);
    const tx = await usdc.mint(to, value);
    console.log("tx:", tx.hash);
    await tx.wait();
    console.log("✅ Готово");
  });

task("usdc:balance", "Показать баланс MockUSDC")
  .addParam("who", "Адрес")
  .setAction(async ({ who }, hre) => {
    const { deployments, ethers } = hre;
    const d = await deployments.get("MockUSDC");
    const usdc = await ethers.getContractAt("MockUSDC", d.address, ethers.provider);
    const bal = await usdc.balanceOf(who);
    console.log(`${who} = ${ethers.formatUnits(bal, 6)} USDC`);
  });

module.exports = {};
