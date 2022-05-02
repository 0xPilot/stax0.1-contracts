pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


interface IXLPToken {
    function burn(address account, uint256 amount) external;
}

interface IUnifiedFarm {
    function migrator_withdraw_locked(address staker_address, bytes32 kek_id) external;
}


// Contract to allow users to be reimbursed their lp tokens if the stax v0.1 product doesn't work out. 
// this contract allows users to burn their received xLP for their original lp tokens
// prerequisites:
// - this contract is a valid migrator and lp locker has toggled it (staker_allowed_migrators)
// - migration is done on gauge and lp tokens have been sent to this contract
// - liquidity pool is drained to account for percentage of lp tokens used as liqudity and lp tokens sent to this contract
// - also this contract is permitted as xLP burner/minter ACL
//
contract RefundLockers is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public lpToken;
    IXLPToken public xlpToken;
    IUnifiedFarm public lpFarm;

    event UserReimbursed(address user, uint256 amount);
    event LockerMigrated(bytes32 kekId);

    constructor(address _lpToken, address _xlpToken) {
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
    }

    function migrateLocker(address _lpLocker, bytes32 _kekId) external onlyOwner {
        IUnifiedFarm(lpFarm).migrator_withdraw_locked(_lpLocker, _kekId);

        emit LockerMigrated(_kekId);
    }

    function withdraw(uint256 _amount) external ensureEnoughLPTokens(_amount) {
        require(_amount > 0, "invalid amount");
        // burn user tokens and send equivalent amount in lpTokens
        xlpToken.burn(msg.sender, _amount);
        lpToken.safeTransfer(msg.sender, _amount);

        emit UserReimbursed(msg.sender, _amount);
    }

    modifier ensureEnoughLPTokens(uint256 _amount) {
        require(lpToken.balanceOf(address(this)) >= _amount, "not enough lp tokens");
        _;
    }
}