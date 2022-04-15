pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUnifiedFarm {
    function stakeLocked(uint256 liquidity, uint256 secs) external;
    function getReward(address destination_address) external returns (uint256[] memory);
    function withdrawLocked(bytes32 kek_id, address destination_address) external;
}

// TODO: (pb) investigate using an upgradeable proxy for future upgrades || or a way to migrate
// locks for max time i.e. 3 years
// checkpoint done by keeper periodically (eg. daily) to harvest rewards so users can claim
contract LockerProxy is Ownable {

    address public lpFarm;
    address public operator;
    address public keeper;

    uint256 public lpReserve; // buffer lp in contract to use for xLP/LP pool aka 10% of every lock
    uint256 public constant MAX_LOCK_TIME = 3 * 365 * 86400; // 3 years
    uint256 public immutable lockMultiplier;
    mapping(address => LockedStake[]) userLockStates; // TODO: use farm values or track here differentyl? could there be overlaps? as in 2 different user locks get same kek_id?

    struct LockedStake {
        uint128 startTime;
        uint128 endTime;
        uint256 liqudiity;
    }

    // TODO: init vars
    constructor() {
        // TODO: init lockMultiplier for fixed 3 years
    }

    function lock(address _user, uint256 _liquidity) external returns (uint256) {
        require(msg.sender == operator, "only operator");
        // TODO: pull funds to contract
        // TODO: calculate how much liquidity to stake 90%
        // safeIncreaseAllowance
        IUnifiedFarm(lpFarm).stakeLocked(_liquidity, MAX_LOCK_TIME);
        // add to user locks
        userLockStates[_user].push(LockedStake({
            startTime: block.timestamp,
            endTime: block.timestamp + MAX_LOCK_TIME
            //liqudity: 
            //lockMultiplier:
        }));
        // TODO: reserve tokens for xLP/LP pool
        // lpReserve +=
    }

    /*function _lockMultiplier(uint256 _secs) internal view returns (uint256) {
        // TODO: (pb)
        return Math.min(
            lock_max_multiplier,
            uint256(MULTIPLIER_PRECISION) + (
                (secs * (lock_max_multiplier - MULTIPLIER_PRECISION)) / lock_time_for_max_multiplier
            )
        );
    }*/

    // harvest rewards
    // TODO:
    function checkpoint() external onlyOperatorOrKeeper {
        
    }

    // add liquidity to xLP/LP pool
    // TODO: add liquidity to pool
    function addLiquidity() external onlyOperatorOrKeeper {
    

    // lpReserve -= 
    }


    ////////////////// modifier
    modifier onlyOperatorOrKeeper() {
        require(msg.sender == keeper || msg.sender == operator, "only keeper or operator");
        _;
    }

}