// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IGovernorMinimal {
    function descriptor() external view returns (address);
    function votingToken() external view returns (address);
    function reserve() external view returns (address);
    function quorumBps() external view returns (uint256);
    function owner() external view returns (address);
}

