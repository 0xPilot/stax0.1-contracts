pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUnifiedFarm {
    function stakeLocked(uint256 liquidity, uint256 secs) external;
    function getReward(address destination_address) external returns (uint256[] memory);
    function withdrawLocked(bytes32 kek_id, address destination_address) external;
}


// avoid lots of reading and calculations here to save gas. 
// stax contract does reads on behalf of this contract as stax contract stores mapping(user => lockerContract) address.
// most view functions will also be delegated to stax contract
contract LPLocker {

    address public factory;
    address public user;
    address public operator; // stax contract
    address public lpFarm = 0x10460d02226d6ef7B2419aE150E6377BdbB7Ef16; // TEMPLE/FRAX LP farm.
    address public lpToken; // TEMPLE/FRAX LP

    bool private isInitialized;

    // TODO: (pb) events

    function init(address _user, address _operator) external {
        require(!isInitialized, "already initialized");

        isInitialized = true;
        user = _user;
        factory = msg.sender;
        operator = _operator;
    }

    // TODO: (pb) set lp farm in case of migration
    function setLPFarm() external {
        require(msg.sender == operator, "only operator");

    }

    // TODO: (pb) lock liquidity for user
    // maybe allow user to also directly lock and account for logic in main stax contract????????
    function lock(uint256 _liquidity, uint256 _secs) external {
        require(msg.sender == operator, "only operator");
        // safeIncreaseAllowance
        IUnifiedFarm(lpFarm).stakeLocked(_liquidity, _secs);
    }

    // TODO: (pb) lock additional liquidity for user
    // safeTransfer liqudiity directly to contract from user. 2 transfers compared to if transfer came from stax
    function lockAddtional(bytes32 _kekId, uint256 _liquidity) external {
        require(msg.sender == operator, "only operator");
        // safeIncreaseAllowance
    }

    // withdraw and send directly to user to save gas
    function withdrawLocked(bytes32 _kekId) external {
        require(msg.sender == operator, "only operator");
        IUnifiedFarm(lpFarm).withdrawLocked(_kekId, user);
    }

    // get reward. should user be allowed to call this? can user game if so? TODO: (pb) check with stax logic
    // send reward directly to user to save gas on extra transfer
    function getReward() external returns (uint256[] memory data) {
        require(msg.sender == operator, "only operator");
        data = IUnifiedFarm(lpFarm).getReward(user);
    }

    function migrate() external {
        // TODO: (pb)
    }
}