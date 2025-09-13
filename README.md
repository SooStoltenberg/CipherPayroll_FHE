# CipherPayroll FHE

> **Private, on‑chain payroll streaming with Zama FHEVM + Relayer SDK.** Employees’ salaries and accruals remain encrypted end‑to‑end; HR/Finance can operate without exposing per‑employee numbers on chain.

CipherPayroll FHE is a private, on-chain payroll built on Zama FHEVM. All amounts (GROSS/TAX/NET) are encrypted end-to-end; HR can add employees, accrue streaming pay, record payouts, and grant bonuses without exposing per-employee data. Only NET/TAX aggregates are publicly disclosed for audit, with a frontend powered by the Zama Relayer SDK (EIP-712 userDecrypt) and optional USDC transfers. Ships as a static web dApp on Sepolia.


## Live Demo

* Frontend: *deploy your own* (static site)
* Smart contract: *Sepolia* — set your deployed address in `js/config.js` → `PAYROLL_ADDRESS`

> This repo ships as a **static dApp** (HTML + JS modules). You can host it on any static hosting.

---

## Project Overview

CipherPayroll FHE is a minimal payroll system where **all monetary values are encrypted** on‑chain. It supports:

* **Encrypted salary streams** (`euint64`): GROSS/sec and TAX/sec, with accrual over time.
* **Off‑chain tax split**: fixed 20% tax (`gross / 5`) computed client‑side ➜ sent encrypted (no division on chain).
* **Accruals**: stream updates `GROSS`, `TAX`, and `NET = GROSS − TAX` for employee, department, and company.
* **Payout recording**: subtract encrypted NET; optional **real USDC transfer** and explorer link.
* **Bonuses**: one‑off encrypted GROSS/TAX bonuses, single user or **batch** per department.
* **Selective disclosure**: publish public‑decryptable aggregates (NET/TAX) for **department** and **company**.
* **Audit UX**: event logs, CSV export, and charts (Chart.js).

---

## Tech Stack

**Smart contracts**

* Solidity `^0.8.24`
* Zama FHEVM: `@fhevm/solidity/lib/FHE.sol` (`euint64`, `FHE.add/sub/mul`, `FHE.allow*`, `FHE.makePubliclyDecryptable`)
* Network config: `SepoliaConfig`

**Frontend**

* Vanilla HTML + ES modules
* Ethers v6 (UMD) for chain access
* **Relayer SDK** (CDN) — `createInstance`, `createEncryptedInput`, `userDecrypt`, `publicDecrypt`
* Chart.js (optional, for audit charts)

---

## Features

1. **HR/Finance**

   * Add employees (address, dept, monthly amount → encrypted `ratePerSec` / `taxPerSec`)
   * Accrue now / accrue all
   * Record payout (encrypted NET) + optional USDC transfer
   * Grant bonus (single) and **department batch**
   * Publish dept/company aggregates (NET & TAX)
2. **Employee**

   * Private reads via `userDecrypt` (rate/hour, accrued GROSS/TAX/NET)
   * Paystub modal + printable PDF
3. **Audit**

   * Public decrypt of published aggregates via `publicDecrypt`
   * Logs table with CSV export, department charts, Top‑5

---

## Architecture

```
Browser (MetaMask)
  ├─ Encrypt inputs (Relayer SDK): add64 → encrypt → {handle, attestation}
  ├─ Private reads: EIP‑712 signed userDecrypt (ephemeral keypair)
  ▼
Zama Relayer  →  Gateway  →  FHEVM Payroll.sol
                             ├─ euint64 accrual (rate × ∆t)
                             ├─ dept/company aggregates
                             └─ makePubliclyDecryptable (selective disclosure)
```

---

## Smart Contracts

* **`Payroll.sol`** (plus `PayrollFactory`) — monetary fields as `euint64`.
* Employee: `ratePerSec`, `taxPerSec`, `monthlyDisplay`, accrued `{gross,tax,net}`.
* Department/company aggregates: per‑second streams and cumulative `{gross,tax,net}`.
* Access control via **owner/HR** mappings + FHE ACL (`allow`, `allowThis`).
* No FHE in view/pure; getters return **ciphertext handles**.

> **Note**: Only `euint64` arithmetic is used (`FHE.add/sub/mul`). No unsupported ops on `euint256`/`eaddress`.

### Key functions (subset)

```solidity
addEmployee(address, bytes32 deptId, bytes32 encRatePerSec, bytes rateProof,
            bytes32 encMonthlyDisplay, bytes monthlyProof,
            bytes32 encTaxPerSec, bytes taxProof);
updateRate(address, bytes32 encNewRate, bytes rateProof,
           bytes32 encNewTax, bytes taxProof);
accrueByRate(address);
accrueMany(address[] addrs);
markPaid(address employee, bytes32 encAmountPaid, bytes proof); // deducts from NET only
grantBonus(address, bytes32 encGross, bytes proofGross, bytes32 encTax, bytes proofTax);
grantBonusMany(address[], bytes32[] gH, bytes[] gP, bytes32[] tH, bytes[] tP);

// selective disclosure
publishDeptAccrued(bytes32 deptId);
publishCompanyAccrued();
publishDeptTax(bytes32 deptId);
publishCompanyTax();
```

---

## Frontend & Data Flows

* **Relayer** (`js/relayer.js`)

  * `initRelayer()` → `createInstance({...SepoliaConfig, network: window.ethereum, relayerUrl, gatewayUrl})`
  * `encrypt64For(contractAddr, userAddr, valueBigInt)` → `createEncryptedInput(...).add64(...).encrypt()` ↦ `{handle, attestation}`
  * `userDecrypt(handles, userAddr, contractAddr)` → EIP‑712 request (signed) ↦ `BigInt[]`
  * `publicDecrypt(handles)` → for published aggregates
* **App** (`js/app.js`) — HR/Employee/Audit flows, logs, CSV, charts
* **UI** (`js/ui.js`) — DOM helpers, formatting

---

## Configuration

Create `js/config.js`:

```js
export const CONFIG = {
  NETWORK_NAME: "Sepolia",
  USDC_ADDRESS: "",          // optional; leave empty to disable USDC features
  DECIMALS: 6,                // token decimals for formatting & math
  PAYROLL_ADDRESS: "0x...",  // deployed Payroll address (checksummed)
  EXPLORER_TX_BASE: "https://sepolia.etherscan.io/tx/"
};
```

Relayer endpoints are set in `js/relayer.js`:

```js
relayerUrl:  "https://relayer.testnet.zama.cloud",
gatewayUrl:  "https://gateway.sepolia.zama.ai/",
```

---

## Getting Started

### Prerequisites

* Browser with **MetaMask**
* (Optional) Node.js — only to run a static server

### Run locally (static)

```bash
# any static server
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:3000` and click **Connect wallet**.

### Setup

1. Edit `js/config.js` with your contract address (and USDC if you use it)
2. Ensure MetaMask is on **Sepolia**
3. HR → add departments & employees; Employee → decrypt own data; Audit → publish & chart

---

## Operation Logs & Charts

* **Logs**: fetch on‑chain events (`EmployeeAdded`, `Accrued`, `Paid`, `BonusGranted`, `*Published`) with range filter.
* **CSV Export**: one‑click `logs → CSV`.
* **Charts**: Dept aggregates (NET/TAX/GROSS) and **Top‑5 employees**; decryption via `publicDecrypt` or fallback `userDecrypt`.

---

## Project Structure

```
.
├─ contracts/
│  └─ Payroll.sol
├─ js/
│  ├─ app.js       # HR/Employee/Audit logic, logs, charts
│  ├─ abi.js       # ABI used by frontend
│  ├─ relayer.js   # Relayer SDK wrappers (encrypt/user/public decrypt)
│  └─ ui.js        # DOM helpers, CSV, formatting
├─ index.html      # UI
├─ style.css       # styles
└─ README.md
```

---

## Troubleshooting

* **MetaMask not found** → install/refresh.
* **Invalid contract address** → set checksum `PAYROLL_ADDRESS` (no ellipsis) in `js/config.js`.
* **Decrypt errors** → ensure wallet connected; served over HTTP(S) (not `file://`); network = Sepolia.
* **Public decrypt = 0** → publish aggregates first (Audit tab).

---

## Roadmap

* Variable tax policies per department
* Multi‑token payrolls, FX helpers
* Role management UI (owner ↔ HR)
* Gas‑optimized batch accruals

---

## Security & Privacy

* Inputs are bound to `(contractAddress, userAddress)`; **EIP‑712** secures user decrypt.
* FHE ACL (`FHE.allow`, `FHE.allowThis`) restricts visibility.
* Only explicitly published aggregates become publicly decryptable.
* Monetary types use `euint64` — mind decimals to avoid overflow.

> **Important**: This is a reference implementation. Audit before production.

---

## License

MIT © CipherPayroll FHE authors
