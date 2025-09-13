// app.js — v3.6.0 persistent USDC badge + USDC logs, 2-row actions layout

import { CONFIG } from "./config.js";
import { PAYROLL_ABI, ERC20_ABI } from "./abi.js";
import { initRelayer, encrypt64For, userDecrypt, publicDecrypt } from "./relayer.js";
import { $, $$, toast, switchTabs, toCSV, download, keccakLabel, formatBase, formatBaseInt, shortAddr } from "./ui.js";

// ─── Globals ───
const DECIMALS = CONFIG.DECIMALS || 6;
const USDC_ADDR = (CONFIG.USDC_ADDRESS || "").trim();
const EXPLORER_TX_BASE = (CONFIG.EXPLORER_TX_BASE || "https://sepolia.etherscan.io/tx/");

let provider = null, signer = null, address = "";

let contractAddr = "";
try {
  const raw = String(CONFIG.PAYROLL_ADDRESS || "").trim();
  if (raw.includes("…") || raw.includes("...")) throw new Error("ellipsis");
  contractAddr = window.ethers.getAddress(raw);
} catch { contractAddr = ""; }

// ─── Actions table: compact two-row layout ───
(() => {
  const css = `
    .actions-grid{display:grid;grid-template-columns:auto 110px auto;gap:8px 10px;align-items:center}
    .actions-grid .txlink{
      display:inline-block;padding:2px 8px;border-radius:8px;font-size:12px;line-height:1.2;
      color:#2563eb;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.25);
      white-space:nowrap;max-width:85px;overflow:hidden;text-overflow:ellipsis;text-decoration:none
    }
    .actions-grid input{width:110px;min-width:110px}
    td.actions{padding-top:6px;padding-bottom:6px}
  `;
  const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
})();

// Dept cache
let DEPT_MAP = Object.create(null);

// Employee table state
let ALL_ROWS = [];          // raw rows (all employees)
let FILTERED_ROWS = [];     // post-filters
let PAGE = 1;
let PAGE_SIZE = 25;

// ─── LOGS: pagination state ───
let LOG_ROWS = [];          // all log rows
let LOG_PAGE = 1;
let LOG_PAGE_SIZE = 25;

// Badges
$("#chain-badge").textContent = CONFIG.NETWORK_NAME || "Sepolia";
$("#ctr-badge").textContent = contractAddr ? ("Contract: " + shortAddr(contractAddr)) : "Contract not set";
const _rb = $("#role-badge"); if (_rb) _rb.textContent = "Role: —";

// UI / tabs
switchTabs();

// Auto-init
(async () => {
  try { if (window.ethereum) await initRelayer(); } catch(e){ console.warn("Relayer init deferred:", e?.message || e); }
  try { await loadDepts(); } catch {}
})();

// ─── Helpers ───
function ensureContractSet() {
  const ok = !!contractAddr && window.ethers?.isAddress?.(contractAddr);
  if (!ok) toast("Set a valid contract address in js/config.js");
  return ok;
}
async function ensureSigner() {
  if (!window.ethereum) throw new Error("Install MetaMask");
  if (!provider) provider = new window.ethers.BrowserProvider(window.ethereum);
  if (!signer) {
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    address = await signer.getAddress();
    const btnConnect = $("#btn-connect");
    if (btnConnect) btnConnect.textContent = shortAddr(address);
  }
}
function getContract(readonly=false) {
  if (!ensureContractSet()) throw new Error("Contract address is not set");
  if (readonly) {
    const p = provider || new window.ethers.BrowserProvider(window.ethereum);
    return new window.ethers.Contract(contractAddr, PAYROLL_ABI, p);
  }
  return new window.ethers.Contract(contractAddr, PAYROLL_ABI, signer || provider);
}
function setBusy(el, v){ if(!el) return; el.setAttribute("aria-busy", v?"true":"false"); }
function showSpinner(v){ const s=$("#global-spinner"); if(!s) return; s.classList.toggle("hidden", !v); s.setAttribute("aria-hidden", v?"false":"true"); }
function tsToStr(ms){ return new Date(Number(ms || 0)).toLocaleString(); }
const addrKey = (a) => String(a||"").toLowerCase();

// ─── Cache of the last USDC transfers per address (for badge) ───
const LAST_USDC_TX = new Map();
function loadTxCache(){
  try{
    const raw = localStorage.getItem("payroll_txcache") || "{}";
    const obj = JSON.parse(raw);
    for (const k of Object.keys(obj||{})) LAST_USDC_TX.set(k.toLowerCase(), String(obj[k]));
  }catch{}
}
function saveTxCache(){
  try{
    const obj = {};
    for (const [k,v] of LAST_USDC_TX.entries()) obj[k] = v;
    localStorage.setItem("payroll_txcache", JSON.stringify(obj));
  }catch{}
}
loadTxCache();

// ► Send a real USDC transfer
async function transferUSDC(to, amountBase) {
  if (!USDC_ADDR || !window.ethers?.isAddress?.(USDC_ADDR)) {
    throw new Error("USDC_ADDRESS is not set in config.js");
  }
  await ensureSigner();
  const usdc = new window.ethers.Contract(USDC_ADDR, ERC20_ABI, signer);
  const tx = await usdc.transfer(to, amountBase);
  await tx.wait();
  return tx; // { hash, ... }
}

// ─── Roles ───
async function detectRole() {
  try {
    const c = getContract(true);
    let role = "employee";
    try {
      const own = await c.owner();
      if (own && String(own).toLowerCase() === address.toLowerCase()) role = "owner";
    } catch {}
    if (role !== "owner") {
      try { const is = await c.isHR?.(address); if (is) role = "hr"; } catch {}
    }
    $("#role-badge") && ($("#role-badge").textContent = "Role: " + role);
  } catch { $("#role-бadge") && ($("#role-бadge").textContent = "Role: —"); }
}

// ─── Connect ───
$("#btn-connect")?.addEventListener("click", async () => {
  try {
    if (!ensureContractSet()) return;
    await ensureSigner();
    toast("Wallet connected");
    try { await initRelayer(); } catch(e){ console.warn("Relayer init after connect:", e?.message || e); }
    await detectRole();
    await loadDepts();
  } catch (e) { toast(e?.message || "Connection error"); }
});

// ──────────────────────────────────────
//   DEPARTMENTS: cache + selects (incl. filters/charts)
// ──────────────────────────────────────
async function loadDepts() {
  if (!ensureContractSet()) return;
  const c = getContract(true);
  let ids = [], names = [];
  try {
    const res = await c.getDepts();
    ids = res[0] || []; names = res[1] || [];
  } catch (e) {
    console.warn("getDepts failed", e?.message || e);
    ids = []; names = [];
  }
  DEPT_MAP = Object.create(null);
  for (let i=0;i<ids.length;i++){
    const id = String(ids[i] || "").toLowerCase();
    DEPT_MAP[id] = (names[i] && names[i].length) ? names[i] : ids[i];
  }
  hydrateDeptSelect($("#emp-dept-select"), ids, names);
  hydrateDeptSelect($("#pub-dept-select"), ids, names);
  hydrateDeptSelect($("#bonus-dept-select"), ids, names);
  hydrateDeptSelect($("#flt-dept"), ids, names, true);
  hydrateDeptSelect($("#chart-dept"), ids, names, true);
  hydrateDeptSelect($("#chart-top5-dept"), ids, names, true);
}
function hydrateDeptSelect(selectEl, ids, names, addAll=false) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (addAll) {
    const opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "All departments";
    selectEl.appendChild(opt0);
  }
  if (!ids.length && !addAll) {
    selectEl.disabled = true;
    selectEl.innerHTML = `<option value="" selected>— no departments —</option>`;
    return;
  }
  selectEl.disabled = false;
  const rows = ids.map((id, i) => ({ id, name: (names[i] && names[i].length) ? names[i] : id }));
  rows.sort((a,b)=> String(a.name).localeCompare(String(b.name)));
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.id; opt.textContent = r.name;
    selectEl.appendChild(opt);
  }
}
async function ensureDeptMap(){ if (Object.keys(DEPT_MAP).length === 0) await loadDepts(); }
function nameOfDept(id){ const key = String(id||"").toLowerCase(); return DEPT_MAP[key] || id; }

// Add department
async function addNewDeptFlow(afterSelectId) {
  try {
    await ensureSigner();
    const name = prompt("Enter the new department name (e.g., R&D)");
    if (!name || !name.trim()) return;
    const id = keccakLabel(window.ethers, name.trim());
    const c = getContract();
    const btn = $("#btn-new-dept"); setBusy(btn, true);
    const tx = await c.upsertDeptName(id, name.trim());
    toast("TX: "+tx.hash); await tx.wait(); toast("Department added");
    await loadDepts();
    if (afterSelectId) {
      const sel = $(afterSelectId);
      if (sel && !sel.disabled) {
        const opt = Array.from(sel.options).find(o => o.value.toLowerCase() === id.toLowerCase());
        if (opt) sel.value = opt.value;
      }
    }
  } catch (e) {
    console.error(e); toast("Failed to add department: " + (e?.message || e));
  } finally { setBusy($("#btn-new-dept"), false); }
}
$("#btn-new-dept")?.addEventListener("click", () => addNewDeptFlow("#emp-dept-select"));
const _btnNewDept2 = $("#btn-new-dept-2");
if (_btnNewDept2) _btnNewDept2.addEventListener("click", () => addNewDeptFlow("#pub-dept-select"));

// ─── HR: add employee ───
$("#btn-add")?.addEventListener("click", async () => {
  const btn = $("#btn-add");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const emp = $("#emp-addr").value.trim();
    const deptId = $("#emp-dept-select").value;
    if (!deptId) { toast("Add a department first"); return; }

    const monthlyStr  = String($("#emp-monthly").value || "0").trim();
    const monthlyBase = window.ethers.parseUnits(monthlyStr, DECIMALS);

    // GROSS/sec (rounded to nearest), TAX/sec = 1/5 of GROSS
    const SECS = 30n * 24n * 3600n;
    const ratePerSec = (monthlyBase + SECS/2n) / SECS;
    const taxPerSec  = ratePerSec / 5n;

    // 3 encryptions
    const { handle: rateHandle, attestation: proofRate } = await encrypt64For(contractAddr, address, ratePerSec);
    const { handle: monHandle,  attestation: proofMon  } = await encrypt64For(contractAddr, address, monthlyBase);
    const { handle: taxHandle,  attestation: proofTax  } = await encrypt64For(contractAddr, address, taxPerSec);

    setBusy(btn, true);
    const c = getContract();
    const tx = await c.addEmployee(emp, deptId, rateHandle, proofRate, monHandle, proofMon, taxHandle, proofTax);
    toast("TX sent: " + tx.hash);
    await tx.wait(); toast("Employee added");
  } catch (e) { console.error(e); toast("addEmployee error: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

// ─── HR: accrue / pay ───
$("#btn-accrue")?.addEventListener("click", async () => {
  const btn = $("#btn-accrue");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const emp = $("#pay-addr").value.trim();
    setBusy(btn, true);
    const c = getContract();
    const tx = await c.accrueByRate(emp);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Accrual completed");
  } catch(e){ console.error(e); toast("accrue error: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});
$("#btn-paid")?.addEventListener("click", async () => {
  const btn = $("#btn-paid");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const emp = $("#pay-addr").value.trim();
    const amountStr  = String($("#pay-amount").value || "0").trim();
    const amountBase = window.ethers.parseUnits(amountStr, DECIMALS);
    const { handle, attestation } = await encrypt64For(contractAddr, address, amountBase);
    setBusy(btn, true);
    const c = getContract();
    const tx = await c.markPaid(emp, handle, attestation);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Payment recorded");
  } catch(e){ console.error(e); toast("markPaid error: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

// HR wizard: record + transfer (USDC)
$("#btn-pay-wizard")?.addEventListener("click", async () => {
  const btn = $("#btn-pay-wizard");
  try {
    await ensureSigner();
    const emp = $("#pay-addr").value.trim();
    const key = addrKey(emp);
    const amountStr  = String($("#pay-amount").value || "0").trim();
    const amountBase = window.ethers.parseUnits(amountStr, DECIMALS);
    const { handle, attestation } = await encrypt64For(contractAddr, address, amountBase);

    setBusy(btn, true);
    const c = getContract();
    const tx1 = await c.markPaid(emp, handle, attestation);
    toast("Recorded: " + tx1.hash);
    await tx1.wait();

    let tx2;
    try {
      tx2 = await transferUSDC(emp, amountBase);
      toast("USDC transferred: " + tx2.hash);
      LAST_USDC_TX.set(key, tx2.hash); saveTxCache();
    } catch(e){
      console.error(e);
      toast("Recorded, but USDC transfer failed: " + (e?.message || e));
    }

    // link in HR block
    const link = document.querySelectorAll("#out-usdc-tx")[0];
    if (link && tx2?.hash) {
      link.href = EXPLORER_TX_BASE + tx2.hash;
      link.textContent = "USDC transfer (Etherscan)";
    }

    // and in the table (after re-render)
    await loadEmployees();
    if (tx2?.hash){
      const a = document.querySelector(`[data-txlink="${key}"]`);
      if (a){ a.href = EXPLORER_TX_BASE + tx2.hash; a.textContent = "USDC TX"; a.classList.remove("muted"); }
    }
  } catch(e){ console.error(e); toast("Payment error: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

// ─── HR: bonuses ───
$("#btn-bonus")?.addEventListener("click", async () => {
  const btn = $("#btn-bonus");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const emp = $("#pay-addr").value.trim();
    const amountStr  = String($("#bonus-amount").value || "0").trim();
    const grossBase = window.ethers.parseUnits(amountStr, DECIMALS);
    const taxBase   = grossBase / 5n;
    const { handle: gH, attestation: gP } = await encrypt64For(contractAddr, address, grossBase);
    const { handle: tH, attestation: tP } = await encrypt64For(contractAddr, address, taxBase);
    setBusy(btn, true);
    const c = getContract();
    const tx = await c.grantBonus(emp, gH, gP, tH, tP);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Bonus granted");
    await loadEmployees();
  } catch(e){ console.error(e); toast("grantBonus error: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

$("#btn-bonus-dept")?.addEventListener("click", bonusDept);
async function bonusDept() {
  const btn = $("#btn-bonus-dept");
  try {
    if (!ensureContractSet()) return; await ensureSigner();

    const deptId = $("#bonus-dept-select").value;
    if (!deptId) { toast("Select a department"); return; }
    const amountStr  = String($("#bonus-dept-amount").value || "0").trim();
    const grossBase = window.ethers.parseUnits(amountStr, DECIMALS);
    if (grossBase <= 0n) { toast("Enter bonus amount"); return; }
    const taxBase = grossBase / 5n;

    const c = getContract();
    const resAddrs = await c.getDeptEmployees(deptId);
    const addrs = Array.from(resAddrs, a => String(a));
    if (!addrs.length) { toast("No employees in the department"); return; }

    const grossHandles = [], grossProofs = [], taxHandles = [], taxProofs = [];
    for (let i=0; i<addrs.length; i++) {
      const { handle: gH, attestation: gP } = await encrypt64For(contractAddr, address, grossBase);
      const { handle: tH, attestation: tP } = await encrypt64For(contractAddr, address, taxBase);
      grossHandles.push(gH); grossProofs.push(gP);
      taxHandles.push(tH);   taxProofs.push(tP);
    }
    setBusy(btn, true);
    const tx = await c.grantBonusMany(addrs, grossHandles, grossProofs, taxHandles, taxProofs);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Department bonus granted");
    await loadEmployees();
  } catch (e) {
    console.error(e); toast("Department bonus error: " + (e?.message || e));
  } finally { setBusy(btn, false); }
}

// ─── Employee: private reads ───
$("#btn-my-rate")?.addEventListener("click", async () => {
  const btn = $("#btn-my-rate");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const c = getContract();
    const h = await c.getMySalary();
    setBusy(btn, true);
    const arr = await userDecrypt([h], address, contractAddr);
    const perHour = arr[0] * 3600n;
    $("#out-my-rate") && ($("#out-my-rate").textContent = formatBase(perHour, DECIMALS) + " tokens/hour");
  } catch(e){ console.error(e); toast("userDecrypt failed (rate): " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});
$("#btn-my-accrued")?.addEventListener("click", async () => {
  const btn = $("#btn-my-accrued");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const c = getContract();
    setBusy(btn, true);
    const [hNet, hTax] = await Promise.all([c.getMyAccrued(), c.getMyTax()]);
    let net, tax;
    try { [net, tax] = await publicDecrypt([hNet, hTax]); }
    catch { [net, tax] = await userDecrypt([hNet, hTax], address, contractAddr); }
    const gross = net + tax;
    $("#out-my-gross") && ($("#out-my-gross").textContent = formatBase(gross, DECIMALS) + " tokens");
    $("#out-my-tax")   && ($("#out-my-tax").textContent   = formatBase(tax, DECIMALS) + " tokens");
    $("#out-my-accrued") && ($("#out-my-accrued").textContent = formatBase(net, DECIMALS) + " tokens");

    // pull "My payments" (employee card)
    try {
      const items = await fetchMyPayments();
      renderMyPayments(items);
    } catch(e){ /* optional */ }
  } catch(e){ console.error(e); toast("userDecrypt failed (net/tax): " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

// ─── Paystub card (modal + print) ───
$("#btn-open-paystub")?.addEventListener("click", openPaystub);
$("#paystub-close")?.addEventListener("click", () => $("#modal-paystub")?.classList.add("hidden"));
$("#paystub-download")?.addEventListener("click", () => {
  const addrTxt = $("#paystub-addr")?.textContent || "";
  const rate = $("#paystub-rate-hour")?.textContent || "—";
  const g = $("#paystub-gross")?.textContent || "—";
  const t = $("#paystub-tax")?.textContent || "—";
  const n = $("#paystub-net")?.textContent || "—";

  const items = (window.__paystub_items || []);
  const rows = items.map(it => {
    const date = tsToStr(it.timeMs);
    const netS = formatBase(it.net || 0n, DECIMALS);
    const tx = it.txHashFull ? it.txHashFull : (it.txUrl ? it.txUrl.split("/").pop() : "—");
    const st = it.status || "";
    return `<tr><td>${date}</td><td>${netS}</td><td>${tx}</td><td>${st}</td></tr>`;
  }).join("");

  const w = window.open("", "_blank");
  w.document.write(`
    <html><head><title>Paystub</title><meta charset="utf-8">
      <style>
        body{font:14px/1.5 Arial,Helvetica,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0 0 10px}
        .row{margin:6px 0}
        table{border-collapse:collapse;width:100%;margin-top:14px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px}
        th{background:#f5f5f5}
      </style>
    </head><body>
      <h1>Paystub</h1>
      <div class="row"><b>Employee:</b> ${addrTxt}</div>
      <div class="row"><b>Rate (hour, gross):</b> ${rate}</div>
      <div class="row"><b>GROSS:</b> ${g}</div>
      <div class="row"><b>TAX:</b> ${t}</div>
      <div class="row"><b>NET:</b> ${n}</div>
      <h2 style="font-size:16px;margin-top:18px">Payments</h2>
      <table>
        <thead><tr><th>Date/Time</th><th>NET (USDC)</th><th>TX</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No payments</td></tr>`}</tbody>
      </table>
      <hr/><small>Generated by CipherPayroll FHE</small>
      <script>window.onload=()=>setTimeout(()=>window.print(),150);<\/script>
    </body></html>
  `);
  w.document.close();
});
async function openPaystub(){
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    $("#paystub-addr") && ($("#paystub-addr").textContent = shortAddr(address));
    const c = getContract();
    showSpinner(true);
    const [hRate, hNet, hTax] = await Promise.all([c.getMySalary(), c.getMyAccrued(), c.getMyTax()]);
    let rate, net, tax;
    try { [rate] = await userDecrypt([hRate], address, contractAddr); }
    catch { [rate] = await publicDecrypt([hRate]); }
    try { [net, tax] = await publicDecrypt([hNet, hTax]); }
    catch { [net, tax] = await userDecrypt([hNet, hTax], address, contractAddr); }

    $("#paystub-rate-hour") && ($("#paystub-rate-hour").textContent = formatBase(rate * 3600n, DECIMALS));
    $("#paystub-net") && ($("#paystub-net").textContent   = formatBase(net, DECIMALS));
    $("#paystub-tax") && ($("#paystub-tax").textContent   = formatBase(tax, DECIMALS));
    $("#paystub-gross") && ($("#paystub-gross").textContent = formatBase(net + tax, DECIMALS));

    // payment history (with full TX)
    const items = await fetchMyPayments(true);
    window.__paystub_items = items;
    renderPaystubPayments(items);

    $("#modal-paystub")?.classList.remove("hidden");
  } catch(e){ console.error(e); toast("Failed to open paystub: " + (e?.message || e)); }
  finally { showSpinner(false); }
}

// ─── Audit: publications ───
$("#btn-reveal-dept")?.addEventListener("click", async () => {
  const btn = $("#btn-reveal-dept");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const id = $("#pub-dept-select").value;
    if (!id) { toast("Select a department"); return; }
    const c = getContract();
    setBusy(btn, true);
    try { const tx = await c.publishDeptAccrued(id); await tx.wait(); } catch {}
    try { const tx2 = await c.publishDeptTax(id); await tx2.wait(); } catch {}

    const [hNet, hTax] = await Promise.all([c.getDeptAccrued(id), c.getDeptTax(id)]);
    let net, tax;
    try { [net, tax] = await publicDecrypt([hNet, hTax]); }
    catch { try { [net] = await publicDecrypt([hNet]); } catch {} try { [tax] = await publicDecrypt([hTax]); } catch {} }
    if (typeof net === "bigint") $("#out-dept") && ($("#out-dept").textContent = formatBase(net, DECIMALS));
    if (typeof tax === "bigint") $("#out-dept-tax") && ($("#out-dept-tax").textContent = formatBase(tax, DECIMALS));
    if (typeof net === "bigint" && typeof tax === "bigint")
      $("#out-dept-gross") && ($("#out-dept-gross").textContent = formatBase(net + tax, DECIMALS));
    toast("Department aggregates updated");
  } catch(e){ console.error(e); toast("Failed to update department: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});
$("#btn-reveal-company")?.addEventListener("click", async () => {
  const btn = $("#btn-reveal-company");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    const c = getContract();
    setBusy(btn, true);
    try { const tx = await c.publishCompanyAccrued(); await tx.wait(); } catch {}
    try { const tx2 = await c.publishCompanyTax(); await tx2.wait(); } catch {}

    const [hNet, hTax] = await Promise.all([c.getCompanyAccrued(), c.getCompanyTax()]);
    let net, tax;
    try { [net, tax] = await publicDecrypt([hNet, hTax]); }
    catch { try { [net] = await publicDecrypt([hNet]); } catch {} try { [tax] = await publicDecrypt([hTax]); } catch {} }
    if (typeof net === "bigint") $("#out-company") && ($("#out-company").textContent = formatBase(net, DECIMALS));
    if (typeof tax === "bigint") $("#out-company-tax") && ($("#out-company-tax").textContent = formatBase(tax, DECIMALS));
    if (typeof net === "bigint" && typeof tax === "bigint")
      $("#out-company-gross") && ($("#out-company-gross").textContent = formatBase(net + tax, DECIMALS));
    toast("Company aggregates updated");
  } catch(e){ console.error(e); toast("Failed to update company: " + (e?.message || e)); }
  finally { setBusy(btn, false); }
});

// ─── Logs ───
$("#btn-logs")?.addEventListener("click", async () => {
  try {
    if (!ensureContractSet()) return;
    await ensureDeptMap();

    const p = provider || new window.ethers.BrowserProvider(window.ethereum);
    const c = new window.ethers.Contract(contractAddr, PAYROLL_ABI, p);
    const latest = await p.getBlockNumber();
    const fromInput = $("#logs-from").value.trim();
    const start = parseFromBlock(fromInput, Number(latest));

    const ev1 = await c.queryFilter(c.filters.EmployeeAdded?.(), start, latest);
    const ev2 = await c.queryFilter(c.filters.Accrued?.(), start, latest);
    const ev3 = await c.queryFilter(c.filters.Paid?.(), start, latest);
    const ev4 = await c.queryFilter(c.filters.DeptAggregatePublished?.(), start, latest);
    const ev5 = await c.queryFilter(c.filters.CompanyAggregatePublished?.(), start, latest);
    const ev6 = await c.queryFilter(c.filters.BonusGranted?.(), start, latest);
    const ev7 = await c.queryFilter(c.filters.DeptTaxPublished?.(), start, latest);
    const ev8 = await c.queryFilter(c.filters.CompanyTaxPublished?.(), start, latest);

    const blocks = {};
    async function ts(bn){ if (blocks[bn]) return blocks[bn]; const bl = await p.getBlock(bn); const t = new Date(Number(bl?.timestamp||0)*1000).toLocaleString(); blocks[bn]=t; return t; }

    const rows = [];
    for (const e of ev1) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"EmployeeAdded", employee:e.args?.employee, deptId:e.args?.deptId, dept:nameOfDept(e.args?.deptId) });
    for (const e of ev2) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"Accrued", employee:e.args?.employee, meta:"Dt=" + String(e.args?.deltaSeconds) + "s" });
    for (const e of ev3) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"Paid", employee:e.args?.employee });
    for (const e of ev4) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"DeptAggregatePublished", deptId:e.args?.deptId, dept:nameOfDept(e.args?.deptId) });
    for (const e of ev5) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"CompanyAggregatePublished" });
    for (const e of ev6) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"BonusGranted", employee:e.args?.employee });
    for (const e of ev7) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"DeptTaxPublished", deptId:e.args?.deptId, dept:nameOfDept(e.args?.deptId) });
    for (const e of ev8) rows.push({ block:e.blockNumber, time:await ts(e.blockNumber), type:"CompanyTaxPublished" });

    // ─── Add real USDC transfers (Transfer) ───
    if (USDC_ADDR && window.ethers?.isAddress?.(USDC_ADDR)) {
      try {
        const topicTransfer = window.ethers.id("Transfer(address,address,uint256)");
        const usdcLogs = await p.getLogs({
          address: USDC_ADDR,
          fromBlock: start,
          toBlock: latest,
          topics: [topicTransfer] // all transfers; we'll filter the recipient locally
        });

        // set of employees to filter out unrelated logs
        let empSet = new Set();
        try {
          const emps = await c.getAllEmployees();
          empSet = new Set(emps.map(a => String(a).toLowerCase()));
        } catch {}

        for (const l of usdcLogs) {
          const to = window.ethers.getAddress("0x" + String(l.topics[2]).slice(26));
          if (!empSet.has(to.toLowerCase())) continue;

          const bn = Number(l.blockNumber);
          const amount = window.ethers.getBigInt(l.data);
          const timeStr = await ts(bn);
          rows.push({
            block: bn,
            time: timeStr,
            type: "USDCTransfer",
            employee: to,
            meta: `amount=${formatBase(amount, DECIMALS)} · <a href="${EXPLORER_TX_BASE + l.transactionHash}" target="_blank" rel="noopener">USDC tx</a>`
          });
        }
      } catch(e) {
        console.warn("USDC logs load failed:", e?.message || e);
      }
    }

    rows.sort((a,b)=> b.block - a.block);
    LOG_ROWS = rows;            // for pagination
    LOG_PAGE = 1;
    renderLogsPaged();          // render first page
    window.__rows = rows;       // for CSV export
    toast("Logs loaded");
  } catch(e){ console.error(e); toast("Failed to load logs: " + (e?.message || e)); }
});
$("#btn-csv")?.addEventListener("click", () => {
  try { const csv = toCSV(window.__rows || []); download("payroll_logs.csv", csv); }
  catch(e){ toast("No data to export"); }
});

// --- Audit charts ---
let _chartDepts = null, _chartTop5 = null;

$("#btn-build-charts")?.addEventListener("click", buildDeptsChart);
$("#btn-top5")?.addEventListener("click", buildTop5Chart);

async function buildDeptsChart(){
  try {
    if (!window.Chart) { toast("Include Chart.js CDN (see instructions)"); return; }
    if (!ensureContractSet()) return;
    await ensureSigner(); await ensureDeptMap();
    const c = getContract(true);
    const [ids, names] = await c.getDepts();

    const labels = [];
    const netArr = [], taxArr = [], grossArr = [];

    for (let i = 0; i < ids.length; i++){
      const id = ids[i];
      const label = (names[i] && names[i].length) ? names[i] : shortAddr(id);
      labels.push(label);

      const [hNet, hTax] = await Promise.all([c.getDeptAccrued(id), c.getDeptTax(id)]);
      let net=0n, tax=0n;
      try { [net, tax] = await publicDecrypt([hNet, hTax]); }
      catch {
        try { [net, tax] = await userDecrypt([hNet, hTax], address, contractAddr); }
        catch { net = 0n; tax = 0n; }
      }
      const gross = net + tax;

      netArr.push(Number(net) / 10**DECIMALS);
      taxArr.push(Number(tax) / 10**DECIMALS);
      grossArr.push(Number(gross) / 10**DECIMALS);
    }

    const ctx = document.getElementById("chart-depts").getContext("2d");
    _chartDepts?.destroy();
    _chartDepts = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "NET",  data: netArr,  backgroundColor: "#10b981" },
          { label: "TAX",  data: taxArr,  backgroundColor: "#f59e0b" },
          { label: "GROSS",data: grossArr,backgroundColor: "#3b82f6" },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top" } },
        scales: { y: { beginAtZero: true } }
      }
    });
    toast("Department chart built");
  } catch (e) {
    console.error(e); toast(e?.message || "Failed to build departments chart");
  }
}

async function buildTop5Chart(){
  try {
    if (!window.Chart) { toast("Include Chart.js CDN (see instructions)"); return; }
    if (!ensureContractSet()) return;
    await ensureSigner();
    const c = getContract(true);

    const addrs = await c.getAllEmployees();
    if (!addrs.length) { toast("No employees"); return; }

    const items = [];
    const handles = [];
    for (const a of addrs) {
      const inf = await c.getEmployeeInfo(a);
      if (inf.exists) {
        items.push({ addr: String(a), deptId: inf.deptId, netH: inf.accruedHandle, taxH: inf.taxHandle });
        handles.push(inf.accruedHandle, inf.taxHandle);
      }
    }
    if (!items.length) { toast("No data"); return; }

    let vals;
    try { vals = await userDecrypt(handles, address, contractAddr); }
    catch {
      try { vals = await publicDecrypt(handles); }
      catch { vals = []; }
    }
    let vi = 0;
    for (const it of items) {
      const net = vals[vi++] ?? 0n;
      const tax = vals[vi++] ?? 0n;
      it.net = net; it.gross = net + tax;
    }

    items.sort((a,b)=> (b.net > a.net ? 1 : -1));
    const top = items.slice(0,5);

    const labels = top.map(t => shortAddr(t.addr));
    const dataNet = top.map(t => Number(t.net) / 10**DECIMALS);

    const ctx = document.getElementById("chart-top5").getContext("2d");
    _chartTop5?.destroy();
    _chartTop5 = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "NET", data: dataNet, backgroundColor: "#10b981" }] },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });
    toast("Top-5 built");
  } catch (e) {
    console.error(e); toast(e?.message || "Failed to build top-5");
  }
}

// ─── Auxiliary ───
function parseFromBlock(input, latest) {
  if (!input || input === "latest") return latest;
  if (input.startsWith("latest-")) { const k = Number(input.split("-")[1] || 5000); return Math.max(0, latest - k); }
  return Number(input);
}
function renderTable(rows) {
  const tbody = $("#logs tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">No data</td></tr>'; return; }
  rows.forEach(r => {
    const deptCell = (r.dept ?? r.deptId) || "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.time||""}</td><td>${r.block||""}</td><td>${r.type||""}</td><td>${r.employee? (r.employee.slice(0,6)+"…"+r.employee.slice(-4)) : "—"}</td><td>${deptCell}</td><td>${r.meta||""}</td>`;
    tbody.appendChild(tr);
  });
}

// ─────────────────────────────────────────
//   Employees by department + filters/pagination
// ─────────────────────────────────────────
$("#btn-load-emps")?.addEventListener("click", loadEmployees);
$("#btn-accrue-all")?.addEventListener("click", accrueAll);

$("#btn-apply-filters")?.addEventListener("click", applyFilters);
$("#btn-clear-filters")?.addEventListener("click", clearFilters);
$("#page-size")?.addEventListener("change", () => { PAGE_SIZE = Number($("#page-size").value || 25); PAGE = 1; renderEmployeesPaged(); });
$("#page-prev")?.addEventListener("click", () => { if (PAGE > 1){ PAGE--; renderEmployeesPaged(); }});
$("#page-next")?.addEventListener("click", () => { const max = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE)); if (PAGE < max){ PAGE++; renderEmployeesPaged(); }});

// ─── Logs pagination ───
$("#logs-page-size")?.addEventListener("change", () => {
  LOG_PAGE_SIZE = Number($("#logs-page-size").value || 25);
  LOG_PAGE = 1;
  renderLogsPaged();
});
$("#logs-page-prev")?.addEventListener("click", () => {
  if (LOG_PAGE > 1){ LOG_PAGE--; renderLogsPaged(); }
});
$("#logs-page-next")?.addEventListener("click", () => {
  const max = Math.max(1, Math.ceil(LOG_ROWS.length / LOG_PAGE_SIZE));
  if (LOG_PAGE < max){ LOG_PAGE++; renderLogsPaged(); }
});

// auto-blur on Enter for action inputs
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && (e.target.matches('input[data-input]') || e.target.matches('input[data-bonus-input]') || e.target.id === "pay-amount" || e.target.id === "bonus-amount" )) {
    e.target.blur();
  }
});

async function loadEmployees() {
  const wrap = $("#emps-wrap");
  try {
    if (!ensureContractSet()) return; await ensureSigner(); await ensureDeptMap();
    setBusy(wrap, true);

    const c = getContract(true);
    const [deptIds] = await c.getDepts();
    const rows = [];
    for (const d of (deptIds || [])) {
      const addrs = await c.getDeptEmployees(d);
      for (const addr of addrs) rows.push({ deptId: d, deptName: nameOfDept(d), addr });
    }
    if (!rows.length) {
      const tb = $("#emps tbody"); if (tb) tb.innerHTML = '<tr><td colspan="6" class="muted">No employees found</td></tr>';
      ALL_ROWS = []; FILTERED_ROWS = []; PAGE = 1; updatePageInfo(); return;
    }

    // batch decrypt monthlyDisplay + accruedNet
    const handles = [];
    for (const r of rows) {
      const inf = await c.getEmployeeInfo(r.addr);
      r.exists = inf.exists;
      r.monthlyHandle = inf.monthlyHandle;
      r.accruedHandle = inf.accruedHandle;
      if (r.exists) handles.push(r.monthlyHandle, r.accruedHandle);
    }
    const values = await userDecrypt(handles, address, contractAddr);
    let vi = 0;
    for (const r of rows) {
      if (r.exists) { r.monthly = values[vi++]; r.accrued = values[vi++]; }
    }

    ALL_ROWS = rows;
    applyFilters(); // apply current filters immediately
  } catch (e) {
    console.error(e); toast("Failed to load employees: " + (e?.message || e));
  } finally { setBusy(wrap, false); }
}
function renderEmployeesPaged(){
  const tbody = $("#emps tbody"); if (!tbody) return;
  tbody.innerHTML = "";
  const max = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE));
  if (PAGE > max) PAGE = max;
  const start = (PAGE-1) * PAGE_SIZE;
  const pageRows = FILTERED_ROWS.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No data for filters</td></tr>';
  } else {
    for (const r of pageRows) {
      const key = addrKey(r.addr);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.deptName || r.deptId}</td>
        <td>${shortAddr(r.addr)}</td>
        <td>${r.exists ? formatBaseInt(r.monthly, DECIMALS) : "—"}</td>
        <td>${r.exists ? formatBase(r.accrued, DECIMALS) : "—"}</td>
        <td class="actions">
          <div class="actions-grid">
            <!-- row 1: accrue · amount · record + USDC -->
            <button class="btn btn-xs btn-outline" data-act="accrue" data-addr="${r.addr}">accrue</button>
            <input data-input="${r.addr}" placeholder="amount"/>
            <div class="stack" style="display:flex;align-items:center;gap:8px;">
              <button class="btn btn-xs" data-act="pay" data-addr="${r.addr}">Paid</button>
              <a class="txlink muted" data-txlink="${key}" target="_blank" rel="noopener">—</a>
            </div>
            <!-- row 2: empty · bonus-input · bonus -->
            <div></div>
            <input data-bonus-input="${r.addr}" placeholder="bonus"/>
            <button class="btn btn-xs btn-secondary" data-act="bonus" data-addr="${r.addr}">bonus</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      // restore badge from cache, if present
      const cached = LAST_USDC_TX.get(key);
      if (cached){
        const a = tr.querySelector(`[data-txlink="${key}"]`);
        if (a){ a.href = EXPLORER_TX_BASE + cached; a.textContent = "USDC TX"; a.classList.remove("muted"); }
      }
    }
  }
  // actions
  tbody.querySelectorAll('button[data-act="accrue"]').forEach(btn=>{
    btn.addEventListener("click", () => rowAccrue(btn.dataset.addr, btn));
  });
  tbody.querySelectorAll('button[data-act="pay"]').forEach(btn=>{
    btn.addEventListener("click", () => rowPay(btn.dataset.addr, btn));
  });
  tbody.querySelectorAll('button[data-act="bonus"]').forEach(btn=>{
    btn.addEventListener("click", () => rowBonus(btn.dataset.addr, btn));
  });

  updatePageInfo();
}

function updatePageInfo(){
  const info = $("#page-info"); if (!info) return;
  const max = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE));
  info.textContent = `page ${PAGE} / ${max}`;
}
function applyFilters(){
  const dept = $("#flt-dept")?.value || "";
  const addrSub = ($("#flt-addr")?.value || "").trim().toLowerCase();
  const netMinStr = $("#flt-net-min")?.value || "";
  const netMaxStr = $("#flt-net-max")?.value || "";

  let netMin = null, netMax = null;
  try { if (netMinStr !== "") netMin = window.ethers.parseUnits(String(netMinStr), DECIMALS); } catch {}
  try { if (netMaxStr !== "") netMax = window.ethers.parseUnits(String(netMaxStr), DECIMALS); } catch {}

  FILTERED_ROWS = (ALL_ROWS || []).filter(r => {
    if (dept && String(r.deptId).toLowerCase() !== String(dept).toLowerCase()) return false;
    if (addrSub && !String(r.addr).toLowerCase().includes(addrSub)) return false;
    if (netMin !== null && r.accrued !== undefined && r.accrued < netMin) return false;
    if (netMax !== null && r.accrued !== undefined && r.accrued > netMax) return false;
    return true;
  });
  PAGE = 1;
  renderEmployeesPaged();
}
function clearFilters(){
  $("#flt-dept") && ($("#flt-dept").value = "");
  $("#flt-addr") && ($("#flt-addr").value = "");
  $("#flt-net-min") && ($("#flt-net-min").value = "");
  $("#flt-net-max") && ($("#flt-net-max").value = "");
  applyFilters();
}

// Row actions
async function rowAccrue(addr, btn){
  try {
    await ensureSigner();
    setBusy(btn, true);
    const c = getContract();
    const tx = await c.accrueByRate(addr); toast("TX: " + tx.hash); await tx.wait();
    toast("Accrual completed"); await loadEmployees();
  } catch(e){ console.error(e); toast("accrue error: "+(e?.message||e)); }
  finally { setBusy(btn, false); }
}
async function rowPay(addr, btn){
  try {
    await ensureSigner();
    const key = addrKey(addr);
    const input = $(`[data-input="${addr}"]`);
    const amountStr  = String(input?.value || "0").trim();
    const amountBase = window.ethers.parseUnits(amountStr, DECIMALS);

    // 1) Record NET in the contract
    const { handle, attestation } = await encrypt64For(contractAddr, address, amountBase);
    setBusy(btn, true);
    const c = getContract();
    const tx1 = await c.markPaid(addr, handle, attestation);
    toast("Recorded in contract: " + tx1.hash);
    await tx1.wait();

    // 2) Real USDC transfer
    let tx2;
    try {
      tx2 = await transferUSDC(addr, amountBase);
      toast("USDC transferred: " + tx2.hash);
      LAST_USDC_TX.set(key, tx2.hash); saveTxCache();
    } catch (e) {
      console.error(e);
      toast("Recorded, but USDC transfer failed: " + (e?.message || e));
    }

    // 3) Re-render table and set link on the NEW row
    await loadEmployees();
    if (tx2?.hash) {
      const a = document.querySelector(`[data-txlink="${key}"]`);
      if (a) {
        a.href = EXPLORER_TX_BASE + tx2.hash;
        a.textContent = "USDC TX";
        a.classList.remove("muted");
      }
    }
  } catch(e){ console.error(e); toast("Payment error: "+(e?.message||e)); }
  finally { setBusy(btn, false); }
}
async function rowBonus(addr, btn){
  try {
    await ensureSigner();
    const input = $(`[data-bonus-input="${addr}"]`);
    const amountStr  = String(input?.value || "0").trim();
    const grossBase = window.ethers.parseUnits(amountStr, DECIMALS);
    const taxBase   = grossBase / 5n;
    const { handle: gH, attestation: gP } = await encrypt64For(contractAddr, address, grossBase);
    const { handle: tH, attestation: tP } = await encrypt64For(contractAddr, address, taxBase);
    setBusy(btn, true);
    const c = getContract();
    const tx = await c.grantBonus(addr, gH, gP, tH, tP);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Bonus granted"); await loadEmployees();
  } catch(e){ console.error(e); toast("grantBonus error: "+(e?.message||e)); }
  finally { setBusy(btn, false); }
}
async function accrueAll(){
  const btn = $("#btn-accrue-all");
  try {
    if (!ensureContractSet()) return; await ensureSigner();
    setBusy(btn, true);
    const c = getContract();
    const res = await c.getAllEmployees();
    const addrs = Array.from(res, a => String(a));
    if (!addrs.length) { toast("No employees"); return; }
    const tx = await c.accrueMany(addrs);
    toast("TX: " + tx.hash); await tx.wait();
    toast("Accrual (all) completed");
    await loadEmployees();
  } catch(e){
    console.error(e);
    toast("accrueMany error: " + (e?.message || e));
  } finally { setBusy(btn, false); }
}

/* ─────────────────────────────────────────
   PERSONAL PAYMENTS: load (generic), renders
   ───────────────────────────────────────── */
// fetch + merge Paid ↔ USDC.Transfer. withFullTx = true → add txHashFull
async function fetchMyPayments(withFullTx=false){
  if (!ensureContractSet()) return [];
  await ensureSigner();
  const p = provider || new window.ethers.BrowserProvider(window.ethereum);
  const c = new window.ethers.Contract(contractAddr, PAYROLL_ABI, p);

  const latest = await p.getBlockNumber();
  const SCAN_RANGE = 500000;
  const start = Math.max(0, Number(latest) - SCAN_RANGE);

  // Paid(employee)
  const paidEvts = await c.queryFilter(c.filters.Paid?.(address), start, latest);

  // decrypt amounts (best-effort)
  let amounts = [];
  if (paidEvts.length) {
    const handles = paidEvts.map(e => e.args?.amountNetHandle).filter(Boolean);
    try { amounts = await userDecrypt(handles, address, contractAddr); }
    catch { amounts = new Array(handles.length).fill(null); }
  }

  // USDC → Transfer(*, employee, amount)
  const tfItems = [];
  if (USDC_ADDR && window.ethers?.isAddress?.(USDC_ADDR)) {
    try {
      const topicTransfer = window.ethers.id("Transfer(address,address,uint256)");
      const toTopic = window.ethers.zeroPadValue(window.ethers.getAddress(address), 32);
      const logs = await p.getLogs({ address: USDC_ADDR, fromBlock: start, toBlock: latest, topics: [topicTransfer, null, toTopic] });
      for (const l of logs) {
        const bn = Number(l.blockNumber);
        const bl = await p.getBlock(bn);
        tfItems.push({
          blockNumber: bn,
          timeMs: Number(bl?.timestamp || 0) * 1000,
          amount: window.ethers.getBigInt(l.data),
          hash: l.transactionHash
        });
      }
    } catch (e) {
      console.warn("USDC logs failed:", e?.message || e);
    }
  }

  const blockCache = {};
  async function ts(bn){
    if (blockCache[bn]) return blockCache[bn];
    const bl = await p.getBlock(bn);
    const t = Number(bl?.timestamp || 0) * 1000;
    blockCache[bn] = t; return t;
  }
  const paidItems = [];
  for (let i = 0; i < paidEvts.length; i++){
    const e = paidEvts[i];
    const bn = Number(e.blockNumber);
    paidItems.push({
      blockNumber: bn,
      timeMs: await ts(bn),
      netFromHandle: (amounts[i] ?? null)
    });
  }

  // match by blocks (±1000)
  const usedTf = new Set();
  const items = [];

  // all USDC transfers → "✅ Paid"
  for (let j = 0; j < tfItems.length; j++){
    const t = tfItems[j];
    items.push({
      timeMs: t.timeMs,
      net: t.amount,
      txUrl: EXPLORER_TX_BASE + t.hash,
      txHashFull: withFullTx ? t.hash : undefined,
      status: "✅ Paid"
    });
  }

  const MAX_BLOCK_GAP = 1000;
  for (const pItem of paidItems){
    let matched = false;
    for (let j = 0; j < tfItems.length; j++){
      if (usedTf.has(j)) continue;
      const t = tfItems[j];
      if (Math.abs(t.blockNumber - pItem.blockNumber) <= MAX_BLOCK_GAP) {
        usedTf.add(j);
        matched = true; break;
      }
    }
    if (!matched) {
      items.push({
        timeMs: pItem.timeMs,
        net: pItem.netFromHandle ?? 0n,
        txUrl: null,
        txHashFull: undefined,
        status: "Recorded (awaiting transfer)"
      });
    }
  }

  items.sort((a,b)=> b.timeMs - a.timeMs);
  return items;
}

// Render under employee card (under "My accrued")
function renderMyPayments(items){
  const host = $("#tab-emp")?.querySelector(".card:nth-of-type(2)");
  if (!host) return;
  let box = host.querySelector("#emp-payments");
  if (!box) {
    box = document.createElement("div");
    box.id = "emp-payments";
    box.style.marginTop = "10px";
    host.appendChild(box);
  }
  const rows = (items || []).slice(0, 5).map(it => {
    const date = tsToStr(it.timeMs);
    const netS = formatBase(it.net || 0n, DECIMALS);
    const link = it.txUrl ? `<a href="${it.txUrl}" target="_blank" rel="noreferrer">Etherscan</a>` : "";
    return `<div class="muted">${date}</div><div><b>${netS}</b> NET · ${it.status}${link ? " · " + link : ""}</div>`;
  }).join("");
  box.innerHTML = `<div style="margin-top:8px"><b>My payments (latest)</b></div>${rows || '<div class="muted">No payments</div>'}`;
}

// Render history in modal (with full TX)
function renderPaystubPayments(items){
  const modalBody = $("#modal-paystub")?.querySelector(".modal-body");
  if (!modalBody) return;
  let area = $("#paystub-payments");
  if (!area) {
    area = document.createElement("div");
    area.id = "paystub-payments";
    area.className = "table-wrap";
    area.style.marginTop = "10px";
    modalBody.appendChild(area);
  }
  const rows = (items || []).map(it => {
    const date = tsToStr(it.timeMs);
    const netS = formatBase(it.net || 0n, DECIMALS);
    const tx = it.txHashFull ? it.txHashFull : (it.txUrl ? it.txUrl.split("/").pop() : "—");
    return `<tr><td>${date}</td><td>${netS}</td><td style="font-family:monospace">${tx}</td><td>${it.status}</td></tr>`;
  }).join("");
  area.innerHTML = `
    <h4 style="margin:8px 0;">Payments</h4>
    <table class="table">
      <thead><tr><th>Date/Time</th><th>NET (USDC)</th><th>TX (full)</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No payments</td></tr>`}</tbody>
    </table>
  `;
}

// ─── Paged render for logs ───
function renderLogsPaged(){
  const tbody = $("#logs tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const max = Math.max(1, Math.ceil(LOG_ROWS.length / LOG_PAGE_SIZE));
  if (LOG_PAGE > max) LOG_PAGE = max;

  const start = (LOG_PAGE - 1) * LOG_PAGE_SIZE;
  const pageRows = LOG_ROWS.slice(start, start + LOG_PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No data</td></tr>';
  } else {
    for (const r of pageRows) {
      const deptCell = (r.dept ?? r.deptId) || "";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.time||""}</td><td>${r.block||""}</td><td>${r.type||""}</td><td>${r.employee? (r.employee.slice(0,6)+"…"+r.employee.slice(-4)) : "—"}</td><td>${deptCell}</td><td>${r.meta||""}</td>`;
      tbody.appendChild(tr);
    }
  }

  const info = $("#logs-page-info");
  if (info) info.textContent = `page ${LOG_PAGE} / ${max}`;
}
