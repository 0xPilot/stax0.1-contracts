pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILockerProxy {
    function lock(address _user, uint256 _liquidity) external returns (uint256);
}

contract StaxWrapped is ERC20, Ownable {

    address public lockProxy;
    mapping(address => uint256) wrappedBalances;

    // TODO: init vars
    constructor() ERC20("Stax Wrapped TEMPLE/FRAX LP", "xLP"){}


    function lock(uint256 _liquidity) external {
        uint256 mintAmount = ILockerProxy(lockProxy).lock(msg.sender, _liquidity);
        _mint(msg.sender, mintAmount);
    }

    // TODO: override?
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override{

    }
}