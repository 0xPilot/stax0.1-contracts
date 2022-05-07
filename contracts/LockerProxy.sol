pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IXLPToken {
    function mint(address to, uint256 amount) external;
}

contract LockerProxy is Ownable {

    using SafeERC20 for IERC20;

    address public liquidityOps;
    IERC20 public lpToken; // lp token
    IXLPToken public xlpToken; // xLP token

    event Locked(address user, uint256 amountLocked);
    event LiquidityOpsSet(address liquidityOps);
    event TokenRecovered(address user, uint256 amount);

    constructor(
        address _liquidityOps,
        address _lpToken,
        address _xlpToken
    ) {
        liquidityOps = _liquidityOps;
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
    }

    function setLiquidityOps(address _liquidityOps) external onlyOwner {
        require(_liquidityOps != address(0), "invalid address");
        liquidityOps = _liquidityOps;
        emit LiquidityOpsSet(_liquidityOps);
    }

    // lock that adds additionally to single lock position for every user lock
    // this scenario assumes there is only one lock at all times for this contract
    function lock(uint256 _liquidity) external {
        // pull tokens and update allowance
        lpToken.safeTransferFrom(msg.sender, liquidityOps, _liquidity);

        // mint xlp token to user
        xlpToken.mint(msg.sender, _liquidity);

        emit Locked(msg.sender, _liquidity);
    }

    // recover tokens
    function recoverToken(address _token, address _to, uint256 _amount) external onlyOwner {
        _transferToken(IERC20(_token), _to, _amount);
        emit TokenRecovered(_to, _amount);
    }

    function _transferToken(IERC20 _token, address _to, uint256 _amount) internal {
        uint256 balance = _token.balanceOf(address(this));
        require(_amount <= balance, "not enough tokens");
        _token.safeTransfer(_to, _amount);
    }
}