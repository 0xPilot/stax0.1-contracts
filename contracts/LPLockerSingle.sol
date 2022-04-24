pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


interface IUnifiedFarm {
    function stakeLocked(uint256 liquidity, uint256 secs) external;
    function getReward(address destination_address) external returns (uint256[] memory);
    function withdrawLocked(bytes32 kek_id, address destination_address) external;
    function lockAdditional(bytes32 kek_id, uint256 addl_liq) external;
    function proxyToggleStaker(address staker_address) external;
    function stakerSetVeFXSProxy(address proxy_address) external;
    function stakerToggleMigrator(address migrator_address) external;
}

interface IXLPToken {
    function mint(address to, uint256 amount) external;
    function burn(address account, uint256 amount) external;
}


contract LPLockerSingle is Ownable {

    using SafeERC20 for IERC20;

    address public lpFarm; // TEMPLE/FRAX LP farm.
    address public lpToken; // TEMPLE/FRAX LP
    address public xlpToken;
    address public rewardsManager;
    address public operator;

    uint32 public lockRate;
    uint32 public liquidityRate;
    uint32 public lockDenominator = 100;
    uint32 public constant MIN_LIQUIDITY_RATE = 10;
    uint32 public constant MAX_LIQUIDITY_RATE = 50; // max 50% of lp deposit/reserve to be used for liquidity

    uint256 public constant MAX_LOCK_TIME = 3 * 365 * 86400; // 3 years

    address[] public rewardTokens;

    event SetLockParams(uint32 lockRate, uint32 liquidityRate);
    event Locked(address user, uint256 amountLocked, uint256 amountReserved);
    event RewardHarvested(address token, address to, uint256 amount);
    event RewardClaimed(uint256[] data);
    event SetVeFXSProxy(address proxy);
    event MigratorToggled(address migrator);
    event RewardsManagerSet(address manager);
    event OperatorSet(address operator);
    event WithdrawLocked(bytes32 _kekId, uint256 amount, bool _relock);
    event TokenRecovered(address user, uint256 amount);

    constructor(
        address _lpFarm,
        address _lpToken,
        address _xlpToken,
        address _rewardsManager,
        address _operator,
        address[] memory _rewards
    ) {
        lpFarm = _lpFarm;
        lpToken = _lpToken;
        xlpToken = _xlpToken;
        rewardsManager = _rewardsManager;
        operator = _operator;

        for (uint i=0; i<_rewards.length; i++) {
            rewardTokens.push(_rewards[i]);
        }
    }

    // set lp farm in case of migration
    function setLPFarm(address _lpFarm) external onlyOwner {
        require(_lpFarm != address(0), "invalid address");
        lpFarm = _lpFarm;
    }

    // set percentage of lp deposit to lock
    function setLockParams(uint256 _lockRate, uint256 _liquidityRate) external onlyOwner {
        require(_lockRate >= MAX_LIQUIDITY_RATE &&  _lockRate <= 100, "invalid lock rate");
        require(_liquidityRate >= MIN_LIQUIDITY_RATE && _liquidityRate <= MAX_LIQUIDITY_RATE, "invalid liquidity rate");
        require(_lockRate + _liquidityRate == lockDenominator, "invalid rates sum");
        lockRate = uint32(_lockRate);
        liquidityRate = uint32(_liquidityRate);
    }

    function setRewardsManager(address _manager) external onlyOwner {
        require(_manager != address(0), "invalid address");
        rewardsManager = _manager;

        emit RewardsManagerSet(_manager);
    }

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "invalid address");
        operator = _operator;

        emit OperatorSet(_operator);
    }

    // lock liquidity for user
    // new lock created each time for max lock time
    function lock(uint256 _liquidity) external {
        // pull tokens and update allowance
        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), _liquidity);
        uint256 lockAmount = getLockAmount(_liquidity);
        IERC20(lpToken).safeIncreaseAllowance(lpFarm, lockAmount);
        IUnifiedFarm(lpFarm).stakeLocked(lockAmount, MAX_LOCK_TIME);

        // mint lp token to user
        // TODO: 1. do we mint this token 1:1? 2. do we mint the locked amount or total lp amount equivalent to user?
        IXLPToken(xlpToken).mint(msg.sender, lockAmount);

        emit Locked(msg.sender, lockAmount, _liquidity - lockAmount);
    }

    // withdraw locked lp. optionally relock
    function withdrawLocked(bytes32 _kekId, bool _relock) external onlyOperator {
        // @dev there may be reserve lp tokens in contract. account for those
        uint256 lpTokensBefore = IERC20(lpToken).balanceOf(address(this));
        IUnifiedFarm(lpFarm).withdrawLocked(_kekId, address(this));
        uint256 lpTokensAfter = IERC20(lpToken).balanceOf(address(this));
        if (_relock) {
            uint256 toLock = lpTokensAfter - lpTokensBefore;
            IERC20(lpToken).safeIncreaseAllowance(lpFarm, toLock);
            IUnifiedFarm(lpFarm).stakeLocked(toLock, MAX_LOCK_TIME);
        }

        emit WithdrawLocked(_kekId, lpTokensAfter - lpTokensBefore, _relock);
    }

    // get amount to lock based on lock rate
    function getLockAmount(uint256 _amount) internal view returns (uint256) {
        if (lockRate == 0 || liquidityRate == 0) {
            return _amount;
        }
        return (_amount * lockRate) / lockDenominator;
    }

    // claim reward to this contract.
    // reward manager will withdraw rewards for incentivizing xlp stakers
    function getReward() external returns (uint256[] memory data) {
        data = IUnifiedFarm(lpFarm).getReward(address(this));

        emit RewardClaimed(data);
    }

    // harvest rewards
    function harvestRewards() external onlyRewardsManager {
        // iterate through reward tokens and transfer to rewardsManager
        for (uint i=0; i<rewardTokens.length; i++) {
            address token = rewardTokens[i];
            uint256 amount = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(rewardsManager, amount);

            emit RewardHarvested(token, rewardsManager, amount);
        }
    }

    // add liqudity to pool
    // TODO: depends on pool decision
    /*function addLiquidity() external onlyOwner {
        // mit xLP:LP tokens (based on current reserves) and seed in pool
    }*/

    // Staker can allow a veFXS proxy (the proxy will have to toggle them first)
    function setVeFXSProxy(address _proxy) external onlyOwner {
        IUnifiedFarm(lpFarm).stakerSetVeFXSProxy(_proxy);

        emit SetVeFXSProxy(_proxy);
    }

    // Staker can allow a migrator
    function stakerToggleMigrator(address _migrator) external onlyOwner {
        IUnifiedFarm(lpFarm).stakerToggleMigrator(_migrator);

        emit MigratorToggled(_migrator);
    }

    // recover tokens except reward tokens
    // for reward tokens use harvestRewards instead
    function recoverToken(address _token, uint256 _amount) external onlyOperatorOrRewardsManager {
        for (uint i=0; i<rewardTokens.length; i++) {
            require(_token != rewardTokens[i], "can't recover reward token this way");
        }
        if (_amount == 0) {
            _amount = IERC20(_token).balanceOf(address(this));
        }
        IERC20(_token).safeTransfer(owner(), _amount);

        emit TokenRecovered(owner(), _amount);
    }

    // to execute arbitrary transactions such as actions to maintain peg with reward emissions
    function execute(address _to, bytes calldata _data) external onlyOwner {
        (bool success,) = _to.call{value:0}(_data);
        require(success, "execution failed");
    }

    modifier onlyRewardsManager {
        require(msg.sender == rewardsManager, "only rewards manager");
        _;
    }

    modifier onlyOperatorOrRewardsManager {
        require(msg.sender == operator || msg.sender == rewardsManager, "only operator or rewards manager");
        _;
    }

    modifier onlyOperator {
        require(msg.sender == rewardsManager, "only rewards manager");
        _;
    }
}