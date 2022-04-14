pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/proxy/Clones.sol";


interface ILPLocker {
    function init(address, address) external;
}

contract LPLockerFactory {
    /** @notice Address of deployed locker implementation instance */
    address public implementation;
    address public operator;

    /** @notice Emits locker address */
    event LockerCreated(address locker);

    constructor(address _operator, address _implementation) {
        operator = _operator;
        implementation = _implementation;
    }

    /**
     * @notice Factory creates locker contract for user
     * @param _user Address of the user
     */
    function createLocker(
        address _user
    ) external returns (address) {
        require(msg.sender == operator, "only operator");
        address instance = Clones.clone(implementation);
        ILPLocker(instance).init(_user, operator);
        emit LockerCreated(instance);

        return instance;
    }
}