// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MockUSDC — минимальный ERC20 с decimals=6, минтом и simple-Ownable.
 * Имя/символ фиксированы: "USD Coin (Mock)" / "USDC".
 * В конструкторе можно сразу наминтить initialMint получателю initialReceiver.
 */

interface IERC20Events {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract MockUSDC is IERC20Events {
    string public constant name = "USD Coin (Mock)";
    string public constant symbol = "USDC";
    uint8  public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256)                      public balanceOf;
    mapping(address => mapping(address => uint256))  public allowance;

    // ─── Простая ownable ───
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "MockUSDC: not owner"); _; }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MockUSDC: zero owner");
        owner = newOwner;
    }

    constructor(address initialReceiver, uint256 initialMint) {
        owner = msg.sender;
        if (initialReceiver != address(0) && initialMint > 0) {
            _mint(initialReceiver, initialMint);
        }
    }

    // ─── ERC-20 ───
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount); return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockUSDC: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount); return true;
    }

    // ─── onlyOwner mint ───
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // ─── internal ───
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "MockUSDC: to=0");
        require(balanceOf[from] >= amount, "MockUSDC: balance");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to]   += amount;
        }
        emit Transfer(from, to, amount);
    }
    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "MockUSDC: mint to=0");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
