pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/proxy/Clones.sol";


interface ILPLocker {
    function init(address, address, address, address) external;
}

contract LPLockerFactory {
    /** @notice Address of deployed locker implementation instance */
    address public implementation;
    address public operator;
    address public lpFarm;
    address public lpToken;

    /** @notice Emits locker address */
    event LockerCreated(address user, address locker);

    constructor(address _operator, address _implementation, address _lpFarm, address _lpToken) {
        operator = _operator;
        implementation = _implementation;
        lpFarm = _lpFarm;
        lpToken = _lpToken;
    }

    function setOperator(address _operator) external {
        require(msg.sender == operator, "only operator");
        require(_operator != address(0), "address 0");
        operator = _operator;
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
        ILPLocker(instance).init(_user, operator, lpFarm, lpToken);
        emit LockerCreated(_user, instance);

        return instance;
    }
}