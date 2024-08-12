// SPDX-License-Identifier: GPL-3.0

/// @title Interface for Plutocats Reserve

import { IReserve } from "./IReserve.sol";

pragma solidity >=0.8.0;

interface IReserveV2 is IReserve {
    function withdrawEthFrom(address withdrawable) external;
}
