pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IRewardsManager {
    function distribute(address _token) external;
}

interface IRewardToken {
    function mint(address _to, uint256 _amount) external;
}

contract RewardsOps {

    IRewardsManager public rewardsManager;
    address[] public rewardTokens;

    uint120 public constant MINT_AMOUNT = 10000 * 1e18;
    constructor(
        address _rewardsmanager,
        address[] memory _rewardTokens
    ) {
        rewardsManager = IRewardsManager(_rewardsmanager);
        rewardTokens = _rewardTokens;
    }

    // set contract as owner of rewardsManager
    // added as minter for reward tokens so can distribute
    function distribute() external {
        for (uint i=0; i<rewardTokens.length; i++) {
            IRewardToken(rewardTokens[i]).mint(address(rewardsManager), MINT_AMOUNT);
            rewardsManager.distribute(rewardTokens[i]);
        }
    }
}