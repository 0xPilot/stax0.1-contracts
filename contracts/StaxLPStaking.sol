pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IStaxLPToken {
    function mint(address _to, uint256 _amount) external;
    function burn(address _account, uint256 _amount) external;
    function balanceOf(address _account) external;
}

interface IRewards{
    function stake(address, uint256) external;
    function stakeFor(address, uint256) external;
    function withdraw(address, uint256) external;
    function exit(address) external;
    function getReward(address) external;
    function queueNewRewards(uint256) external;
    function notifyRewardAmount(uint256) external;
    function addExtraReward(address) external;
    function stakingToken() external returns (address);
}

/**
* Based on synthetix BaseRewardPool.sol
* Modified for use by TempleDAO 
*/

contract StaxLPStaking is Ownable {

    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IStaxLPToken public staxLPToken;
    IERC20 public rewardToken;

    address public operator;
    address public rewardManager;

    uint256 public constant DURATION = 86400 * 7;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public currentRewards = 0;
    uint256 public historicalRewards = 0;
    uint256 private _totalSupply;

    address[] public extraRewards;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event UpdatedRewardManager(address oldManager, address newManager);
    

    constructor(address _stakingToken, address _staxLPToken, address _rewardToken, address _rewardManager) {
        stakingToken = IERC20(_stakingToken);
        staxLPToken = IStaxLPToken(_staxLPToken);
        rewardToken = IERC20(_rewardToken);
        rewardManager = _rewardManager;
    }

    function setRewardManager(address _rewardManager) external onlyOwner {
        require(_rewardManager != address(0), "invalid address");
        address old = rewardManager;
        rewardManager = _rewardManager;
        emit UpdatedRewardManager(old, _rewardManager);
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function extraRewardsLength() external view returns (uint256) {
        return extraRewards.length;
    }

    function addExtraReward(address _reward) external returns (bool) {
        require(msg.sender == rewardManager, "!authorized");
        require(_reward != address(0),"!reward setting");

        extraRewards.push(_reward);
        return true;
    }

    function clearExtraRewards() external{
        require(msg.sender == rewardManager, "!authorized");
        delete extraRewards;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        if (periodFinish < block.timestamp) {
            return periodFinish;
        } else {
            return block.timestamp;
        }
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardPerTokenStored;
        }

        return rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalSupply());
    }

    function earned(address account) public view returns (uint256) {
        return (balanceOf(account) * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18) + rewards[account];
    }

    function stake(uint256 _amount)
        public
        updateReward(msg.sender)
        returns(bool)
    {
        require(_amount > 0, "RewardPool : Cannot stake 0");
        
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        //also stake to linked rewards
        if (extraRewards.length > 0) {
            for(uint i=0; i < extraRewards.length; i++){
                IRewards(extraRewards[i]).stake(msg.sender, _amount);
            }
        }

        _totalSupply += _amount;
        _balances[msg.sender] += _amount;

        emit Staked(msg.sender, _amount);

        return true;
    }

    function stakeAll() external returns(bool){
        uint256 balance = stakingToken.balanceOf(msg.sender);
        stake(balance);
        return true;
    }

    function stakeFor(address _for, uint256 _amount)
        public
        updateReward(_for)
        returns(bool)
    {
        require(_amount > 0, "RewardPool : Cannot stake 0");
        // pull tokens
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        //also stake to linked rewards
        if (extraRewards.length > 0) {
            for(uint i=0; i < extraRewards.length; i++){
                IRewards(extraRewards[i]).stake(_for, _amount);
            }
        }

        //give to _for
        _totalSupply += _amount;
        _balances[_for] += _amount;

        emit Staked(_for, _amount);
        
        return true;
    }

    function withdraw(uint256 amount, bool claim)
        public
        updateReward(msg.sender)
        returns(bool)
    {
        require(amount > 0, "RewardPool : Cannot withdraw 0");

        //also withdraw from linked rewards
        if (extraRewards.length > 0) {
            for(uint i=0; i < extraRewards.length; i++){
                IRewards(extraRewards[i]).withdraw(msg.sender, amount);
            }
        }

        _totalSupply -= amount;
        _balances[msg.sender] -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
     
        if(claim){
            getReward(msg.sender,true);
        }

        return true;
    }

    function withdrawAll(bool claim) external{
        withdraw(_balances[msg.sender], claim);
    }

    function getReward(address _account, bool _claimExtras) public updateReward(_account) returns(bool){
        uint256 reward = earned(_account);
        if (reward > 0) {
            rewards[_account] = 0;
            rewardToken.safeTransfer(_account, reward);
            emit RewardPaid(_account, reward);
        }

        //also get rewards from linked rewards
        if(_claimExtras){
            for(uint i=0; i < extraRewards.length; i++){
                IRewards(extraRewards[i]).getReward(_account);
            }
        }
        return true;
    }

    function getReward() external returns(bool){
        getReward(msg.sender,true);
        return true;
    }

    function notifyRewardAmount(uint256 reward)
        external
        updateReward(address(0))
        onlyOwnerOrRewardManager
    {
        require(reward > 0, "invalid reward amount");

        historicalRewards += reward;
        if (block.timestamp >= periodFinish) {
            rewardRate = reward/DURATION;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            reward += leftover;
            rewardRate = reward/DURATION;
        }
        currentRewards = reward;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + DURATION;
        emit RewardAdded(reward);
    }


    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier onlyOwnerOrRewardManager() {
        require(msg.sender == owner() || msg.sender == rewardManager, "only owner or rewards manager");
        _;
    }

}
