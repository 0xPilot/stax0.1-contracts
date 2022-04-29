pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IStaxStaking {
    function notifyRewardAmount(address token, uint256 reward) external;
    function periodFinish() external view returns (uint256);
}

interface ILPLocker {
    function harvestRewards() external;
}

contract RewardsManager is Ownable {

    using SafeERC20 for IERC20;

    address public staking;
    address public lpLocker;

    event RewardDistributed(address staking, address token, uint256 amount);
    event ExtraRewardTokenTransferred(address to, address token, uint256 amount);

    constructor(
        address _staking,
        address _lpLocker
    ) {
        staking = _staking;
        lpLocker = _lpLocker;
    }

    function distribute(address _token) external onlyOwner {
        _distribute(_token);
    }

    function _distribute(address _token) internal {
        require(block.timestamp > IStaxStaking(staking).periodFinish(), "last reward duration not finished");
        _notifyRewardsAmount(_token, IERC20(_token).balanceOf(address(this)));
    }

    /// @dev notify staking contract about new rewards
    function _notifyRewardsAmount(address _token, uint256 _amount) internal {
        IERC20(_token).safeIncreaseAllowance(staking, _amount);
        IStaxStaking(staking).notifyRewardAmount(_token, _amount);

        emit RewardDistributed(staking, _token, _amount);
    }
}