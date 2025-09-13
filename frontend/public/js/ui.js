// ui.js
// DOM / utils

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(msg) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = String(msg ?? "");
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2800);
}

export function switchTabs() {
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      $$(".tabpane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const pane = document.getElementById("tab-" + btn.dataset.tab);
      if (pane) pane.classList.add("active");
    });
  });
}

export function toCSV(rows) {
  const header = ["time","block","type","employee","deptId","meta"];
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const body = (rows || []).map((r) => [r.time, r.block, r.type, r.employee, r.deptId, r.meta].map(q).join(","));
  return [header.join(","), ...body].join("\n");
}

export function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export function keccakLabel(ethers, text) {
  try { return ethers.keccak256(ethers.toUtf8Bytes(String(text || ""))); }
  catch { return "0x" + "00".repeat(64/2); }
}

export function formatBase(v, decimals = 6) {
  if (v === undefined || v === null) return "-";
  const num = Number(v) / Math.pow(10, decimals);
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// Integer output (e.g., "Monthly amount" — no fractional part)
export function formatBaseInt(v, decimals = 6) {
  if (v === undefined || v === null) return "-";
  const num = Number(v) / Math.pow(10, decimals);
  return Math.round(num).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function shortAddr(a) {
  const s = String(a || "");
  return s.startsWith("0x") && s.length === 42 ? (s.slice(0,6)+"…"+s.slice(-4)) : s;
}
