// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import {IWithdrawableEther} from "../interfaces/IWithdrawableEther.sol";

/*
    This is super simple mock that allows us to deposit and withdraw ether.
    It's used for testing the ReserveGovernorV2 contract.
    It's not meant to be used in production.
    It's not remotely secure.
    It's not remotely safe.
    It's not remotely useful.
    It's only useful for testing the ReserveGovernorV2 contract.
*/

contract MockWithdrawable is IWithdrawableEther {
    mapping(address => uint256) public balances;
    error ETHTransferFailed();
    constructor() {}
    function withdraw(uint256 amount) external {
        _withdraw(msg.sender, amount);
    }
    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }
    function deposit() public payable {
        _deposit(msg.sender, msg.value);
    }
    function deposit(address to) public payable {
        _deposit(to, msg.value);
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function _deposit(address to, uint256 amount) internal {
        balances[to] += amount;
    }
    function _withdraw(address account, uint256 wad) internal {
        balances[account] -= wad;
        (bool success,) = account.call{value: wad}("");
        if (!success) revert ETHTransferFailed();
    }
}

