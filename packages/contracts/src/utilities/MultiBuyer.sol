// SPDX-License-Identifier: GPL-3.0

/// This utility is not part of the Plutocats protocol and was created to provide
/// a way to mint Plutocats at market price under high demand.

pragma solidity >=0.8.0;

import {IPlutocatsTokenMultibuy} from "../interfaces/IPlutocatsTokenMultibuy.sol";
import {IBlast} from "../interfaces/IBlast.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IReserve} from "../interfaces/IReserve.sol";

contract MarketMultiBuyer {
    using Address for address payable;

    event Minted(uint256 tokenId, address owner, uint256 price);

    /// The address of the pre-deployed Blast contract.
    address public constant BLAST_PREDEPLOY_ADDRESS = 0x4300000000000000000000000000000000000002;
    address public reserve;

    IBlast public blast;

    IPlutocatsTokenMultibuy public plutocats;

    constructor(address _plutocats, address _reserve) {
        plutocats = IPlutocatsTokenMultibuy(_plutocats);
        blast = IBlast(BLAST_PREDEPLOY_ADDRESS);
        blast.configureClaimableGas();
        blast.configureGovernor(msg.sender);
        reserve = _reserve;
        plutocats.setApprovalForAll(address(reserve), true);
    }

    /// @dev Takes an integer amount of seconds and converts it to a wad amount of days.
    /// @dev Will not revert on overflow, only use where overflow is not possible.
    /// @dev Not meant for negative second amounts, it assumes x is positive.
    function toDaysWadUnsafe(uint256 x) internal pure returns (int256 r) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Multiply x by 1e18 and then divide it by 86400.
            r := div(mul(x, 1000000000000000000), 86400)
        }
    }

    function estimateMaxPricePer(uint256 amount) public view returns (uint256) {
        uint256 timeSinceStart = block.timestamp - plutocats.MINT_START();
        uint256 totalSupply = plutocats.totalSupply();
        uint256 vrgdaPrice = plutocats.getVRGDAPrice(toDaysWadUnsafe(timeSinceStart), totalSupply + amount);
        uint256 minPrice = vrgdaPrice;
        uint256 adjTotalSupply = plutocats.adjustedTotalSupply();
        
        minPrice = reserve.balance / adjTotalSupply;
        if (vrgdaPrice < minPrice) {
            return minPrice;
        }
        return vrgdaPrice;
    }

    function estimateMaxAtCurrentPrice() public view returns (uint256) {
        uint256 price = plutocats.getPrice();
        uint256 priceAt = price;
        uint256 count = 0;
        while(priceAt == price) {
            count++;
            priceAt = estimateMaxPricePer(count);
        }
        return count - 1;
    }

    function recycleMultiple(uint256 amount) external payable {
        uint256 price = plutocats.getPrice();
        uint256[] memory mintedId = new uint256[](1);
        IReserve reserveContract = IReserve(reserve);
        for(uint256 i = 0; i < amount; i++) {
            if(price > msg.value) {
                payable(msg.sender).sendValue(msg.value);
                return;
            }
            mintedId[0] = plutocats.mint{value: price}();
            reserveContract.quit(mintedId);
            price = plutocats.getPrice();
        }
        payable(msg.sender).sendValue(msg.value);
    }

    function buyMultiple(uint256 amount) external payable returns (uint256, uint256, uint256) {
        uint256 price;
        uint256 mintedId;
        uint256 totalPrice = 0;
        uint256 firstMintedId = 0;

        for(uint256 i = 0; i < amount; i++) {
            price = plutocats.getPrice();
            totalPrice += price;
            mintedId = plutocats.mint{value: price}();
            if (i == 0) {
                firstMintedId = mintedId;
            }
            emit Minted(mintedId, msg.sender, price);
            plutocats.transferFrom(address(this), msg.sender, mintedId);

        }
        require(msg.value >= totalPrice, "payment too low");

        uint256 refund = msg.value - totalPrice;
        if (refund > 0) {
            payable(msg.sender).sendValue(refund);
        }

        return (firstMintedId, mintedId, totalPrice);
    }

    receive() external payable {}

    fallback() external payable {}
}
