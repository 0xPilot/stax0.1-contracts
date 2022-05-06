pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


interface ILPLocker {
    function withdrawLPToken(uint256 _amount) external;
}

interface IXLPToken {
    function mint(address to, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

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

interface IStableSwap {
    function coins(uint256 j) external view returns (address);

    function calc_token_amount(uint256[2] calldata _amounts, bool _is_deposit) external view returns (uint256);

    function add_liquidity(
        uint256[2] calldata _amounts,
        uint256 _min_mint_amount
    ) external returns (uint256);

    function get_dy(
        int128 _from,
        int128 _to,
        uint256 _from_amount
    ) external view returns (uint256);

    function remove_liquidity(uint256 _amount, uint256[2] calldata _min_amounts) external returns (uint256[2] memory);
}


contract LiquidityOps is Ownable {
    using SafeERC20 for IERC20;

    IUnifiedFarm public lpFarm; // frax unified lp farm
    IXLPToken public xlpToken;
    IERC20 public lpToken;
    IStableSwap public curvePool;
    IERC20 public curveToken;
    address public rewardsManager;

    address public operator;

    struct LockRate {
        uint128 numerator;
        uint128 denominator;
    }
    LockRate public lockRate;

    // fxs emissions + random token extra bribe
    IERC20[] public rewardTokens;

    uint256 public curveLiquidityTolerancePct;

    event SetLockParams(uint128 numerator, uint128 denominator);
    event Locked(uint256 amountLocked);
    event LiquidityAdded(uint256 lpAmount, uint256 xlpAmount, uint256 curveTokenAmount);
    event LiquidityRemoved(uint256 lpAmount, uint256 xlpAmount, uint256 curveTokenAmount);
    event WithdrawAndReLock(bytes32 _kekId, uint256 amount);
    event RewardHarvested(address token, address to, uint256 amount);
    event RewardClaimed(uint256[] data);
    event SetVeFXSProxy(address proxy);
    event MigratorToggled(address migrator);
    event RewardsManagerSet(address manager);
  
    constructor(
        address _lpFarm,
        address _lpToken,
        address _xlpToken,
        address _curvePool,
        address _curveToken,
        address _rewardsManager
    ) {
        lpFarm = IUnifiedFarm(_lpFarm);
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
        curvePool = IStableSwap(_curvePool);
        curveToken = IERC20(_curveToken);
        rewardsManager = _rewardsManager;
        curveLiquidityTolerancePct = 99;
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function setLockParams(uint128 _numerator, uint128 _denominator) external onlyOwner {
        require(_numerator > 0 && _numerator <= _denominator, "invalid params");
        lockRate.numerator = _numerator;
        lockRate.denominator = _denominator;

        emit SetLockParams(_numerator, _denominator);
    }

    function setParams(uint256 _curveLiquidityTolerancePct) external onlyOwner {
        require(_curveLiquidityTolerancePct > 0 && _curveLiquidityTolerancePct <= 100, "invalid percentage");
        curveLiquidityTolerancePct = _curveLiquidityTolerancePct;
    }

    function setRewardsManager(address _manager) external onlyOwner {
        require(_manager != address(0), "invalid address");
        rewardsManager = _manager;

        emit RewardsManagerSet(_manager);
    }

    function lockTimeForMaxMultiplier() public view returns (uint256) {
        return lpFarm.lock_time_for_max_multiplier();
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

    function lockInGauge(uint256 liquidity) private {
        lpToken.safeIncreaseAllowance(address(lpFarm), liquidity);

        // if first time lock
        IUnifiedFarm.LockedStake[] memory lockedStakes = lpFarm.lockedStakesOf(address(this));
        uint256 lockedStakesLength = lockedStakes.length;

        // we want to lock additional if lock end time not expired
        // check last lockedStake if expired
        if (lockedStakesLength == 0 || block.timestamp >= lockedStakes[lockedStakesLength - 1].ending_timestamp) {
            lpFarm.stakeLocked(liquidity, lockTimeForMaxMultiplier());
        } else {
            lpFarm.lockAdditional(lockedStakes[lockedStakesLength - 1].kek_id, liquidity);
        }
        
        emit Locked(liquidity);
    }

    function addLiquidity(uint256 liquidity) private {
        // Get the amount of xLP needed to add into the liquidity pool
        // such that the price remains about the same - don't apply any peg fixing here.
        // Use the curve pool to check which index is xlp vs lp
        uint256 xlpAmount = curvePool.coins(0) == address(xlpToken) 
            ? curvePool.get_dy(1, 0, liquidity) 
            : curvePool.get_dy(0, 1, liquidity);
        
        // Mint the new xLP
        xlpToken.mint(address(this), xlpAmount);

        uint256[2] memory amounts = [xlpAmount, liquidity];
        
        // The min token amount we're willing to accept
        uint256 minCurveTokenAmount = curvePool.calc_token_amount(amounts, true) * curveLiquidityTolerancePct / 100;
        uint256 curveTokenAmount = curvePool.add_liquidity(amounts, minCurveTokenAmount);

        emit LiquidityAdded(liquidity, xlpAmount, curveTokenAmount);
    }

    function removeLiquidity(
        uint256 _liquidity,
        uint256 _lpAmountMin,
        uint256 _xlpAmountMin
    ) external onlyOperator {
        uint256 balance = curveToken.balanceOf(address(this));
        require(balance >= _liquidity, "not enough tokens");
        curveToken.safeIncreaseAllowance(address(curvePool), _liquidity);

        bool xlpIsFirst = curvePool.coins(0) == address(xlpToken);
        uint256[2] memory minAmounts = xlpIsFirst 
            ? [_xlpAmountMin, _lpAmountMin]
            : [_lpAmountMin, _xlpAmountMin];

        uint256[2] memory balances = curvePool.remove_liquidity(_liquidity, minAmounts);

        // Switch the order if necessary so [lp, xlp]
        uint256[2] memory balancesInOrder = xlpIsFirst
            ? [ balances[1], balances[0] ]
            : balances;
        
        emit LiquidityRemoved(balancesInOrder[0], balancesInOrder[1], _liquidity);
    }

    // Permissionless.
    function applyLiquidity() external {
        uint256 availableLiquidity = lpToken.balanceOf(address(this));
        require(availableLiquidity > 0, "not enough liquidity");
        uint256 lockAmount = _getLockAmount(availableLiquidity);

        lockInGauge(lockAmount);
        addLiquidity(availableLiquidity - lockAmount);
    }

    // get amount to lock based on lock rate
    function _getLockAmount(uint256 _amount) internal view returns (uint256) {
        // if not set, lock total amount
        if (lockRate.numerator == 0) {
            return _amount;
        }
        return (_amount * lockRate.numerator) / lockRate.denominator;
    }

    // withdrawAndRelock is called to withdraw expired locks and relock into the most recent
    function withdrawAndRelock(bytes32 _oldKekId) external {
        // there may be reserve lp tokens in contract. account for those
        uint256 lpTokensBefore = lpToken.balanceOf(address(this));
        lpFarm.withdrawLocked(_oldKekId, address(this));
        uint256 lpTokensAfter = lpToken.balanceOf(address(this));
        uint256 lockAmount;
        unchecked {
            lockAmount = lpTokensAfter - lpTokensBefore;
        }

        lpToken.safeIncreaseAllowance(address(lpFarm), lockAmount);

        // Re-lock into the most recent lock
        IUnifiedFarm.LockedStake[] memory lockedStakes = lpFarm.lockedStakesOf(address(this));
        uint256 lockedStakesLength = lockedStakes.length;
        lpFarm.lockAdditional(lockedStakes[lockedStakesLength - 1].kek_id, lockAmount);

        emit WithdrawAndReLock(_oldKekId, lockAmount);
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
        lpFarm.stakerSetVeFXSProxy(_proxy);

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

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }
}
