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
///             c. Pays a one-time bounty of 4 ETH to the developer of the upgraded Governor and Reserve contracts.

pragma solidity >=0.8.0;

import {IBootstrapV2} from "../interfaces/IBootstrapV2.sol";
import {IUpgradeableReserve} from "../interfaces/IUpgradeable.sol";
import {IGovernorMinimal} from "../interfaces/IGovernorMinimal.sol";
import {ReserveGovernor} from "./ReserveGovernor.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBlast} from "../interfaces/IBlast.sol";

contract ReserveGovernorV2 is IBootstrapV2, ReserveGovernor {
    // Make immutable for posterity
    address public immutable RESERVE_IMPLEMENTATION_ADDRESS;
    address public immutable BLUR_POOL_ADDRESS;
    address public immutable WETH_ADDRESS;
    bool public upgraded;
    address public immutable BLAST_ADDRESS;

    /// @notice Constructor for the ReserveGovernorV2 contract.
    /// @param _oldGovernor The address of the old governor contract.
    /// @param _newReserveImplementation The address of the new reserve implementation.
    /// @param _blurPoolAddress The address of the Blur pool.
    /// @param _wethAddress The address of the WETH token.
    /// @param _blastAddress The address of the Blast token.
    constructor(
        address _oldGovernor,
        address _newReserveImplementation,
        address _blurPoolAddress,
        address _wethAddress,
        address _blastAddress
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
        BLAST_ADDRESS = _blastAddress;
        IBlast(BLAST_ADDRESS).configureClaimableGas();
    }


    /// @notice Performs the upgrade on the reserve contract.
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

    /// @notice Claims the maximum amount of gas from the specified token's Blast contract to the reserve.
    /// @param _token The address of the token for which to claim gas.
    /// @dev This function claims the gas if the accumulated etherSeconds are enough to claim for at least one month.
    function _claimGas(address _token) internal governanceNotLocked {
        // Do some checks to make sure it won't revert
        (uint256 _etherSeconds, uint256 _etherBalance,,) = IBlast(BLAST_ADDRESS).readGasParams(_token);
        if(_etherBalance > 0){
            if(_etherSeconds / 2592000 > 0){
                IBlast(BLAST_ADDRESS).claimMaxGas(_token, address(reserve));
            }
        }
    }

    /// @dev Claim max gas for the reserve and voting token
    function claimMaxGas() public governanceNotLocked {
        _claimGas(address(reserve));
        _claimGas(address(votingToken));
        _claimGas(address(this));
    }

    /// @notice Settle votes for configuring the reserve blast governor.
    /// @param _newOwner The address to which the reserve and voting token ownership will be transferred.
    /// @dev If majority sentiment is in favor, the governor is set and all future governance is disabled.
    function settleVotes(address _newOwner) external override governanceNotLocked {
        /* 
         *   With the exception of the following diff, this function is identical to the v1 ReserveGovernor
         *
         *   - reserve.setGovernor(_newOwner);
         *   - votingToken.setGovernor(_newOwner);
         *   + IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(reserve));
         *   + IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(votingToken));
        */
        Proposal storage p = proposed[_newOwner][proposalPeriod];
        uint256 totalVotes = p.forVotes + p.againstVotes;

        if (p.newOwner == address(0)) {
            revert InvalidProposal();
        }

        if (block.timestamp <= p.endTime) {
            revert ProposalVoting();
        }

        if (p.settled) {
            revert VotesSettled();
        }

        bool quorumMet = true;
        if (totalVotes < p.quorum) {
            quorumMet = false;
        }

        uint256 support = 1;
        if (p.againstVotes >= p.forVotes) {
            support = 0;
        }

        p.settled = true;
        proposalPeriod += 1;

        if (support == 1 && quorumMet) {
            governanceLocked = true;
            IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(reserve));
            IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(votingToken));

            Ownable(address(reserve)).transferOwnership(_newOwner);
            Ownable(address(votingToken)).transferOwnership(_newOwner);
            Ownable(descriptor).transferOwnership(_newOwner);
        }

        emit SettledVotes(_newOwner, support, governanceLocked);
    }
}
