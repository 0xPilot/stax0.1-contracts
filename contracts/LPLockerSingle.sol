pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IXLPToken {
    function mint(address to, uint256 amount) external;
}

contract LPLockerSingle is Ownable {

    using SafeERC20 for IERC20;

    address public liquidityManager;
    IERC20 public lpToken; // lp token
    IXLPToken public xlpToken; // xLP token

    event Locked(address user, uint256 amountLocked);

    constructor(
        address _liquidityManager,
        address _lpToken,
        address _xlpToken
    ) {
        liquidityManager = _liquidityManager;
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
    }

    function setLiquidityManager(address _liquidityManager) external onlyOwner {
        require(_liquidityManager != address(0), "invalid address");
        liquidityManager = _liquidityManager;
    }

    // lock that adds additionally to single lock position for every user lock
    // this scenario assumes there is only one lock at all times for this contract
    function lock(uint256 _liquidity) external {
        // pull tokens and update allowance
        lpToken.safeTransferFrom(msg.sender, liquidityManager, _liquidity);

        // mint xlp token to user
        xlpToken.mint(msg.sender, _liquidity);

        emit Locked(msg.sender, _liquidity);
    }

}