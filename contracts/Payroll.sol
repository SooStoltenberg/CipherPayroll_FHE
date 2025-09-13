// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* Zama FHEVM */
import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * Payroll — FHE payroll with 20% tax (divider 5) WITHOUT on-chain division.
 * The tax split is computed off-chain and submitted encrypted (tax = gross/5).
 * v3.0.3-no-div — refactored addEmployee / updateRate to avoid "Stack too deep".
 */
contract Payroll is SepoliaConfig {
    /* ─── Ownable / HR ─── */
    address public owner;
    mapping(address => bool) public isHR;

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyHR() { require(msg.sender == owner || isHR[msg.sender], "not HR"); _; }

    uint64 internal constant SEC_MONTH = 30 * 24 * 3600; // seconds in 30 days

    constructor(address _owner) {
        require(_owner != address(0), "zero owner");
        owner = _owner;

        companyTotalRate     = FHE.asEuint64(0); // gross rate/sec
        companyTotalTaxRate  = FHE.asEuint64(0); // tax rate/sec
        companyTotalGross    = FHE.asEuint64(0);
        companyTotalTax      = FHE.asEuint64(0);
        companyTotalAccrued  = FHE.asEuint64(0); // NET

        FHE.allowThis(companyTotalRate);
        FHE.allowThis(companyTotalTaxRate);
        FHE.allowThis(companyTotalGross);
        FHE.allowThis(companyTotalTax);
        FHE.allowThis(companyTotalAccrued);

        FHE.allow(companyTotalRate, owner);
        FHE.allow(companyTotalTaxRate, owner);
        FHE.allow(companyTotalGross, owner);
        FHE.allow(companyTotalTax, owner);
        FHE.allow(companyTotalAccrued, owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }
    function setHR(address who, bool v) external onlyOwner { isHR[who] = v; }

    /* ─── Models ─── */
    struct Employee {
        bytes32 deptId;
        euint64 ratePerSec;      // GROSS tokens/sec stream
        euint64 taxPerSec;       // TAX tokens/sec stream (gross/5), provided off-chain
        euint64 monthlyDisplay;  // exact "monthly" amount (as entered by HR), for UI

        // accrued amounts:
        euint64 accruedGross;    // accrued gross
        euint64 taxAccrued;      // accrued tax
        euint64 accruedNet;      // take-home (NET)
        uint64  lastAccrualTs;
        bool    exists;
    }

    struct DeptAgg {
        euint64 totalRatePerSec; // department gross stream
        euint64 totalTaxPerSec;  // department tax stream
        euint64 totalGross;
        euint64 totalTax;
        euint64 totalNet;
        bool    exists;
    }

    mapping(address => Employee) internal employees;
    mapping(bytes32  => DeptAgg)  internal depts;

    // Catalogs for the frontend
    address[] public allEmployees;
    mapping(address => uint256) internal empIndex; // 1-based
    mapping(bytes32 => address[]) internal deptMembers;
    bytes32[] public deptIds;
    mapping(bytes32 => string) public deptNameOf;

    // Company aggregates
    euint64 internal companyTotalRate;     // gross stream
    euint64 internal companyTotalTaxRate;  // tax stream
    euint64 internal companyTotalGross;
    euint64 internal companyTotalTax;
    euint64 internal companyTotalAccrued; // = NET

    /* ─── Events ─── */
    event EmployeeAdded(address indexed employee, bytes32 indexed deptId);
    event EmployeeRateUpdated(address indexed employee, bytes32 indexed deptId);
    event Accrued(address indexed employee, uint64 deltaSeconds);
    event Paid(address indexed employee, bytes32 amountNetHandle);
    event BonusGranted(address indexed employee, bytes32 netHandle, bytes32 taxHandle);
    event DeptAggregatePublished(bytes32 indexed deptId); // NET
    event CompanyAggregatePublished();                   // NET
    event DeptTaxPublished(bytes32 indexed deptId);
    event CompanyTaxPublished();
    event DeptRegistered(bytes32 indexed deptId, string name);

    /* ─── Helpers ─── */
    function _ensureDept(bytes32 deptId) internal {
        if (depts[deptId].exists) return;

        depts[deptId].exists = true;
        depts[deptId].totalRatePerSec = FHE.asEuint64(0);
        depts[deptId].totalTaxPerSec  = FHE.asEuint64(0);
        depts[deptId].totalGross      = FHE.asEuint64(0);
        depts[deptId].totalTax        = FHE.asEuint64(0);
        depts[deptId].totalNet        = FHE.asEuint64(0);

        FHE.allowThis(depts[deptId].totalRatePerSec);
        FHE.allowThis(depts[deptId].totalTaxPerSec);
        FHE.allowThis(depts[deptId].totalGross);
        FHE.allowThis(depts[deptId].totalTax);
        FHE.allowThis(depts[deptId].totalNet);

        FHE.allow(depts[deptId].totalRatePerSec, owner);
        FHE.allow(depts[deptId].totalTaxPerSec,  owner);
        FHE.allow(depts[deptId].totalGross,      owner);
        FHE.allow(depts[deptId].totalTax,        owner);
        FHE.allow(depts[deptId].totalNet,        owner);

        deptIds.push(deptId);
    }

    function upsertDeptName(bytes32 deptId, string calldata name) external onlyHR {
        _ensureDept(deptId);
        if (bytes(deptNameOf[deptId]).length == 0 && bytes(name).length != 0) {
            deptNameOf[deptId] = name;
            emit DeptRegistered(deptId, name);
        }
    }

    /* ─── HR operations ─── */

    // addEmployee — version without a "fat" struct literal (fewer local vars)
    function addEmployee(
        address employee,
        bytes32 deptId,
        externalEuint64 encRatePerSec,     bytes calldata rateProof,
        externalEuint64 encMonthlyDisplay, bytes calldata monthlyProof,
        externalEuint64 encTaxPerSec,      bytes calldata taxProof
    ) external onlyHR {
        require(employee != address(0), "bad addr");
        require(!employees[employee].exists, "exists");

        _ensureDept(deptId);

        Employee storage e = employees[employee];
        e.deptId = deptId;

        { euint64 tmp = FHE.fromExternal(encRatePerSec, rateProof);         e.ratePerSec     = tmp; }
        { euint64 tmp = FHE.fromExternal(encTaxPerSec, taxProof);           e.taxPerSec      = tmp; }
        { euint64 tmp = FHE.fromExternal(encMonthlyDisplay, monthlyProof);  e.monthlyDisplay = tmp; }

        e.accruedGross  = FHE.asEuint64(0);
        e.taxAccrued    = FHE.asEuint64(0);
        e.accruedNet    = FHE.asEuint64(0);
        e.lastAccrualTs = uint64(block.timestamp);
        e.exists        = true;

        // ACL
        FHE.allowThis(e.ratePerSec);
        FHE.allowThis(e.taxPerSec);
        FHE.allowThis(e.monthlyDisplay);
        FHE.allowThis(e.accruedGross);
        FHE.allowThis(e.taxAccrued);
        FHE.allowThis(e.accruedNet);

        FHE.allow(e.ratePerSec,     employee);
        FHE.allow(e.taxPerSec,      employee);
        FHE.allow(e.monthlyDisplay, employee);
        FHE.allow(e.accruedGross,   employee);
        FHE.allow(e.taxAccrued,     employee);
        FHE.allow(e.accruedNet,     employee);

        FHE.allow(e.ratePerSec,     owner);
        FHE.allow(e.taxPerSec,      owner);
        FHE.allow(e.monthlyDisplay, owner);
        FHE.allow(e.accruedGross,   owner);
        FHE.allow(e.taxAccrued,     owner);
        FHE.allow(e.accruedNet,     owner);

        // flow aggregates
        depts[deptId].totalRatePerSec = FHE.add(depts[deptId].totalRatePerSec, e.ratePerSec);
        depts[deptId].totalTaxPerSec  = FHE.add(depts[deptId].totalTaxPerSec,  e.taxPerSec);
        companyTotalRate              = FHE.add(companyTotalRate,     e.ratePerSec);
        companyTotalTaxRate           = FHE.add(companyTotalTaxRate,  e.taxPerSec);

        FHE.allowThis(depts[deptId].totalRatePerSec);
        FHE.allowThis(depts[deptId].totalTaxPerSec);
        FHE.allowThis(companyTotalRate);
        FHE.allowThis(companyTotalTaxRate);

        FHE.allow(depts[deptId].totalRatePerSec, owner);
        FHE.allow(depts[deptId].totalTaxPerSec,  owner);
        FHE.allow(companyTotalRate,    owner);
        FHE.allow(companyTotalTaxRate, owner);

        deptMembers[deptId].push(employee);
        allEmployees.push(employee);
        empIndex[employee] = allEmployees.length;

        emit EmployeeAdded(employee, deptId);
    }

    // updateRate — minimal locals, split into blocks
    function updateRate(
        address employee,
        externalEuint64 encNewRatePerSec, bytes calldata rateProof,
        externalEuint64 encNewTaxPerSec,  bytes calldata taxProof
    ) external onlyHR {
        Employee storage e = employees[employee];
        require(e.exists, "no employee");

        _accrueByRateInternal(employee, e);
        bytes32 deptId = e.deptId;

        euint64 oldRate = e.ratePerSec;
        euint64 oldTax  = e.taxPerSec;

        // new gross stream
        {
            euint64 nr = FHE.fromExternal(encNewRatePerSec, rateProof);
            depts[deptId].totalRatePerSec = FHE.add(FHE.sub(depts[deptId].totalRatePerSec, oldRate), nr);
            companyTotalRate              = FHE.add(FHE.sub(companyTotalRate, oldRate), nr);
            e.ratePerSec = nr;

            FHE.allowThis(e.ratePerSec);
            FHE.allow(e.ratePerSec, employee);
            FHE.allow(e.ratePerSec, owner);

            FHE.allowThis(depts[deptId].totalRatePerSec);
            FHE.allowThis(companyTotalRate);
            FHE.allow(depts[deptId].totalRatePerSec, owner);
            FHE.allow(companyTotalRate, owner);
        }

        // new tax stream
        {
            euint64 nt = FHE.fromExternal(encNewTaxPerSec, taxProof);
            depts[deptId].totalTaxPerSec = FHE.add(FHE.sub(depts[deptId].totalTaxPerSec, oldTax), nt);
            companyTotalTaxRate          = FHE.add(FHE.sub(companyTotalTaxRate, oldTax), nt);
            e.taxPerSec = nt;

            FHE.allowThis(e.taxPerSec);
            FHE.allow(e.taxPerSec, employee);
            FHE.allow(e.taxPerSec, owner);

            FHE.allowThis(depts[deptId].totalTaxPerSec);
            FHE.allowThis(companyTotalTaxRate);
            FHE.allow(depts[deptId].totalTaxPerSec, owner);
            FHE.allow(companyTotalTaxRate, owner);
        }

        emit EmployeeRateUpdated(employee, deptId);
    }

    function accrueByRate(address employee) external onlyHR {
        Employee storage e = employees[employee];
        require(e.exists, "no employee");
        _accrueByRateInternal(employee, e);
    }

    function accrueMany(address[] calldata addrs) external onlyHR {
        for (uint256 i = 0; i < addrs.length; i++) {
            Employee storage e = employees[addrs[i]];
            if (e.exists) _accrueByRateInternal(addrs[i], e);
        }
    }

    /// Payment accounting — deduct from NET, leave tax untouched
    function markPaid(address employee, externalEuint64 encAmountPaid, bytes calldata proof) external onlyHR {
        Employee storage e = employees[employee];
        require(e.exists, "no employee");

        _accrueByRateInternal(employee, e);

        euint64 req = FHE.fromExternal(encAmountPaid, proof);

        euint64 oldNet = e.accruedNet;
        ebool   enough = FHE.le(req, oldNet);
        euint64 delta  = FHE.select(enough, req, oldNet);
        euint64 newNet = FHE.select(enough, FHE.sub(oldNet, req), FHE.asEuint64(0));

        e.accruedNet = newNet;
        bytes32 deptId = e.deptId;
        depts[deptId].totalNet = FHE.sub(depts[deptId].totalNet, delta);
        companyTotalAccrued    = FHE.sub(companyTotalAccrued,    delta);

        FHE.allowThis(e.accruedNet);
        FHE.allow(e.accruedNet, employee);
        FHE.allow(e.accruedNet, owner);

        FHE.allowThis(depts[deptId].totalNet);
        FHE.allowThis(companyTotalAccrued);
        FHE.allow(depts[deptId].totalNet, owner);
        FHE.allow(companyTotalAccrued, owner);

        emit Paid(employee, FHE.toBytes32(delta));
    }

    /// One-off bonus: GROSS and TAX are provided (tax = gross/5, computed off-chain)
    function grantBonus(
        address employee,
        externalEuint64 encGross, bytes calldata proofGross,
        externalEuint64 encTax,   bytes calldata proofTax
    ) external onlyHR {
        _grantBonusOne(employee, encGross, proofGross, encTax, proofTax);
    }

    function grantBonusMany(
        address[] calldata addrs,
        bytes32[] calldata grossHandles,
        bytes[]   calldata grossProofs,
        bytes32[] calldata taxHandles,
        bytes[]   calldata taxProofs
    ) external onlyHR {
        require(
            addrs.length == grossHandles.length &&
            addrs.length == grossProofs.length  &&
            addrs.length == taxHandles.length   &&
            addrs.length == taxProofs.length, "len"
        );

        for (uint256 i = 0; i < addrs.length; i++) {
            _grantBonusOne(
                addrs[i],
                externalEuint64.wrap(grossHandles[i]), grossProofs[i],
                externalEuint64.wrap(taxHandles[i]),   taxProofs[i]
            );
        }
    }

    /* ─── Publishing aggregates ─── */
    function publishDeptAccrued(bytes32 deptId) external onlyHR {
        _ensureDept(deptId);
        FHE.makePubliclyDecryptable(depts[deptId].totalNet);
        emit DeptAggregatePublished(deptId);
    }
    function publishCompanyAccrued() external onlyHR {
        FHE.makePubliclyDecryptable(companyTotalAccrued);
        emit CompanyAggregatePublished();
    }
    function publishDeptTax(bytes32 deptId) external onlyHR {
        _ensureDept(deptId);
        FHE.makePubliclyDecryptable(depts[deptId].totalTax);
        emit DeptTaxPublished(deptId);
    }
    function publishCompanyTax() external onlyHR {
        FHE.makePubliclyDecryptable(companyTotalTax);
        emit CompanyTaxPublished();
    }

    /* ─── View / getters for the frontend ─── */
    function getMySalary() external view returns (bytes32) {
        Employee storage e = employees[msg.sender];
        return e.exists ? FHE.toBytes32(e.ratePerSec) : bytes32(0);
    }
    function getMyAccrued() external view returns (bytes32) {
        Employee storage e = employees[msg.sender];
        return e.exists ? FHE.toBytes32(e.accruedNet) : bytes32(0);
    }
    function getMyTax() external view returns (bytes32) {
        Employee storage e = employees[msg.sender];
        return e.exists ? FHE.toBytes32(e.taxAccrued) : bytes32(0);
    }

    function getDeptAccrued(bytes32 deptId) external view returns (bytes32) {
        if (!depts[deptId].exists) return bytes32(0);
        return FHE.toBytes32(depts[deptId].totalNet);
    }
    function getCompanyAccrued() external view returns (bytes32) {
        return FHE.toBytes32(companyTotalAccrued);
    }
    function getDeptTax(bytes32 deptId) external view returns (bytes32) {
        if (!depts[deptId].exists) return bytes32(0);
        return FHE.toBytes32(depts[deptId].totalTax);
    }
    function getCompanyTax() external view returns (bytes32) {
        return FHE.toBytes32(companyTotalTax);
    }

    function getDepts() external view returns (bytes32[] memory ids, string[] memory names) {
        ids = deptIds;
        names = new string[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) names[i] = deptNameOf[ids[i]];
    }
    function getDeptEmployees(bytes32 deptId) external view returns (address[] memory) {
        return deptMembers[deptId];
    }
    function getAllEmployees() external view returns (address[] memory) {
        return allEmployees;
    }

    function getEmployeeInfo(address employee)
        external view
        returns (
            bytes32 deptId,
            bytes32 rateHandle,
            bytes32 monthlyHandle,
            bytes32 accruedHandle, // NET
            bytes32 taxHandle,
            uint64 lastTs,
            bool exists
        )
    {
        Employee storage e = employees[employee];
        if (!e.exists) return (bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0), 0, false);
        return (
            e.deptId,
            FHE.toBytes32(e.ratePerSec),
            FHE.toBytes32(e.monthlyDisplay),
            FHE.toBytes32(e.accruedNet),
            FHE.toBytes32(e.taxAccrued),
            e.lastAccrualTs,
            true
        );
    }

    function version() external pure returns (string memory) { return "Payroll/3.0.3-no-div"; }

    /* ─── Accrual core ─── */
    function _accrueByRateInternal(address employee, Employee storage e) internal {
        uint64 nowSec = uint64(block.timestamp);
        uint64 dt = nowSec > e.lastAccrualTs ? (nowSec - e.lastAccrualTs) : 0;

        if (dt > 0) {
            euint64 incGross = FHE.mul(e.ratePerSec, FHE.asEuint64(dt));
            euint64 incTax   = FHE.mul(e.taxPerSec,  FHE.asEuint64(dt));
            euint64 incNet   = FHE.sub(incGross, incTax);

            e.accruedGross = FHE.add(e.accruedGross, incGross);
            e.taxAccrued   = FHE.add(e.taxAccrued,   incTax);
            e.accruedNet   = FHE.add(e.accruedNet,   incNet);

            depts[e.deptId].totalGross = FHE.add(depts[e.deptId].totalGross, incGross);
            depts[e.deptId].totalTax   = FHE.add(depts[e.deptId].totalTax,   incTax);
            depts[e.deptId].totalNet   = FHE.add(depts[e.deptId].totalNet,   incNet);

            companyTotalGross   = FHE.add(companyTotalGross,   incGross);
            companyTotalTax     = FHE.add(companyTotalTax,     incTax);
            companyTotalAccrued = FHE.add(companyTotalAccrued, incNet);

            _allowEmpTriples(employee, e.deptId);
            e.lastAccrualTs = nowSec;
        }
        emit Accrued(employee, dt);
    }

    function _grantBonusOne(
        address employee,
        externalEuint64 encGross, bytes calldata proofGross,
        externalEuint64 encTax,   bytes calldata proofTax
    ) internal {
        Employee storage e = employees[employee];
        if (!e.exists) return;

        euint64 amount = FHE.fromExternal(encGross, proofGross);
        euint64 tax    = FHE.fromExternal(encTax,   proofTax);
        euint64 net    = FHE.sub(amount, tax);

        e.accruedGross = FHE.add(e.accruedGross, amount);
        e.taxAccrued   = FHE.add(e.taxAccrued,   tax);
        e.accruedNet   = FHE.add(e.accruedNet,   net);

        bytes32 deptId = e.deptId;
        depts[deptId].totalGross = FHE.add(depts[deptId].totalGross, amount);
        depts[deptId].totalTax   = FHE.add(depts[deptId].totalTax,   tax);
        depts[deptId].totalNet   = FHE.add(depts[deptId].totalNet,   net);

        companyTotalGross   = FHE.add(companyTotalGross,   amount);
        companyTotalTax     = FHE.add(companyTotalTax,     tax);
        companyTotalAccrued = FHE.add(companyTotalAccrued, net);

        _allowEmpTriples(employee, deptId);
        emit BonusGranted(employee, FHE.toBytes32(net), FHE.toBytes32(tax));
    }

    function _allowEmpTriples(address employee, bytes32 deptId) internal {
        FHE.allowThis(employees[employee].accruedGross);
        FHE.allowThis(employees[employee].taxAccrued);
        FHE.allowThis(employees[employee].accruedNet);

        FHE.allow(employees[employee].accruedGross, employee);
        FHE.allow(employees[employee].taxAccrued,   employee);
        FHE.allow(employees[employee].accruedNet,   employee);

        FHE.allow(employees[employee].accruedGross, owner);
        FHE.allow(employees[employee].taxAccrued,   owner);
        FHE.allow(employees[employee].accruedNet,   owner);

        FHE.allowThis(depts[deptId].totalGross);
        FHE.allowThis(depts[deptId].totalTax);
        FHE.allowThis(depts[deptId].totalNet);

        FHE.allow(depts[deptId].totalGross, owner);
        FHE.allow(depts[deptId].totalTax,   owner);
        FHE.allow(depts[deptId].totalNet,   owner);

        FHE.allowThis(companyTotalGross);
        FHE.allowThis(companyTotalTax);
        FHE.allowThis(companyTotalAccrued);

        FHE.allow(companyTotalGross, owner);
        FHE.allow(companyTotalTax,   owner);
        FHE.allow(companyTotalAccrued, owner);
    }
}

/* Factory */
contract PayrollFactory {
    event PayrollDeployed(address indexed company, address payroll);
    mapping(address => address[]) public payrollsOf;

    function deploy() external returns (address addr) {
        Payroll p = new Payroll(msg.sender);
        addr = address(p);
        payrollsOf[msg.sender].push(addr);
        emit PayrollDeployed(msg.sender, addr);
    }
}