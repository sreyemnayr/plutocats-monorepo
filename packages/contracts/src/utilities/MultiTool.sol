// SPDX-License-Identifier: GPL-3.0

/// This utility is not part of the Plutocats protocol and was created to provide
/// a way to mint Plutocats at market price under high demand.

pragma solidity >=0.8.0;

import {IPlutocatsTokenMultiTool} from "../interfaces/IPlutocatsTokenMultiTool.sol";
import {IBlast} from "../interfaces/IBlast.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IReserve} from "../interfaces/IReserve.sol";

contract PlutocatsMultiTool {
    using Address for address payable;

    event Minted(uint256 tokenId, address owner, uint256 price);

    /// The address of the pre-deployed Blast contract.
    address public constant BLAST_PREDEPLOY_ADDRESS = 0x4300000000000000000000000000000000000002;
    address public reserve;

    IBlast public blast;

    IPlutocatsTokenMultiTool public plutocats;

    constructor(address _plutocats, address _reserve) {
        plutocats = IPlutocatsTokenMultiTool(_plutocats);
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
        if(amount == 0){
            return 0;
        }
        if(amount == 1){
            return plutocats.getPrice();
        }

        uint256 timeSinceStart = block.timestamp - plutocats.MINT_START();
        uint256 totalSupply = plutocats.totalSupply();
        uint256 adjTotalSupply = plutocats.adjustedTotalSupply();
        
        return _estimatePriceForN(amount, timeSinceStart, totalSupply, adjTotalSupply);
    }

    function _estimatePriceForN(uint256 n, uint256 timeSinceStart, uint256 totalSupply, uint256 adjTotalSupply) internal view returns (uint256) {
        uint256 vrgdaPrice = plutocats.getVRGDAPrice(toDaysWadUnsafe(timeSinceStart), totalSupply + n);
        uint256 currentMinPrice = reserve.balance / adjTotalSupply;
        uint256 minPrice = (reserve.balance + ((n-1)*currentMinPrice)) / (adjTotalSupply + n - 1);
        if (vrgdaPrice < currentMinPrice) {
            return minPrice;
        }
        return vrgdaPrice;
    }

    function estimateTotalCost(uint256 amount) public view returns (uint256 totalCost) {
        if(amount == 0){
            return 0;
        }
        if(amount == 1){
            return plutocats.getPrice();
        }
        uint256 timeSinceStart = block.timestamp - plutocats.MINT_START();
        uint256 totalSupply = plutocats.totalSupply();
        uint256 adjTotalSupply = plutocats.adjustedTotalSupply();

        for(uint256 n = 1; n <= amount; n++){
            uint256 price = _estimatePriceForN(n, timeSinceStart, totalSupply, adjTotalSupply);
            totalCost += price;
        }
        return totalCost;
    }

    function estimateMaxAtCurrentPrice() public view returns (uint256) {
        uint256 price = plutocats.getPrice();
        uint256 priceAt = price;
        uint256 count = 1;
        while(priceAt <= price) {
            count++;
            priceAt = estimateMaxPricePer(count);
        }
        return count;
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

    function buyMultiple(uint256 amount) external payable returns (uint256 firstMintedId, uint256 lastMintedId, uint256 totalPrice) {
        uint256 price;

        for(uint256 i = 0; i < amount; i++) {
            price = plutocats.getPrice();
            totalPrice += price;
            lastMintedId = plutocats.mint{value: price}();
            if (i == 0) {
                firstMintedId = lastMintedId;
            }
            emit Minted(lastMintedId, msg.sender, price);
            plutocats.transferFrom(address(this), msg.sender, lastMintedId);

        }
        require(msg.value >= totalPrice, "payment too low");

        uint256 refund = msg.value - totalPrice;
        if (refund > 0) {
            payable(msg.sender).sendValue(refund);
        }

        return (firstMintedId, lastMintedId, totalPrice);
    }

    function buy() external payable returns (uint256, uint256) {
        uint256 price = plutocats.getPrice();
        require(msg.value >= price, "payment too low");

        uint256 mintedId = plutocats.mint{value: price}();
        emit Minted(mintedId, msg.sender, price);

        plutocats.transferFrom(address(this), msg.sender, mintedId);

        uint256 refund = msg.value - price;
        if (refund > 0) {
            payable(msg.sender).sendValue(refund);
        }

        return (mintedId, price);
    }

    function getTokensOwnedBy(address owner) external view returns (uint256[] memory) {
        uint256 ownerBalance = plutocats.balanceOf(owner);
        uint256[] memory tokens = new uint256[](ownerBalance);
        for(uint256 i = 0; i < ownerBalance; i++){
            tokens[i] = plutocats.tokenOfOwnerByIndex(owner, i);
        }
        return tokens;
    }

    function quitValue() external view returns (uint256) {
        return reserve.balance / plutocats.adjustedTotalSupply();
    }

    receive() external payable {}

    fallback() external payable {}
}
