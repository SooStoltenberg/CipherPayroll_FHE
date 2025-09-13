import { BrowserProvider } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import { CHAIN_ID } from "./config.js";

export async function connectWallet(){
  const eth = window.ethereum;
  if(!eth) throw new Error("MetaMask not found");
  const id = await eth.request({ method: "eth_chainId" });
  if(BigInt(id) !== CHAIN_ID){
    await eth.request({ method: "wallet_switchEthereumChain", params:[{ chainId: "0xaa36a7" }] });
  }
  const provider = new BrowserProvider(eth);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address };
}