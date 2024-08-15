## Plutocats Upgrade v2 Proposal
<small>Developed by Ryan Meyers for the [Plutocats](https://plutocats.wtf) community ([@sreyeMnayR](https://x.com/sreyemnayr) / [strangeruff.eth](https://strangeruff.eth.co)) </small>

### Why is an upgrade needed?
Royalties on secondary market purchases of Plutocats have been pointed to the `PlutocatsReserveProxy` address `0x4eA682B94B7e13894C3d0b9afEbFbDd38CdACc3C` [BlastScan](https://blastscan.io/address/0x4ea682b94b7e13894c3d0b9afebfbdd38cdacc3c) , which in the case of ETH purchases causes the balance of the Reserve to increase. Many secondary market purchases, however, are made with wrapped ETH offers or Blur bids, which cause a balance to accrue on the [wETH](https://blastscan.io/token/0x4300000000000000000000000000000000000004?a=0x4eA682B94B7e13894C3d0b9afEbFbDd38CdACc3C) or [Blur Pool](https://blastscan.io/token/0xB772d5C5F4A2Eef67dfbc89AA658D2711341b8E5?a=0x4eA682B94B7e13894C3d0b9afEbFbDd38CdACc3C) smart contracts, respectively. Those balances are out of reach for the first version of the `PlutcatsReserve` smart contract, but lucky for us, it's upgradeable! 

### How does an upgrade work?
The `PlutocatsReserveProxy` implements OpenZeppelin's [UUPS](https://docs.openzeppelin.com/contracts/4.x/api/proxy#UUPSUpgradeable) pattern of the [ERC-1967](https://eips.ethereum.org/EIPS/eip-1967) proxy standard, as well as OZ's [Ownable](https://docs.openzeppelin.com/contracts/4.x/api/access#Ownable) access control helper for [ERC-173](https://eips.ethereum.org/EIPS/eip-173). Simply, this allows only the "owner" of the smart contract to call the `upgradeTo` or `upgradeToAndCall` methods and flash it with new implementation code and, if desired, call an initializing method on the newly implemented logic. 

So, who is the "owner" of the `PlutocatsReserveProxy` smart contract? The `ReserveGovernor`, of course!

The founders of Plutocats intended to create an increasingly decentralized new protocol, and as such, deployed an initial "bootstrapped" `ReserveGovernor` smart contract ([BlastScan](https://blastscan.io/address/0x8f0fe69903e90742336655d5fb3f8d4c7d033d66#code)) that has been assigned ownership of `PlutocatsToken`, `PlutocatsReserve` and `PlutocatsDescriptor`. 

This v1 `ReserveGovernor` has a handful of functions:
 - the owner can `propose` a replacement governor address (which could be a smart contract or EOA)
	 - *As of this writing, the owner is an EOA controlled by the founders (this prevents a 51% attack and potential takeover of reserve funds). While this is an obviously centralized starting position, they have been more than willing to put to an on-chain vote a proposed governor replacement that any community member moves forward. In fact, that's exactly what is happening now!*
 - a token holder can `vote` for a proposed replacement 
	 - *a vote of `1` support adds as many votes to pass the proposal as were owned by that holder at the time of the proposal; a vote of `0` support adds the same number of votes to deny the proposal*
 - anyone can `settleVotes` for a proposal as long as 7 days have passed and it hasn't already been settled. Doing so tallies the support/against votes, determines if 10% quorum has been met, and either transfers ownerships to the replacement (if passed) or increments the proposal period internally, allowing for future proposals to be made.
 - the owner can `transferOwnership` of the smart contract, or relinquish it (thus freezing the protocol)

An attentive reader will notice that amongst the v1 `ReserveGovernor`'s functions is <u>not</u> a method of upgrading the `PlutocatsReserve`. Even though, as the owner, the `ReserveGovernor` has *permission* to upgrade the reserve, it does not have an *interface* able to do so.  Yet. 


### What's different about `ReserveGovernorV2`?
`ReserveGovernorV2` inherits `ReserveGovernor` - that is, everything that `ReserveGovernor` does is automatically implemented in `ReserveGovernorV2` unless overridden. 

#### New interfaces:
 - anyone can read and verify the following immutable (can never be changed) variables:
	 - `RESERVE_IMPLEMENTATION_ADDRESS`: the address at which the new `PlutocatsReserveV2` logic has been deployed.
	 - `BLUR_POOL_ADDRESS`: the address of the Blur Pool, where 46+ ETH from secondary royalties is currently stuck.
	 - `WETH_ADDRESS`: the address of wrapped ETH, where 9+ ETH from secondary royalties is currently stuck.
 - anyone can `doUpgrade`, as long as it hasn't already been done before. Doing so causes `PlutocatsReserveProxy` to update its implementation to code deployed at `RESERVE_IMPLEMENTATION_ADDRESS` and immediately call the `initializeV2` method with constructor arguments of the  `BLUR_POOL_ADDRESS` and `WETH_ADDRESS`. 
 - anyone can `claimGas(address)` to claim gas rebates for a smart contract owned by the governor. Gas rebates are sent to the `PlutocatsReserveProxy` address.
 - anyone can `claimMaxGas` to claim gas rebates for the `PlutocatsReserveProxy` and `PlutocatsToken` smart contracts, in addition to the `ReserveGovernorV2` address itself. Gas rebates are sent to the `PlutocatsReserveProxy` address.

#### Overridden logic of previous interfaces:
The `settleVotes` method in `ReserveGovernor` required an override, due to the first version's call of `setGovernor` on the `PlutocatsToken` and `PlutocatsReserve` smart contracts. Those methods both assign a "Blast governor" for configuring yield and gas rebates for their respective addresses, and can only be done once. After that, the method reverts because each contract address itself no longer has the permissions to change its own operator. The `ReserveGovernorV2` (as the now-appointed "governor" of the native yield and gas configuration for those addresses) calls the pre-deployed Blast contract directly to achieve the same end (any replacement to `ReserveGovernorV2` will be assigned governorship of those addresses)
```diff 
-reserve.setGovernor(_newOwner);
+IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(reserve));
-votingToken.setGovernor(_newOwner);
+IBlast(BLAST_ADDRESS).configureGovernorOnBehalf(_newOwner, address(votingToken));
```

### What's different about `PlutocatsReserveV2`?
`PlutocatsReserveV2` inherits `PlutocatsReserve` - that is, everything that `PlutocatsReserve` does is automatically implemented in `PlutocatsReserveV2`. There are no overridden interfaces. 

#### New interfaces:

 - anyone can read and verify the following variables:
	 - `blurPoolAddress`: the address of the Blur Pool smart contract, from which ETH will be withdrawn
	 - `wethAddress`: the address of the wrapped ETH smart contract, from which ETH will be withdrawn
	 - `DEV_ADDRESS`: the address to which a one-time bounty will be paid from the initial royalty claim
	 - `DEV_BOUNTY`: the amount of ETH which will be sent to the `DEV_ADDRESS` 
 - anyone can check the `royaltiesAvailableForWithdrawal`, which returns the balance of Blur Pool and WETH owned by the reserve.
 - anyone can `depositRoyalties`, which simply withdraws any ETH currently deposited in the Blur Pool or WETH smart contracts into the reserve.
 - anyone can technically `initializeV2`, but it can only happen once and will be automatically called by `ReserveGovernorV2` as part of its `doUpgrade` method. When called, it retrieves the Blur Pool and WETH royalties, then pays the developer bounty. 

#### Note:
The public visibility of `royaltiesAvailableForWithdrawal` combined with the public executability of `depositRoyalties` allows anyone that so desires to easily code and schedule a check/deposit script using an account provisioned with a negligible amount of ETH to keep balances accruing.

## How can I test it out?
Tests have been written to ensure compatibility (all existing tests still pass) as well as feature correctness (new methods have tests to be sure they do what they are intended to do)
After following installation/build instructions in the README, you can simply run `pnpm test` to run all tests in both a local fork of Sepolia (starting from scratch) and mainnet (with the smart contracts as they currently exist now). To limit the tests to just new stuff, run `pnpm test:v2`

## TLDR: How do I vote for the upgrade?

 1. Visit the `ReserveGovernor` page on [BlastScan](https://blastscan.io/address/0x8f0fe69903e90742336655d5fb3f8d4c7d033d66#writeContract#F5) or     [ABI.ninja](https://abi.ninja/0x8f0fe69903e90742336655d5fb3f8d4c7d033d66/81457?methods=vote) or wherever you like. 
 2. Connect with your wallet holding Plutocats
 3. Adjust the inputs:
	 * `_newOwner`: `0x0` *(the proposed `ReserveGovernor` replacement)*
	 * `_support`: `1` to vote FOR the proposal, `0` to vote against.
 4. Click "Write" or "Send" and confirm the transaction with your wallet.

