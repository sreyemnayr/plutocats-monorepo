// SPDX-License-Identifier: GPL-3.0

/// @title Interface for Plutocats governance bootstrap

import {IBootstrap} from "./IBootstrap.sol";

pragma solidity >=0.8.0;

interface IBootstrapV2 is IBootstrap {
    /// The structure of a proposal without nested mappings.
    error AlreadyUpgraded();

    error NotImplemented();
}
