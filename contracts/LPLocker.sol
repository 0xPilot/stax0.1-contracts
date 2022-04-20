pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IUnifiedFarm {
    function stakeLocked(uint256 liquidity, uint256 secs) external;
    function getReward(address destination_address) external returns (uint256[] memory);
    function withdrawLocked(bytes32 kek_id, address destination_address) external;
    function lockAdditional(bytes32 kek_id, uint256 addl_liq) external;
    function proxyToggleStaker(address staker_address) external;
    function stakerSetVeFXSProxy(address proxy_address) external;
    function stakerToggleMigrator(address migrator_address) external;
}


// avoid lots of reading and calculations here to save gas. 
// stax contract does reads on behalf of this contract as stax contract stores mapping(user => lockerContract) address.
// most view functions will also be delegated to stax contract
contract LPLocker {

    using SafeERC20 for IERC20;

    address public factory;
    address public user;
    address public operator; // stax contract
    address public lpFarm; // TEMPLE/FRAX LP farm.
    address public lpToken; // TEMPLE/FRAX LP

    bool private isInitialized;

    event UserLockInitialized(address user);

    function init(address _user, address _operator, address _lpFarm, address _lpToken) external {
        require(!isInitialized, "already initialized");

        isInitialized = true;
        user = _user;
        factory = msg.sender;
        operator = _operator;
        lpFarm = _lpFarm;
        lpToken = _lpToken;

        emit UserLockInitialized(_user);
    }

    // set lp farm in case of migration
    function setLPFarm(address _lpFarm) external {
        require(msg.sender == operator, "only operator");
        lpFarm = _lpFarm;
    }

    // in the event we upgrade the operator
    function setOperator(address _operator) external {
        require(msg.sender == operator, "only operator");
        require(_operator != address(0), "address 0");
        operator = _operator;
    }

    // lock liquidity for user
    function lock(uint256 _liquidity, uint256 _secs) external {
        require(msg.sender == operator, "only operator");
        // pull tokens and update allowance
        IERC20(lpToken).safeTransferFrom(user, address(this), _liquidity);
        IERC20(lpToken).safeIncreaseAllowance(lpFarm, _liquidity);
        IUnifiedFarm(lpFarm).stakeLocked(_liquidity, _secs);
    }

    // lock additional liquidity for user
    // safeTransfer liqudiity directly to contract from user. 2 transfers compared to if transfer came from stax
    function lockAddtional(bytes32 _kekId, uint256 _liquidity) external {
        require(msg.sender == operator, "only operator");
        // pull tokens and update allowance
        IERC20(lpToken).safeTransferFrom(user, address(this), _liquidity);
        IERC20(lpToken).safeIncreaseAllowance(lpFarm, _liquidity);
        IUnifiedFarm(lpFarm).lockAdditional(_kekId, _liquidity);
    }

    // withdraw and send directly to user to save gas
    function withdrawLocked(bytes32 _kekId) external {
        require(msg.sender == operator, "only operator");
        IUnifiedFarm(lpFarm).withdrawLocked(_kekId, user); 
    }

    // get reward. should user be allowed to call this? can user game if so? TODO: (pb) check with stax logic
    // send reward directly to user to save gas on extra transfer
    function getReward() external returns (uint256[] memory data) {
        require(msg.sender == operator, "only operator");
        data = IUnifiedFarm(lpFarm).getReward(user);
    }

    // Staker can allow a veFXS proxy (the proxy will have to toggle them first)
    function setVeFXSProxy(address proxyAddress) external {
        require(msg.sender == operator, "only operator");
        IUnifiedFarm(lpFarm).stakerSetVeFXSProxy(proxyAddress);
    }

    // Staker can allow a migrator
    function stakerToggleMigrator(address _migrator) external {
        require(msg.sender == operator, "only operator");
        IUnifiedFarm(lpFarm).stakerToggleMigrator(_migrator);
    }
}