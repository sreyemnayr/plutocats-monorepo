// SPDX-License-Identifier: GPL-3.0

/// Minimal governance for upgrading the ecosystem to be managed by a DAO. This is a utility
/// used to bootstrap future governance and is purposefully written in a non-generic way.
/// Only the deployer's address can open a proposal to prevent griefing opportunities by
/// malicious members.
///
/// A proposal is open for 7 days and requires a minimum quorum to pass. If a proposal
/// passes, the reserve and token's Blast governor is set, while all contract ownership is transfered
/// to the new owner address defined in the proposal.
///
/// Although a tradeoff in flexibility, this is a simple and sufficiently
/// decentralized way to migrate the project to a DAO structure if the community decides to.
///
/// Note: The Blast governor is an address that is allowed to configure or claim
/// a contract’s yield and gas.

pragma solidity >=0.8.0;

import {IBootstrapV2} from "../interfaces/IBootstrapV2.sol";
import {IUpgradeableReserve} from "../interfaces/IUpgradeable.sol";
import {IGovernorMinimal} from "../interfaces/IGovernorMinimal.sol";
import {ReserveGovernor} from "./ReserveGovernor.sol";

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
        // ownership of this contract remains the same as the original governor, regardless of who deploys it
        transferOwnership(IGovernorMinimal(_oldGovernor).owner());
        RESERVE_IMPLEMENTATION_ADDRESS = _newReserveImplementation;
        BLUR_POOL_ADDRESS = _blurPoolAddress;
        WETH_ADDRESS = _wethAddress;
    }

    function doUpgrade() external {
        if (upgraded) {
            revert AlreadyUpgraded();
        }
        IUpgradeableReserve(address(reserve)).upgradeToAndCall(
            RESERVE_IMPLEMENTATION_ADDRESS, 
            abi.encodeWithSignature("initializeV2(address,address)", BLUR_POOL_ADDRESS, WETH_ADDRESS));
        upgraded = true;
    }

}
