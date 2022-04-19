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

    uint256 public totalLocked; // keep track of total locked lp tokens
    mapping(address => address) public lockers; // user contracts

    event TokenRecovered(address user, uint256 amount);

    constructor(address _templeToken, address _lockerFactory, address _lpFarm) {
        templeToken = _templeToken;
        lockerFactory = _lockerFactory;
        lpFarm = _lpFarm;
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
    }

    function stakeLP(uint256 _amount, uint256 _secs) external hasLocker(msg.sender) {
        require(_amount > 0, "invalid amount");

        address locker = lockers[msg.sender];
        ILPLocker(locker).lock(_amount, _secs);
        totalLocked += _amount;
    }

    function lockAdditional(uint256 _amount, bytes32 _kekId) external hasLocker(msg.sender) {
        require(_amount > 0, "invalid amount");
        
        address locker = lockers[msg.sender];
        ILPLocker(locker).lockAddtional(_kekId, _amount);
        totalLocked += _amount;
    }

    // function to get kekId of a staker
    // needed because equivalent lp farm function is internal
    /*function getUserKekId(address _user) external view returns (bytes32 kekId) {
        address locker = lockers[_user];
        if (locker != address(0)) {
            IUnifiedFarm.LockedStake[] memory lockedStakes = IUnifiedFarm(lpFarm).lockedStakes(_user);

        }
    }*/

    // TODO: (pb) temple rewards logic






    ///////// modifiers /////////
    modifier hasLocker(address _user) {
        require(lockers[_user] != address(0), "user has no locker");
        _;
    }

}