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
    //address public rewardToken; // main reward token for staking
    address public operator;
    address public lpLocker;
    
    address[] public rewardTokens;
    mapping(address => bool) public isRewardToken; // to check if token is reward token as distribution of tokens don't happen at the same time

    event RewardDistributed(address staking, address token, uint256 amount);
    event ExtraRewardTokenTransferred(address to, address token, uint256 amount);

    constructor(
        address _staking,
        address _lpLocker,
        address[] memory _rewardTokens
    ) {
        staking = _staking;
        lpLocker = _lpLocker;
        operator = msg.sender;

        for (uint i=0; i<_rewardTokens.length; i++) {
            rewardTokens.push(_rewardTokens[i]);
            isRewardToken[_rewardTokens[i]] = true;
        }
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    /**
     * @dev harvest rewards for locking contract
     * @param _shouldDistribute whether to distribute harvested tokens or not
     */
    function harvest(bool _shouldDistribute) external onlyOperator {
        // @dev there's no notion of harvest interval here so operator is assumed to know when to harvest
        ILPLocker(lpLocker).harvestRewards();
        //if (_shouldDistribute) {
        //    _distribute();
        //}
    }

    function swapTokenForxLP(address _token, bool _burnTokens) external onlyOperator {
        // TODO: (pb) implementation depends on kind of liquidity pool we have
    }

    // swap claimed rewards to temple
    /*function swapFXSToRewardToken(bool _shouldDistribute, address[] calldata _targets, bytes[] calldata _data) external onlyOperator {
        bool success;
        for (uint i=0; i<_targets.length; i++) {
            (success,) = _targets[i].call{value:0}(_data[i]);
            require(success, "failed");
        }
        if (_shouldDistribute) {
            _distribute();
        }
    }*/

    function distribute(address _token) external onlyOperator {
        require(isRewardToken[_token], "not reward token");
        _distribute(_token);
    }

    function _distribute(address _token) internal {
        require(block.timestamp > IStaxStaking(staking).periodFinish(), "last reward duration not finished");
        _notifyRewardsAmount(_token, IERC20(_token).balanceOf(address(this)));
    }

    // @dev transfer extra reward token to extra reward contract in the event rewards were previously liquidated into another token
    function transferExtraRewardToken(address _token, address _to) external onlyOperator {
        require(!isRewardToken[_token], "not extra reward");
        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, amount);

        emit ExtraRewardTokenTransferred(_to, _token, amount);
    }

    // @dev notify staking contract about new rewards
    function _notifyRewardsAmount(address _token, uint256 _amount) internal {
        IERC20(_token).safeIncreaseAllowance(staking, _amount);
        IStaxStaking(staking).notifyRewardAmount(_token, _amount);

        emit RewardDistributed(staking, _token, _amount);
    }


    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }
}