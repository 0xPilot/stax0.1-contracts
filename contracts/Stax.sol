pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILPLockerFactory {
     function createLocker(
        address _user
    ) external returns (address);
}

interface ILPLocker {
    function init(address, address) external;
    function lock(uint256 _liquidity, uint256 _secs) external;
    function lockAddtional(bytes32 _kekId, uint256 _liquidity) external;
    function withdrawLocked(bytes32 _kekId) external;
    function getReward() external returns (uint256[] memory data);
    function stakerToggleMigrator(address _migrator) external;
    function setVeFXSProxy(address proxyAddress) external;
    function setOperator(address _operator) external;
}

interface IUnifiedFarm {
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
    function lockedStakesOf(address account) external view returns (LockedStake[] memory);
    function lockedStakes(address account) external view returns (LockedStake[] memory);
} 


// v0.1 of stax contracts
// a contract mostly targeted at:
//  -- users with TEMPLE/FRAX LP (possibly without veFXS) who want to earn extra temple rewards
// 
contract Stax is Ownable {
    using SafeERC20 for IERC20;

    address public lockerFactory; // factory to create user lp locker contracts
    address public templeToken; // reward token
    address public lpFarm; // TEMPLE/FRAX unified farm
    address public veFXSProxy;
    address public lockerMigrator;

    uint256 public totalLocked; // keep track of total locked lp tokens
    mapping(address => address) public lockers; // user contracts

    event TokenRecovered(address user, uint256 amount);
    event LockerCreated(address user, address locker);
    event LockedFor(address user, uint256 amount);
    event LockedAdditionalFor(bytes32 kekId, address user, uint256 amount);
    event RewardsClaimedFor(address user, uint256[] rewardsBefore);
    event WithdrawLockedFor(address user, bytes32 kekId);
    event SetVeFXSProxy(address user, address proxy);
    event MigratorToggled(address user, address migrator);


    constructor(address _templeToken, address _lockerFactory, address _lpFarm) {
        templeToken = _templeToken;
        lockerFactory = _lockerFactory;
        lpFarm = _lpFarm;
    }

    function setVeFXSProxy(address _proxy) external onlyOwner {
        require(_proxy != address(0), "address 0");
        veFXSProxy = _proxy;
    }

    function setLockerMigrator(address _migrator) external onlyOwner {
        require(_migrator != address(0), "address 0");
        lockerMigrator = _migrator;
    }

    function recoverToken(address _token, uint256 _amount) external onlyOwner {
        if (_amount == 0) {
            _amount = IERC20(_token).balanceOf(address(this));
        }
        IERC20(_token).safeTransfer(owner(), _amount);

        emit TokenRecovered(owner(), _amount);
    }

    function createLocker() external {
        require(lockers[msg.sender] == address(0), "locker already exists for user");

        address instanceAddress = ILPLockerFactory(lockerFactory).createLocker(msg.sender);
        lockers[msg.sender] = instanceAddress;

        emit LockerCreated(msg.sender, instanceAddress);
    }

    function stakeLP(uint256 _amount, uint256 _secs) external hasLocker(msg.sender) {
        require(_amount > 0, "invalid amount");

        address locker = lockers[msg.sender];
        ILPLocker(locker).lock(_amount, _secs);
        totalLocked += _amount;

        emit LockedFor(msg.sender, _amount);
    }

    function lockAdditional(uint256 _amount, bytes32 _kekId) external hasLocker(msg.sender) {
        require(_amount > 0, "invalid amount");
        
        address locker = lockers[msg.sender];
        ILPLocker(locker).lockAddtional(_kekId, _amount);
        totalLocked += _amount;

        emit LockedAdditionalFor(_kekId, msg.sender, _amount);
    }

    function getReward(address _user) external hasLocker(_user) {
        address locker = lockers[msg.sender];
        uint256[] memory data = ILPLocker(locker).getReward();

        emit RewardsClaimedFor(_user, data);
    }

    function withdrawLocked(address _user, bytes32 _kekId) external hasLocker(_user) {
        address locker = lockers[msg.sender];
        ILPLocker(locker).withdrawLocked(_kekId);

        emit WithdrawLockedFor(_user, _kekId);
    }

    function setVeFXSProxyFor(address _user) external hasLocker(_user) {
        if (veFXSProxy != address(0)) {
            address locker = lockers[msg.sender];
            ILPLocker(locker).setVeFXSProxy(veFXSProxy);

            emit SetVeFXSProxy(_user, veFXSProxy);
        }
    }

    function toggleMigratorFor(address _user) external hasLocker(_user) {
        if (lockerMigrator != address(0)) {
            address locker = lockers[msg.sender];
            ILPLocker(locker).stakerToggleMigrator(lockerMigrator);

            emit MigratorToggled(_user, lockerMigrator);
        }
    }

    // if operation has changed from this contract
    function setOperatorFor(address _user, address _operator) external hasLocker(_user) onlyOwner {
        address locker = lockers[_user];
        ILPLocker(locker).setOperator(_operator);
    }

    // TODO: (pb) view funcs


    // modifiers
    modifier hasLocker(address _user) {
        require(lockers[_user] != address(0), "user has no locker");
        _;
    }

}