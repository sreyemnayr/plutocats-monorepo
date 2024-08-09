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
    address public constant FOUNDERS_ADDRESS = 0xec740561f99D0cF6EeCb9f7A84Cf35394425f63b;
    uint256 public constant FOUNDERS_SHARE_BPS = 5000;
    address public constant DEV_ADDRESS = 0x3D2198fC3907e9D095c2D973D7EC3f42B7C62Dfc;
    uint256 public constant DEV_BOUNTY = 3 ether;

    constructor() PlutocatsReserve() {
        _disableInitializers();
    }

    function initializeV2(address _blurPoolAddress, address _wethAddress)
        public
        reinitializer(2) 
    {
        blurPoolAddress = _blurPoolAddress;
        wethAddress = _wethAddress;
        depositRoyalties();
        _sendETHInternal(payable(DEV_ADDRESS), DEV_BOUNTY);
    }

    function _withdrawEth(address withdrawable) internal {
        uint256 balance = IWithdrawableEther(withdrawable).balanceOf(address(this));
        if (balance > 0) {
            IWithdrawableEther(withdrawable).withdraw(balance);
        }
    }

    /// @notice Claims royalties from BLUR_POOL and WETH contracts and sends a portion to the founders' address.
    /// @dev Withdraws available ETH from both BLUR_POOL and WETH contracts, calculates the founders' share, and transfers it.
    /// This function calculates the difference in balance before and after claiming to determine the amount gained.
    /// It then calculates 50% of this amount to send to the founders' address.
    function depositRoyalties() public {
        // Get current balance
        uint256 balance = address(this).balance;

        // Withdraw royalties from blur pool
        _withdrawEth(blurPoolAddress);
        
        // Get new balance
        uint256 newBalance = address(this).balance;

        // If there's a difference, send 50% of blur royalties to founders
        if (newBalance > balance) {
            uint256 diff = newBalance - balance;
            uint256 foundersShare = diff * FOUNDERS_SHARE_BPS / 10000;
            _sendETHInternal(payable(FOUNDERS_ADDRESS), foundersShare);
        }

        // Withdraw royalties from weth
        _withdrawEth(wethAddress);
    }
}

