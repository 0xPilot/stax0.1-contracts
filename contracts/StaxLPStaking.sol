pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


interface ILockerProxy {
    function lock(address _user, uint256 _liquidity) external returns (uint256);
}


contract StaxLPStaking is Ownable {


    address public stakingToken;
    
    address[] public rewardTokens;
    mapping(address => bool) public rewardDistributors;
    mapping(address => uint256) public userRewards;

    // TODO: init
    constructor() {

    }

    // TODO: (pb) staking
    function stakeFor(address _user, uint256 _amount) external {

    }

    function stake() external {

    }

    function lastTimeRewardApplicable() public view returns (uint64) {

    }

    function rewardPerToken() public view returns (uint128) {
        
    }

    function earned(address account) public view returns (uint128) {

    }


    function addReward() external onlyRewardDistributor {
        
    }




    ////////// modifiers

    modifier updateReward() {

    }

    modifier onlyRewardDistributor() {

    }
}