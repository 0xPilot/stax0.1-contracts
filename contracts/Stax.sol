pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/access/Ownable.sol";

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


// v0.1 of stax contracts
// a contract mostly targeted at:
//  -- users with TEMPLE/FRAX LP (possibly without veFXS) who want to earn extra temple rewards
// 
contract Stax is Ownable {

    address public lockerFactory; // factory to create user lp locker contracts
    address public templeToken; // reward token

    uint256 public totalLocked; // keep track of total locked lp tokens
    mapping(address => address) public lockers; // user contracts

    // TODO: events

    constructor(address _templeToken) {
        templeToken = _templeToken;
    }

    function recoverToken(address _token) external onlyOwner {

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
    }



    // TODO: (pb) temple rewards logic






    ///////// modifiers /////////
    modifier hasLocker(address _user) {
        require(lockers[_user] != address(0), "user has no locker");
        _;
    }

}