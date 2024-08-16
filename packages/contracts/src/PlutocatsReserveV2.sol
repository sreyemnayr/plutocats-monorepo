// SPDX-License-Identifier: GPL-3.0

/// @title Upgraded Plutocats Reserve; Supports UUPS upgrades
/// @dev Adds functionality to claim from WETH and Blur Pool (royalties)
/// @author strangeruff.eth / @sreyeMnayR

pragma solidity >=0.8.0;

import {PlutocatsReserve} from "./PlutocatsReserve.sol";
import {IWithdrawableEther} from "./interfaces/IWithdrawableEther.sol";

contract PlutocatsReserveV2 is PlutocatsReserve {
    address public blurPoolAddress; // = 0xB772d5C5F4A2Eef67dfbc89AA658D2711341b8E5;
    address public wethAddress; // = 0x4300000000000000000000000000000000000004;
    address public constant DEV_ADDRESS = 0x3D2198fC3907e9D095c2D973D7EC3f42B7C62Dfc;
    uint256 public constant DEV_BOUNTY = 4 ether;

    /// @notice Constructor for the PlutocatsReserveV2 contract.
    /// @dev Calls the constructor of the parent PlutocatsReserve contract and disables initializers.
    constructor() PlutocatsReserve() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with new addresses for Blur Pool and WETH, deposits initial royalties, and sends a bounty to the developer.
    /// @param _blurPoolAddress The address of the Blur Pool contract.
    /// @param _wethAddress The address of the WETH contract.
    /// @dev Calls depositRoyalties to handle initial royalty deposits and sends a fixed bounty to the developer's address.
    function initializeV2(address _blurPoolAddress, address _wethAddress)
        public
        reinitializer(2) 
    {
        blurPoolAddress = _blurPoolAddress;
        wethAddress = _wethAddress;
        depositRoyalties();
        _sendETHInternal(payable(DEV_ADDRESS), DEV_BOUNTY);
    }

    /// @dev Withdraws all available ETH from a specified contract that implements IWithdrawableEther.
    /// @param withdrawable The address of the contract from which to withdraw ETH.
    /// @notice This function will attempt to withdraw all ETH held by the contract at the address provided.
    function _withdrawEthFrom(address withdrawable) internal {
        uint256 balance = IWithdrawableEther(withdrawable).balanceOf(address(this));
        if (balance > 0) {
            IWithdrawableEther(withdrawable).withdraw(balance);
        }
    }

    /// @notice Claims royalties from BLUR_POOL and WETH contracts and sends a portion to the founders' address.
    /// @dev Withdraws available ETH from both BLUR_POOL and WETH contracts
    function depositRoyalties() public {
        // Withdraw royalties from blur pool
        _withdrawEthFrom(blurPoolAddress);
        // Withdraw royalties from WETH pool
        _withdrawEthFrom(wethAddress);
    }

    /// @notice Calculates the total royalties available for withdrawal from both BLUR_POOL and WETH contracts.
    /// @return The total amount of ETH available for withdrawal, summed from both contracts.
    function royaltiesAvailableForWithdrawal() public view returns (uint256) {
        return IWithdrawableEther(blurPoolAddress).balanceOf(address(this)) + IWithdrawableEther(wethAddress).balanceOf(address(this));
    }
}

