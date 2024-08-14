// SPDX-License-Identifier: GPL-3.0

/// @title An interface for Plutocats Token

pragma solidity >=0.8.0;

interface IPlutocatsTokenMultibuy {
    function getPrice() external view returns (uint256);
    function mint() external payable returns (uint256);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getVRGDAPrice(int256 timeSinceStart, uint256 sold) external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function MINT_START() external view returns (uint256);

    function adjustedTotalSupply() external view returns (uint256);
    function totalSupply() external view returns (uint256);

    function setApprovalForAll(address operator, bool approved) external;
}
