// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IWithdrawableEther {
    function balanceOf(address user) external view returns (uint256);
    function withdraw(uint256 amount) external;
}