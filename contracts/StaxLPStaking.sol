pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


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
* Based on synthetix BaseRewardPool.sol & convex cvxLocker
* Modified for use by TempleDAO 
*/

contract StaxLPStaking is Ownable {

    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IERC20 public rewardToken;

    uint256 public constant DURATION = 86400 * 7;
    uint256 private _totalSupply;

    address[] public rewardTokens;

    mapping(address => uint256) private _balances;
    mapping(address => Reward) public rewardData;
    mapping(address => mapping(address => uint256)) public claimableRewards;
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => bool)) public rewardDistributors;

    struct Reward {
        uint40 periodFinish;
        uint216 rewardRate;
        uint40 lastUpdateTime;
        uint216 rewardPerTokenStored;
    }

    event RewardAdded(address token, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address rewardToken, uint256 reward);
    event UpdatedRewardManager(address oldManager, address newManager);
    event ApprovedRewardDistributor(address token, address distributor);


    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    function approveRewardDistributor(
        address _rewardsToken,
        address _distributor,
        bool _approved
    ) external onlyOwner {
        require(rewardData[_rewardsToken].lastUpdateTime > 0, "!exist");
        rewardDistributors[_rewardsToken][_distributor] = _approved;
        emit ApprovedRewardDistributor(_rewardsToken, _distributor);
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function addReward(address _rewardToken) external onlyOwner {
        require(rewardData[_rewardToken].lastUpdateTime == 0, "exists");
        rewardTokens.push(_rewardToken);
        rewardData[_rewardToken].lastUpdateTime = uint40(block.timestamp);
        rewardData[_rewardToken].periodFinish = uint40(block.timestamp);
    }

    function _rewardPerToken(address _rewardsToken) internal view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardData[_rewardsToken].rewardPerTokenStored;
        }

        return
            rewardData[_rewardsToken].rewardPerTokenStored +
            (((_lastTimeRewardApplicable(rewardData[_rewardsToken].periodFinish) -
                rewardData[_rewardsToken].lastUpdateTime) *
                rewardData[_rewardsToken].rewardRate *
                1e18) / totalSupply());
    }

    function rewardPerToken(address _rewardsToken) external view returns (uint256) {
        return _rewardPerToken(_rewardsToken);
    }

    function _earned(
        address _account,
        address _rewardsToken,
        uint256 _balance
    ) internal view returns (uint256) {
        return
            (_balance * (_rewardPerToken(_rewardsToken) - userRewardPerTokenPaid[_account][_rewardsToken])) /
            1e18 +
            claimableRewards[_account][_rewardsToken];
    }

    function stake(uint256 _amount)
        public
        updateReward(msg.sender)
        returns(bool)
    {
        require(_amount > 0, "RewardPool : Cannot stake 0");
        
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

        _totalSupply += _amount;
        _balances[msg.sender] += _amount;

        emit Staked(msg.sender, _amount);

        return true;
    }

    function stakeAll() external {
        uint256 balance = stakingToken.balanceOf(msg.sender);
        stake(balance);
    }

    function stakeFor(address _for, uint256 _amount)
        public
        updateReward(_for)
    {
        require(_amount > 0, "RewardPool : Cannot stake 0");
        // pull tokens
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

        //give to _for
        _totalSupply += _amount;
        _balances[_for] += _amount;

        emit Staked(_for, _amount);
    }

    function withdraw(uint256 amount, bool claim)
        public
        updateReward(msg.sender)
    {
        require(amount > 0, "RewardPool : Cannot withdraw 0");

        _totalSupply -= amount;
        _balances[msg.sender] -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
     
        if (claim) {
            // can call internal because user reward already updated
            _getRewards(msg.sender);
        }
    }

    function withdrawAll(bool claim) external{
        withdraw(_balances[msg.sender], claim);
    }

    function getRewards(address _account) public updateReward(_account) {
        _getRewards(_account);
    }

    // @dev internal function. make sure to call only after updateReward(account)
    function _getRewards(address _account) internal {
        for (uint256 i; i < rewardTokens.length; i++) {
            address _rewardToken = rewardTokens[i];
            uint256 claimable = claimableRewards[_account][_rewardToken];
            if (claimable > 0) {
                claimableRewards[_account][_rewardToken] = 0;
                IERC20(_rewardToken).safeTransfer(_account, claimable);
                emit RewardPaid(_account, _rewardToken, claimable);
            }
        }
    }

    function getReward(address _account, address _rewardToken) external updateReward(_account) {
        _getReward(_account, _rewardToken);
    }

    function _getReward(address _account, address _rewardToken) internal {
        uint256 amount = claimableRewards[_account][_rewardToken];
        if (amount > 0) {
            claimableRewards[_account][_rewardToken] = 0;
            IERC20(_rewardToken).safeTransfer(_account, amount);

            emit RewardPaid(_account, _rewardToken, amount);
        }
    }

    function _lastTimeRewardApplicable(uint256 _finishTime) internal view returns (uint256) {
        if (_finishTime < block.timestamp) {
            return _finishTime;
        }
        return block.timestamp;
    }

    function _notifyReward(address _rewardsToken, uint256 _amount) internal {
        Reward storage rdata = rewardData[_rewardsToken];

        if (block.timestamp >= rdata.periodFinish) {
            rdata.rewardRate = uint216(_amount / DURATION);
        } else {
            uint256 remaining = uint256(rdata.periodFinish) - block.timestamp;
            uint256 leftover = remaining * rdata.rewardRate;
            rdata.rewardRate = uint216((_amount + leftover) / DURATION);
        }

        rdata.lastUpdateTime = uint40(block.timestamp);
        rdata.periodFinish = uint40(block.timestamp + DURATION);
    }

    function notifyRewardAmount(
        address _rewardsToken,
        uint256 _amount
    ) external updateReward(address(0)) {
        require(rewardDistributors[_rewardsToken][msg.sender] == true, "not distributor");
        require(_amount > 0, "No reward");

        _notifyReward(_rewardsToken, _amount);

        IERC20(_rewardsToken).safeTransferFrom(msg.sender, address(this), _amount);

        emit RewardAdded(_rewardsToken, _amount);
    }


    modifier updateReward(address _account) {
        {
            // stack too deep
            for (uint256 i = 0; i < rewardTokens.length; i++) {
                address token = rewardTokens[i];
                rewardData[token].rewardPerTokenStored = uint216(_rewardPerToken(token));
                rewardData[token].lastUpdateTime = uint40(_lastTimeRewardApplicable(rewardData[token].periodFinish));
                if (_account != address(0)) {
                    claimableRewards[_account][token] = _earned(_account, token, _balances[_account]);
                    userRewardPerTokenPaid[_account][token] = uint256(rewardData[token].rewardPerTokenStored);
                }
            }
        }
        _;
    }
}
