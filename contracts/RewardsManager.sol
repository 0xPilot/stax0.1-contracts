pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IStaxStaking {
    function notifyRewardAmount(address token, uint256 reward) external;
    function rewardPeriodFinish(address _token) external view returns (uint40);
}

contract RewardsManager is Ownable {

    using SafeERC20 for IERC20;

    IStaxStaking public staking;

    event RewardDistributed(address staking, address token, uint256 amount);

    constructor(
        address _staking
    ) {
        staking = IStaxStaking(_staking);
    }

    function distribute(address _token) external onlyOwner {
        require(block.timestamp > staking.rewardPeriodFinish(_token), "last reward duration not finished");
        _notifyRewardsAmount(_token, IERC20(_token).balanceOf(address(this)));
    }

    /// @dev notify staking contract about new rewards
    function _notifyRewardsAmount(address _token, uint256 _amount) internal {
        IERC20(_token).safeIncreaseAllowance(address(staking), _amount);
        staking.notifyRewardAmount(_token, _amount);

        emit RewardDistributed(address(staking), _token, _amount);
    }
}