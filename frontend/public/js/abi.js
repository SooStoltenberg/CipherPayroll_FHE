// abi.js — v3.0.4 (+ ERC20_ABI)
// Matches the Payroll contract with gross/tax streams, bonuses, and aggregate publication (NET & TAX)

export const PAYROLL_ABI = [
  /* ── roles / views ── */
  { inputs: [], name: "owner", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "who", type: "address" }],
    name: "isHR",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },

  /* ── ownership / roles ── */
  {
    inputs: [{ name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "who", type: "address" },
      { name: "v", type: "bool" },
    ],
    name: "setHR",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  /* ── HR actions ── */
  {
    // addEmployee(address, bytes32, bytes32, bytes, bytes32, bytes, bytes32, bytes)
    inputs: [
      { name: "employee", type: "address" },
      { name: "deptId", type: "bytes32" },
      { name: "encRatePerSec", type: "bytes32" },
      { name: "rateProof", type: "bytes" },
      { name: "encMonthlyDisplay", type: "bytes32" },
      { name: "monthlyProof", type: "bytes" },
      { name: "encTaxPerSec", type: "bytes32" },
      { name: "taxProof", type: "bytes" },
    ],
    name: "addEmployee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    // updateRate(address, bytes32, bytes, bytes32, bytes)
    inputs: [
      { name: "employee", type: "address" },
      { name: "encNewRatePerSec", type: "bytes32" },
      { name: "rateProof", type: "bytes" },
      { name: "encNewTaxPerSec", type: "bytes32" },
      { name: "taxProof", type: "bytes" },
    ],
    name: "updateRate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { inputs: [{ name: "employee", type: "address" }], name: "accrueByRate", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "addrs", type: "address[]" }], name: "accrueMany", outputs: [], stateMutability: "nonpayable", type: "function" },
  {
    // markPaid(address, bytes32, bytes) — deduct from NET
    inputs: [
      { name: "employee", type: "address" },
      { name: "encAmountPaid", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    name: "markPaid",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  /* ── Bonuses ── */
  {
    // grantBonus(address, bytes32, bytes, bytes32, bytes) — both GROSS and TAX provided (tax = gross/5 off-chain)
    inputs: [
      { name: "employee", type: "address" },
      { name: "encGross", type: "bytes32" },
      { name: "proofGross", type: "bytes" },
      { name: "encTax", type: "bytes32" },
      { name: "proofTax", type: "bytes" },
    ],
    name: "grantBonus",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    // grantBonusMany(address[], bytes32[], bytes[], bytes32[], bytes[])
    inputs: [
      { name: "addrs", type: "address[]" },
      { name: "grossHandles", type: "bytes32[]" },
      { name: "grossProofs", type: "bytes[]" },
      { name: "taxHandles", type: "bytes32[]" },
      { name: "taxProofs", type: "bytes[]" },
    ],
    name: "grantBonusMany",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  /* ── Dept names ── */
  {
    inputs: [
      { name: "deptId", type: "bytes32" },
      { name: "name", type: "string" },
    ],
    name: "upsertDeptName",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  /* ── Employee private getters ── */
  { inputs: [], name: "getMySalary", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getMyAccrued", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getMyTax", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },

  /* ── Audit/public aggregates ── */
  { inputs: [{ name: "deptId", type: "bytes32" }], name: "publishDeptAccrued", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "deptId", type: "bytes32" }], name: "getDeptAccrued", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "publishCompanyAccrued", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "getCompanyAccrued", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },

  { inputs: [{ name: "deptId", type: "bytes32" }], name: "publishDeptTax", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "deptId", type: "bytes32" }], name: "getDeptTax", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "publishCompanyTax", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "getCompanyTax", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },

  /* ── catalogs for UI ── */
  {
    inputs: [],
    name: "getDepts",
    outputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "names", type: "string[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [{ name: "deptId", type: "bytes32" }], name: "getDeptEmployees", outputs: [{ type: "address[]" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getAllEmployees", outputs: [{ type: "address[]" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "employee", type: "address" }],
    name: "getEmployeeInfo",
    outputs: [
      { name: "deptId", type: "bytes32" },
      { name: "rateHandle", type: "bytes32" },
      { name: "monthlyHandle", type: "bytes32" },
      { name: "accruedHandle", type: "bytes32" }, // NET
      { name: "taxHandle", type: "bytes32" },
      { name: "lastTs", type: "uint64" },
      { name: "exists", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  /* ── misc ── */
  { inputs: [], name: "version", outputs: [{ type: "string" }], stateMutability: "pure", type: "function" },

  /* ── events ── */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "employee", type: "address" },
      { indexed: true, name: "deptId", type: "bytes32" },
    ],
    name: "EmployeeAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "employee", type: "address" },
      { indexed: true, name: "deptId", type: "bytes32" },
    ],
    name: "EmployeeRateUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "employee", type: "address" },
      { indexed: false, name: "deltaSeconds", type: "uint64" },
    ],
    name: "Accrued",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "employee", type: "address" },
      { indexed: false, name: "amountNetHandle", type: "bytes32" },
    ],
    name: "Paid",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "employee", type: "address" },
      { indexed: false, name: "netHandle", type: "bytes32" },
      { indexed: false, name: "taxHandle", type: "bytes32" },
    ],
    name: "BonusGranted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "deptId", type: "bytes32" },
    ],
    name: "DeptAggregatePublished",
    type: "event",
  },
  { anonymous: false, inputs: [], name: "CompanyAggregatePublished", type: "event" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "deptId", type: "bytes32" },
    ],
    name: "DeptTaxPublished",
    type: "event",
  },
  { anonymous: false, inputs: [], name: "CompanyTaxPublished", type: "event" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "deptId", type: "bytes32" },
      { indexed: false, name: "name", type: "string" },
    ],
    name: "DeptRegistered",
    type: "event",
  },
];

/* Minimal ABI of a standard ERC-20 (for USDC mock) */
export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];