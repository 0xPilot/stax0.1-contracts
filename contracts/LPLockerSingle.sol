pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// TODO: (pb) conform to styleguide

/// @dev interface of the frax gauge. Based on FraxUnifiedFarmTemplate.sol
/// https://github.com/FraxFinance/frax-solidity/blob/master/src/hardhat/contracts/Staking/FraxUnifiedFarmTemplate.sol
interface IUnifiedFarm {
    // Struct for the stake
    struct LockedStake {
        bytes32 kek_id;
        uint256 start_timestamp;
        uint256 liquidity;
        uint256 ending_timestamp;
        uint256 lock_multiplier; // 6 decimals of precision. 1x = 1000000
    }
    function stakeLocked(uint256 liquidity, uint256 secs) external;
    function getReward(address destination_address) external returns (uint256[] memory);
    function withdrawLocked(bytes32 kek_id, address destination_address) external;
    function lockAdditional(bytes32 kek_id, uint256 addl_liq) external;
    function proxyToggleStaker(address staker_address) external;
    function stakerSetVeFXSProxy(address proxy_address) external;
    function stakerToggleMigrator(address migrator_address) external;
    function lock_time_for_max_multiplier() external view returns (uint256);
    function getAllRewardTokens() external view returns (address[] memory);
    function lockedStakes(address account) external view returns (LockedStake[] memory);
    function lockedLiquidityOf(address account) external view returns (uint256);
    function lockedStakesOf(address account) external view returns (LockedStake[] memory);
    function lockedStakesOfLength(address account) external view returns (uint256);
}

interface IXLPToken {
    function mint(address to, uint256 amount) external;
    function burn(address account, uint256 amount) external;
}


contract LPLockerSingle is Ownable {

    using SafeERC20 for IERC20;

    IUnifiedFarm public lpFarm; // frax unified lp farm
    IERC20 public lpToken; // lp token
    IXLPToken public xlpToken; // xLP token
    address public rewardsManager;
    address public operator;

    LockRate public lockRate;

    // fxs emissions + random token extra bribe
    IERC20[] public rewardTokens;

    // can withdraw lp for balancing liquidity pool
    mapping(address => bool) public lpManagers;

    struct LockRate {
        uint128 numerator;
        uint128 denominator;
    }

    event SetLockParams(uint128 numerator, uint128 denominator);
    event Locked(address user, uint256 amountLocked, uint256 amountReserved);
    event RewardHarvested(address token, address to, uint256 amount);
    event RewardClaimed(uint256[] data);
    event SetVeFXSProxy(address proxy);
    event MigratorToggled(address migrator);
    event RewardsManagerSet(address manager);
    event WithdrawLocked(bytes32 _kekId, uint256 amount);
    event TokenRecovered(address user, uint256 amount);
    event LPTokenWithdrawn(address withdrawer, uint256 amount);


    constructor(
        address _lpFarm,
        address _lpToken,
        address _xlpToken,
        address _rewardsManager
    ) {
        lpFarm = IUnifiedFarm(_lpFarm);
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
        rewardsManager = _rewardsManager;
    }

    // set lp farm in case of migration
    function setLPFarm(address _lpFarm) external onlyOwner {
        require(_lpFarm != address(0), "invalid address");
        lpFarm = IUnifiedFarm(_lpFarm);
    }

    function setRewardTokens() external {
        address[] memory tokens = lpFarm.getAllRewardTokens();
        for (uint i=0; i<tokens.length; i++) {
            rewardTokens.push(IERC20(tokens[i]));
        }
    }

    function setLockParams(uint128 _numerator, uint128 _denominator) external onlyOwner {
        require(_numerator > 0 && _numerator <= _denominator, "invalid params");
        lockRate.numerator = _numerator;
        lockRate.denominator = _denominator;

        emit SetLockParams(_numerator, _denominator);
    }

    function setRewardsManager(address _manager) external onlyOwner {
        require(_manager != address(0), "invalid address");
        rewardsManager = _manager;

        emit RewardsManagerSet(_manager);
    }

    function setLPManager(address _manager, bool _status) external onlyOwner {
        lpManagers[_manager] = _status;
    }

    function lockTimeForMaxMultiplier() public view returns (uint256) {
        return lpFarm.lock_time_for_max_multiplier();
    }

    // lock that adds additionally to single lock position for every user lock
    // this scenario assumes there is only one lock at all times for this contract
    function lock(uint256 _liquidity, bytes32 _kekId) external {
        // pull tokens and update allowance
        lpToken.safeTransferFrom(msg.sender, address(this), _liquidity);
        uint256 lockAmount = _getLockAmount(_liquidity);
        lpToken.safeIncreaseAllowance(address(lpFarm), lockAmount);

        // if first time lock
        IUnifiedFarm.LockedStake[] memory lockedStakes = lpFarm.lockedStakesOf(address(this));
        uint256 lockedStakesLength = lockedStakes.length; //lpFarm.lockedStakesOfLength(address(this));

        // we want to lock additional if lock end time not expired
        // check last lockedStake if expired
        if (lockedStakesLength == 0 || block.timestamp >= lockedStakes[lockedStakesLength - 1].ending_timestamp) {
            lpFarm.stakeLocked(lockAmount, lockTimeForMaxMultiplier());
        } else {
            lpFarm.lockAdditional(_kekId, lockAmount);
        }

        // mint lp token to user
        xlpToken.mint(msg.sender, lockAmount);

        emit Locked(msg.sender, lockAmount, _liquidity - lockAmount);
    }

    // withdraw locked lp
    // withdrawLocked is called to withdraw expired locks and relock
    function withdrawLocked(bytes32 _oldKekId, bytes32 _newKekId) external {
        // there may be reserve lp tokens in contract. account for those
        uint256 lpTokensBefore = lpToken.balanceOf(address(this));
        lpFarm.withdrawLocked(_oldKekId, address(this));
        uint256 lpTokensAfter = lpToken.balanceOf(address(this));
        uint256 lockAmount;
        unchecked {
            lockAmount = lpTokensAfter - lpTokensBefore;
        }

        lpToken.safeIncreaseAllowance(address(lpFarm), lockAmount);
        lpFarm.lockAdditional(_newKekId, lockAmount);

        emit WithdrawLocked(_oldKekId, lockAmount);
    }

    // get amount to lock based on lock rate
    function _getLockAmount(uint256 _amount) internal view returns (uint256) {
        // if not set, lock total amount
        if (lockRate.numerator == 0) {
            return _amount;
        }
        return (_amount * lockRate.numerator) / lockRate.denominator;
    }

    // claim reward to this contract.
    // reward manager will withdraw rewards for incentivizing xlp stakers
    function getReward() external returns (uint256[] memory data) {
        data = lpFarm.getReward(address(this));

        emit RewardClaimed(data);
    }

    // harvest rewards
    function harvestRewards() external {
        // iterate through reward tokens and transfer to rewardsManager
        for (uint i=0; i<rewardTokens.length; i++) {
            IERC20 token = rewardTokens[i];
            uint256 amount = token.balanceOf(address(this));
            IERC20(token).safeTransfer(rewardsManager, amount);

            emit RewardHarvested(address(token), rewardsManager, amount);
        }
    }

    // Staker can allow a veFXS proxy (the proxy will have to toggle them first)
    function setVeFXSProxy(address _proxy) external onlyOwner {
        IUnifiedFarm(lpFarm).stakerSetVeFXSProxy(_proxy);

        emit SetVeFXSProxy(_proxy);
    }

    // To migrate:
    // - unified farm owner/gov sets valid migrator
    // - stakerToggleMigrator() - this func
    // - gov/owner calls toggleMigrations()
    // - migrator calls migrator_withdraw_locked(this, kek_id), which calls _withdrawLocked(staker, migrator) - sends lps to migrator
    // - migrator is assumed to be new lplocker and therefore would now own the lp tokens and can relock (stakelock) in newly upgraded gauge.
    // Staker can allow a migrator
    function stakerToggleMigrator(address _migrator) external onlyOwner {
        lpFarm.stakerToggleMigrator(_migrator);

        emit MigratorToggled(_migrator);
    }

    // withdraw lp token for use in balancing liquidity pool
    function withdrawLPToken(uint256 _amount) external isLPManager {
        _transferToken(lpToken, msg.sender, _amount);

        emit LPTokenWithdrawn(msg.sender, _amount);
    }

    // recover tokens except reward tokens
    // for reward tokens use harvestRewards instead
    function recoverToken(address _token, address _to, uint256 _amount) external onlyOwner {
        for (uint i=0; i<rewardTokens.length; i++) {
            require(_token != address(rewardTokens[i]), "can't recover reward token this way");
        }

        _transferToken(IERC20(_token), _to, _amount);

        emit TokenRecovered(_to, _amount);
    }

    function _transferToken(IERC20 _token, address _to, uint256 _amount) internal {
        uint256 balance = _token.balanceOf(address(this));
        require(_amount <= balance, "not enough tokens");
        _token.safeTransfer(_to, _amount);
    }

    modifier isLPManager() {
        require(lpManagers[msg.sender] == true, "not lp manager");
        _;
    }
}