// SPDX-License-Identifier: GPL-3.0

/// @title ReserveGovernorV2
/// @notice A new governor contract with the singular purpose of upgrading the Plutocats Reserve to V2
/// @author strangeruff.eth | @sreyeMnayR
/// @dev DAO PROPOSAL: If passed, this proposal will:
///         1. Assign ownership of the PlutoCats, Reserve, and Descriptor smart contracts to ReserveGovernorV2.
///         2. Allow the Reserve to upgrade to v2, which adds the following functionality:
///             a. Adds a new `depositRoyalties()` public function which withdraws Blur/WETH royalties
///             b. Adds a new `withdrawEthFrom(address)` function that can only be called by the owner,
///                 allowing the unwrapping of ETH from any future royalty contract.
///             c. Pays a one-time bounty of 3 ETH to the developer of the upgraded Governor and Reserve contracts.

pragma solidity >=0.8.0;

import {IBootstrapV2} from "../interfaces/IBootstrapV2.sol";
import {IUpgradeableReserve} from "../interfaces/IUpgradeable.sol";
import {IGovernorMinimal} from "../interfaces/IGovernorMinimal.sol";
import {ReserveGovernor} from "./ReserveGovernor.sol";
import {IReserveV2} from "../interfaces/IReserveV2.sol";

contract ReserveGovernorV2 is IBootstrapV2, ReserveGovernor {
    // Make immutable for posterity
    address public immutable RESERVE_IMPLEMENTATION_ADDRESS;
    address public immutable BLUR_POOL_ADDRESS;
    address public immutable WETH_ADDRESS;
    bool public upgraded;

    constructor(
        address _oldGovernor,
        address _newReserveImplementation,
        address _blurPoolAddress,
        address _wethAddress
    )
        ReserveGovernor(
            IGovernorMinimal(_oldGovernor).votingToken(),
            IGovernorMinimal(_oldGovernor).descriptor(),
            IGovernorMinimal(_oldGovernor).reserve(),
            IGovernorMinimal(_oldGovernor).quorumBps()
        )
    {
        // ownership of this contract remains the same as the governor it replaces, regardless of who deployed it
        transferOwnership(IGovernorMinimal(_oldGovernor).owner());
        RESERVE_IMPLEMENTATION_ADDRESS = _newReserveImplementation;
        BLUR_POOL_ADDRESS = _blurPoolAddress;
        WETH_ADDRESS = _wethAddress;
    }

    // Allows governor owner to trigger a withdrawal of wrapped ETH from any arbitrary contract address
    function withdrawEthFrom(address withdrawable) public onlyOwner {
        IReserveV2(address(reserve)).withdrawEthFrom(withdrawable);
    }

    // Performs upgrade on the reserve contract. 
    // Note: The fact that we can do this is a bit of a problem,
    // as it allows each/any approved governor to upgrade the reserve contract to a new implementation.
    // If the approved proposer is also a majority (or at least majority of active) holder, they
    // could potentially exploit this to their advantage (worst case: totally empty the reserve).
    // This could be mitigated by freezing the upgradability of a PlutocatsReserve contract.
    function doUpgrade() external {
        if (upgraded) {
            revert AlreadyUpgraded();
        }
        upgraded = true;
        IUpgradeableReserve(address(reserve)).upgradeToAndCall(
            RESERVE_IMPLEMENTATION_ADDRESS,
            abi.encodeWithSignature(
                "initializeV2(address,address)",
                BLUR_POOL_ADDRESS,
                WETH_ADDRESS
            )
        );
    }
}
