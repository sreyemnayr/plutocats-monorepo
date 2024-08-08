// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import {IReserve} from "./IReserve.sol";

interface IUpgradeableReserve is IReserve {
    function upgradeTo(address newImplementation) external;
    function upgradeToAndCall(address newImplementation, bytes calldata data) external;
}

