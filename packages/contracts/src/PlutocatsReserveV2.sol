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

    error NotImplemented();

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

    function _withdrawEthFrom(address withdrawable) internal {
        uint256 balance = IWithdrawableEther(withdrawable).balanceOf(address(this));
        if (balance > 0) {
            IWithdrawableEther(withdrawable).withdraw(balance);
        }
    }

    // Withdraw ETH from a contract that implements IWithdrawableEther
    // (has balanceOf(address) and withdraw(uint256) methods)
    function withdrawEthFrom(address /* withdrawable */) external view onlyOwner {
        revert NotImplemented();
        // _withdrawEthFrom(withdrawable);
    }

    /// @notice Claims royalties from BLUR_POOL and WETH contracts and sends a portion to the founders' address.
    /// @dev Withdraws available ETH from both BLUR_POOL and WETH contracts
    function depositRoyalties() public {
        // Withdraw royalties from blur pool
        _withdrawEthFrom(blurPoolAddress);
        // Withdraw royalties from WETH pool
        _withdrawEthFrom(wethAddress);
    }

    function royaltiesAvailableForWithdrawal() public view returns (uint256) {
        return IWithdrawableEther(blurPoolAddress).balanceOf(address(this)) + IWithdrawableEther(wethAddress).balanceOf(address(this));
    }
}

