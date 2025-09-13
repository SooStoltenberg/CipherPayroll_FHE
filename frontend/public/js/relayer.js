// js/relayer.js
// Reliable wrappers around Zama Relayer SDK (v0.2.0) for encryption and decryption

import {
  initSDK,
  createInstance,
  SepoliaConfig,
  generateKeypair as sdkGenerateKeypair,
} from "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.js";

let _relayer = null;     // cached singleton SDK instance
let _ud_kp   = null;     // cached keypair for userDecrypt

// ───────────────────────────────────────────────────────────────────────────────
// Relayer SDK initialization
// ───────────────────────────────────────────────────────────────────────────────
export async function initRelayer() {
  if (_relayer) return _relayer;

  if (!window.ethereum) throw new Error("MetaMask not found");
  await initSDK();

  _relayer = await createInstance({
    ...SepoliaConfig,                         // ready-to-use Sepolia configuration
    network: window.ethereum,
    relayerUrl: "https://relayer.testnet.zama.cloud",
    gatewayUrl: "https://gateway.sepolia.zama.ai/",
    debug: true,
  });

  // Prepare a keypair for userDecrypt (once per session)
  if (!_ud_kp) {
    if (typeof _relayer.generateKeypair === "function") {
      _ud_kp = await _relayer.generateKeypair();
    } else {
      _ud_kp = await sdkGenerateKeypair();
    }
  }

  return _relayer;
}

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
function addressVariants(a) {
  const raw = String(a ?? "").replace(/\u200b/g, "").trim();
  const out = [];
  try {
    const cs = window.ethers?.getAddress ? window.ethers.getAddress(raw) : raw;
    if (/^0x[0-9a-fA-F]{40}$/.test(cs)) out.push(cs);
  } catch {}
  const lc = raw.toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(lc)) out.push(lc);
  return [...new Set(out)];
}

async function ensureUserAddress(userAddress) {
  const raw = (userAddress ?? "").trim();
  if (raw) return raw;
  if (!window.ethereum) throw new Error("MetaMask not found");
  const accs = await window.ethereum.request({ method: "eth_accounts" });
  if (!accs || !accs[0]) throw new Error("No connected account");
  return accs[0];
}

function attachExtraData(enc, ca, ua) {
  const extra = {
    contractAddress: ca,
    userAddress: ua,
    chainId: SepoliaConfig?.chainId || "0xaa36a7",
    kmsContractAddress: SepoliaConfig?.kmsContractAddress,
    aclContractAddress: SepoliaConfig?.aclContractAddress,
  };
  if (typeof enc.setExtraData === "function") enc.setExtraData(extra);
  else enc.extraData = extra; // backward-compat
}

async function doEncrypt(enc, valueBigInt) {
  enc.add64(valueBigInt);
  const out = await enc.encrypt();
  const handle = (out?.handles || out?.externalValues)?.[0];
  const proof  =  out?.inputProof || out?.attestation;
  if (!handle) throw new Error("Encrypt: missing handle");
  if (!proof)  throw new Error("Encrypt: missing inputProof/attestation");
  return { handle, attestation: proof };
}

async function _getSignerAndUser() {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const provider = new window.ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const user = await signer.getAddress();
  return { provider, signer, user };
}

// ───────────────────────────────────────────────────────────────────────────────
// API: Encrypt euint64 for contract/user (add64 → encrypt)
// ───────────────────────────────────────────────────────────────────────────────
export async function encrypt64For(contractAddress, userAddress, valueBigInt) {
  const r = await initRelayer();

  const uaRaw = await ensureUserAddress(userAddress);
  const caList = addressVariants(contractAddress);
  const uaList = addressVariants(uaRaw);

  if (!caList.length) throw new Error(`Contract address looks invalid: ${contractAddress}`);
  if (!uaList.length) throw new Error(`User address looks invalid: ${uaRaw}`);

  let lastErr;

  for (const ca of caList) {
    for (const ua of uaList) {
      // Try object signature first (newer SDK builds)
      try {
        const encObj = r.createEncryptedInput({ contractAddress: ca, userAddress: ua });
        attachExtraData(encObj, ca, ua);
        return await doEncrypt(encObj, valueBigInt);
      } catch (e1) {
        lastErr = e1;
        // Then fallback to positional signature (older SDK builds)
        try {
          const encPos = r.createEncryptedInput(ca, ua);
          attachExtraData(encPos, ca, ua);
          return await doEncrypt(encPos, valueBigInt);
        } catch (e2) {
          lastErr = e2;
          // proceed to the next address combination
        }
      }
    }
  }
  throw lastErr || new Error("Relayer encrypt failed for all address variants");
}

// ───────────────────────────────────────────────────────────────────────────────
// API: Private decryption for a user (userDecrypt + EIP-712)
// ───────────────────────────────────────────────────────────────────────────────
export async function userDecrypt(handles, userAddress, contractAddress) {
  const r  = await initRelayer();

  const ua = await ensureUserAddress(userAddress);
  const ca = addressVariants(contractAddress)[0] || contractAddress;

  // keypair for the request
  if (!_ud_kp) {
    if (typeof r.generateKeypair === "function") _ud_kp = await r.generateKeypair();
    else _ud_kp = await sdkGenerateKeypair();
  }

  // EIP-712 signature by the current account (must be the employee)
  const { signer } = await _getSignerAndUser();
  const startTs = Math.floor(Date.now() / 1000).toString();
  const days = "7";
  const eip = r.createEIP712(_ud_kp.publicKey, [ca], startTs, days);
  const signature = await signer.signTypedData(
    eip.domain,
    { UserDecryptRequestVerification: eip.types.UserDecryptRequestVerification },
    eip.message
  );

  const pairs = handles.map((h) => ({ handle: h, contractAddress: ca }));

  const out = await r.userDecrypt(
    pairs,
    _ud_kp.privateKey,
    _ud_kp.publicKey,
    String(signature).replace(/^0x/, ""),
    [ca],
    ua,
    startTs,
    days
  );

  // normalize response to an array of BigInt in the same order as handles
  if (Array.isArray(out)) return out.map((v) => BigInt(v));
  return handles.map((h) => BigInt(out[h] ?? out[String(h)]));
}

// ───────────────────────────────────────────────────────────────────────────────
// API: Public decryption of published aggregates
// ───────────────────────────────────────────────────────────────────────────────
export async function publicDecrypt(handles) {
  const r = await initRelayer();
  const out = await r.publicDecrypt(handles);
  if (Array.isArray(out)) return out.map((v) => BigInt(v));
  return handles.map((h) => BigInt(out[h] ?? out[String(h)]));
}
