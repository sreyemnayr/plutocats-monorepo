import chai from 'chai';
import { ethers, run } from 'hardhat';
import type { BigNumber, Signer } from 'ethers';
import { solidity } from 'ethereum-waffle';
import { PlutocatsToken, PlutocatsReserve, PlutocatsReserveV2, PlutocatsDescriptor, MockWithdrawable, ReserveGovernor, ReserveGovernorV2, MarketMultiBuyer } from '../../typechain';
import { PlutocatsToken__factory, PlutocatsReserve__factory, PlutocatsReserveV2__factory, PlutocatsDescriptor__factory, MockWithdrawable__factory, ReserveGovernorV2__factory } from '../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { time, mine, reset} from "@nomicfoundation/hardhat-network-helpers";
import { ContractName, UpgradedContractName, DeployedContract } from '../../tasks/types';

import config from '../../hardhat.config';

chai.use(solidity);
const { expect } = chai;

describe("Reserve contract V2", function () {
    let plutocatsToken: PlutocatsToken;
    let plutocatsReserve: PlutocatsReserveV2;
    let plutocatsDescriptor: PlutocatsDescriptor;
    let wallet: SignerWithAddress;
    let reserveGovernor: ReserveGovernorV2;

    let CHAIN_ID: number;

    let weth: MockWithdrawable;
    let blur: MockWithdrawable;

    let contracts: Record<ContractName, DeployedContract>;
    let contractsV2: Record<UpgradedContractName, DeployedContract>;

    let mintedId: BigNumber;

    const _beforeEach = (async function () {
        await reset(config.networks?.hardhat?.forking?.url, config.networks?.hardhat?.forking?.blockNumber)
        
        const network = await ethers.provider.getNetwork();
        
        
        CHAIN_ID = network.chainId;

        let deployer: SignerWithAddress;

        if (CHAIN_ID == 81457) { // MAINNET FORK, LOAD DEPLOYED CONTRACTS
            deployer = await ethers.getImpersonatedSigner(process.env.PLUTOCATS_DEPLOYER || '0xec740561f99D0cF6EeCb9f7A84Cf35394425f63b');

            contracts = await run('load', {
                testing: true
            });
            
            blur = MockWithdrawable__factory.connect(process.env?.BLUR_POOL || "0xB772d5C5F4A2Eef67dfbc89AA658D2711341b8E5", deployer);
            weth = MockWithdrawable__factory.connect(process.env?.WETH || "0x4200000000000000000000000000000000000004", deployer);
            
            plutocatsToken = contracts.PlutocatsToken.instance as PlutocatsToken;

            await ethers.provider.send("hardhat_setBalance", [
                deployer.address,
                "0x21e19e0c9bab2400000", // 100k ETH should be plenty
            ]);
            
    
            
        } else { // LOCAL FORK, DEPLOY FRESH

            [deployer] = await ethers.getSigners();
            contracts = await run('deploy', {
                autodeploy: true,
                includepredeploy: true,
                silent: true,
                blastpoints: '0x2fc95838c71e76ec69ff817983BFf17c710F34E0',
                blastpointsoperator: deployer.address
            });
            
            blur = await (await ethers.getContractFactory('MockWithdrawable', deployer)).deploy({gasPrice: await ethers.provider.getGasPrice(),});
            weth = MockWithdrawable__factory.connect(process.env?.WETH_SEPOLIA || "0x4200000000000000000000000000000000000023", deployer);
            
            plutocatsToken = contracts.PlutocatsToken.instance as PlutocatsToken;


            await run('populate-descriptor', {
                nftDescriptor: contracts.NFTDescriptorV2.address,
                plutocatsDescriptor: contracts.PlutocatsDescriptor.address,
                silent: true,
            });

            await plutocatsToken.connect(deployer).transferOwnership(contracts.ReserveGovernor.address);
            await contracts.PlutocatsDescriptor.instance.connect(deployer).transferOwnership(contracts.ReserveGovernor.address);

            const price = await plutocatsToken.getPrice();
            await plutocatsToken.mint({ value: price });

            await deployer.sendTransaction({to: contracts.PlutocatsReserveProxy.address, value: ethers.BigNumber.from("3300000000000000000")});
        }
        
        wallet = deployer;


        // mint 20% of the total supply
        const totalSupply = (await plutocatsToken.adjustedTotalSupply()).toNumber();
        let enough = Math.max(Math.ceil(totalSupply / 8), 1);
        
        let tokensOwned = (await plutocatsToken.balanceOf(deployer.address)).toNumber();

        if(tokensOwned < enough){
            const gasPrice = await ethers.provider.getGasPrice();
            const multiminter = await (await ethers.getContractFactory('MarketMultiBuyer', deployer)).deploy(plutocatsToken.address, contracts.PlutocatsReserveProxy.address, {gasPrice});
            
            let amount = enough - tokensOwned;
            const price = await multiminter.estimateMaxPricePer(amount);
            
            await plutocatsToken.mint({ value: price });

            while(amount > 0){
                const max = Math.min(amount, 20);
                await multiminter.connect(deployer).buyMultiple(max, { value: price.mul(max) });
                amount -= max;
            }
        }
        

        const reserveGovernor1 = contracts.ReserveGovernor.instance as ReserveGovernor;

        contractsV2 = await run('deploy-v2-upgrades', {
            autodeploy: true,
            governor: contracts.ReserveGovernor.address,
            silent: true,
            blurPoolAddress: blur.address,
            wethAddress: weth.address,
            local: true,
            forked: CHAIN_ID === 81457,
            blastAddress: contracts.MockBlast.address,
        });

        
        // Propose an upgrade of the governor to the new one.
        
        await reserveGovernor1.connect(wallet).propose(contractsV2.ReserveGovernorV2.address);
        
        // Vote
        await reserveGovernor1.connect(wallet).vote(contractsV2.ReserveGovernorV2.address, 1);
        
        
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const eightdays = ethers.BigNumber.from((cts + (86400 * 8)));

        // Wait 8 days
        await time.increaseTo(eightdays);
        await mine(1);

        
        await reserveGovernor1.connect(wallet).settleVotes(contractsV2.ReserveGovernorV2.address);
        await mine(1);

        
        
        plutocatsReserve = PlutocatsReserveV2__factory.connect(contracts.PlutocatsReserveProxy.address, deployer);
        reserveGovernor = (contractsV2.ReserveGovernorV2.instance as ReserveGovernorV2).connect(wallet);

    });


    beforeEach(_beforeEach);

    describe("Only allow quits if token approval is set first", function () {
        let minted: BigNumber[] = [];
        beforeEach(async function () {
            minted = []
            await _beforeEach();
            await reserveGovernor.connect(wallet).doUpgrade()
            for (let i = 0; i < 2; i++) {
                const price = await plutocatsToken.getPrice();
                minted.push((await plutocatsToken.callStatic.mint({ value: price })));
                await plutocatsToken.mint({ value: price });
            }
        });

        it("Should fail if no approval is set", async function () {
            await expect(plutocatsReserve.quit([minted[0]])).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
        });

        it("Should not fail if approval is set", async function () {
            await plutocatsToken.approve(plutocatsReserve.address, minted[0]);
            await expect(plutocatsReserve.quit([minted[0]])).to.not.be.reverted;
        });

    });

    // it("It should only allow quits if token approval is set first", async function () {
    //     await reserveGovernor.doUpgrade()

    //     const price = await plutocatsToken.getPrice();
    //     // Already minting one in the beforeEach
    //     //await plutocatsToken.mint({ value: price });

    //     await expect(plutocatsReserve.quit([0])).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

    //     // approve and quit should work
    //     await plutocatsToken.approve(plutocatsReserve.address, 0);
    //     await expect(plutocatsReserve.quit([0])).to.not.be.reverted;
    // });

    it("It should fail if sender does not own the tokens provided", async function () {
        await reserveGovernor.connect(wallet).doUpgrade()

        let minted: BigNumber[] = [];

        for (let i = 0; i < 2; i++) {
            const price = await plutocatsToken.getPrice();
            minted.push((await plutocatsToken.callStatic.mint({ value: price })));
            await plutocatsToken.mint({ value: price });
        }

        await plutocatsToken.transferFrom(wallet.address, "0x000000000000000000000000000000000000dEaD", minted[0]);

        // 0 is not owned by the sender should revert
        await expect(plutocatsReserve.quit(minted)).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

        // approve and quit on owned tokens should work
        await plutocatsToken.setApprovalForAll(plutocatsReserve.address, true);
        await expect(plutocatsReserve.quit(minted.slice(1))).to.not.be.reverted;
    });

    it("It should revert if duplicate tokenIds are passed in burn", async function () {
        await reserveGovernor.connect(wallet).doUpgrade()
        let minted: BigNumber[] = [];

        for (let i = 0; i < 2; i++) {
            const price = await plutocatsToken.getPrice();
            minted.push((await plutocatsToken.callStatic.mint({ value: price })));
            await plutocatsToken.mint({ value: price });
        }

        await expect(plutocatsReserve.quit([minted[0]])).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

        // approve and quit should work
        await plutocatsToken.approve(plutocatsReserve.address, minted[0]);

        // Duplicate ids passed should always revert)
        await expect(plutocatsReserve.quit([minted[0], minted[0], minted[0]])).to.be.revertedWith("ERC721: transfer of token that is not own");
    });

    it("Only owner can set blast governor", async function () {
        await reserveGovernor.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        await expect(plutocatsReserve.connect(s1).setGovernor(ethers.constants.AddressZero)).to.be.reverted;
    });

    it("It should calc pro rata claim correctly using adjusted supply", async function () {
        await reserveGovernor.doUpgrade()
        

        // approve and quit should work
        const minted = []

        for (let i = 0; i < 2; i++) {
            const price = await plutocatsToken.getPrice();
            minted.push((await plutocatsToken.callStatic.mint({ value: price })));
            await plutocatsToken.mint({ value: price });
        }

        await plutocatsToken.approve(plutocatsReserve.address, minted[0]);
        await expect(plutocatsReserve.quit([minted[0]])).to.not.be.reverted;

        const startingReserveBalance = await ethers.provider.getBalance(plutocatsReserve.address);

        const [_, s1, s2] = await ethers.getSigners();

        let catsTokenS1 = plutocatsToken.connect(s1);
        let catsTokenS2 = plutocatsToken.connect(s2);
        let s1Ids = [];
        let s2Ids = [];
        let s1Contrib = [];
        let s2Contrib = [];

        for (let i = 0; i < 5; i++) {
            // have buyers chase each other
            let price = await catsTokenS1.getPrice();
            const s1id = await catsTokenS1.callStatic.mint({ value: price });
            s1Ids.push(s1id);
            s1Contrib.push(price);

            await catsTokenS1.mint({ value: price });

            price = await catsTokenS2.getPrice();
            const s2id = await catsTokenS2.callStatic.mint({ value: price });
            s2Ids.push(s2id);
            s2Contrib.push(price);

            await catsTokenS2.mint({ value: price });
        }

        await catsTokenS1.setApprovalForAll(plutocatsReserve.address, true);
        await catsTokenS2.setApprovalForAll(plutocatsReserve.address, true);

        // we now have 10 tokens minted by 2 different buyers
        // if we unroll the reserve in reverse order to which tokens
        // were minted, callers should receive back equal amounts
        let rS1 = plutocatsReserve.connect(s1);
        let rS2 = plutocatsReserve.connect(s2);

        let s1Received = ethers.BigNumber.from(0);
        let s2Received = ethers.BigNumber.from(0);
        for (let i = 4; i >= 0; i--) {
            let tx = await rS2.quit([s2Ids[i]]);
            let receipt = await tx.wait();
            let e = receipt.events?.filter((x) => { return x.event == "Quit"; })[0];

            // @ts-ignore
            s2Received = s2Received.add(e?.args.amount);

            tx = await rS1.quit([s1Ids[i]]);
            receipt = await tx.wait();
            e = receipt.events?.filter((x) => { return x.event == "Quit"; })[0];

            // @ts-ignore
            s1Received = s1Received.add(e?.args.amount);
        }

        expect(s1Received).to.be.closeTo(s2Received, s1Received.div(ethers.BigNumber.from("10000000000000000")));

        const reserveBalance = await ethers.provider.getBalance(plutocatsReserve.address);
        
        await expect(reserveBalance).to.be.eq(startingReserveBalance);

        for (let i = 0; i < 5; i++) {
            // have buyers chase each other
            let price = await catsTokenS1.getPrice();
            const s1id = await catsTokenS1.callStatic.mint({ value: price });
            s1Ids.push(s1id);
            s1Contrib.push(price);

            await catsTokenS1.mint({ value: price });

            price = await catsTokenS2.getPrice();
            const s2id = await catsTokenS2.callStatic.mint({ value: price });
            s2Ids.push(s2id);
            s2Contrib.push(price);

            await catsTokenS2.mint({ value: price });
        }
    });
    it("It should claim royalties", async function () {
        const [_, s1] = await ethers.getSigners();
        const rS1 = plutocatsReserve.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await plutocatsToken.getPrice();
            await plutocatsToken.mint({ value: price });
        }

        await mine(1);

        // Make some initial deposits
        if (CHAIN_ID != 81457){
            await blur['deposit(address)'](plutocatsReserve.address, {value: ethers.BigNumber.from("3000000000000000000")});
        }
        
        await weth['deposit()']({value: ethers.BigNumber.from("3000000000000000000")});
        await weth.transfer(plutocatsReserve.address, ethers.BigNumber.from("3000000000000000000"));

        const weth_balance = await weth.balanceOf(plutocatsReserve.address);
        const blur_balance = await blur.balanceOf(plutocatsReserve.address);

        // The balance of the reserve in blur/weth should be 3 ETH each
        expect(weth_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));
        expect(blur_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));

        const reserveFactory = await ethers.getContractFactory('PlutocatsReserveV2', wallet);
        const plutocatsReserveImplementation: PlutocatsReserveV2 = reserveFactory.attach(contractsV2.PlutocatsReserveV2.address);

        const DEV_ADDRESS = await plutocatsReserveImplementation.DEV_ADDRESS();
        
       
        let dev_balance = await ethers.provider.getBalance(DEV_ADDRESS);
        

        let dev_bounty = await plutocatsReserveImplementation.DEV_BOUNTY();
        expect(dev_bounty).to.be.eq(ethers.BigNumber.from("3000000000000000000"));

        let balance = await ethers.provider.getBalance(plutocatsReserve.address);

        // Deposit the royalties
        await reserveGovernor.connect(wallet).doUpgrade()
       
        let new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
        let new_dev_balance = await ethers.provider.getBalance(DEV_ADDRESS);

        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(plutocatsReserve.address)).to.be.eq(0);
        expect(await blur.balanceOf(plutocatsReserve.address)).to.be.eq(0);

        expect(new_balance).to.be.gt(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)).sub(dev_bounty));
                
        // Dev balance should increase by the dev bounty amount
        expect(new_dev_balance).to.be.eq(dev_balance.add(dev_bounty));
    });
    it("It should claim royalties if only blur available", async function () {
        await reserveGovernor.connect(wallet).doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = plutocatsReserve.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await plutocatsToken.getPrice();
            await plutocatsToken.mint({ value: price });
        }

        await mine(1);

        let blur_balance = ethers.BigNumber.from(0);

        // Make some initial deposits
        if (CHAIN_ID != 81457){
            await blur['deposit(address)'](plutocatsReserve.address, {value: ethers.BigNumber.from("3000000000000000000")});
            blur_balance = await blur.balanceOf(plutocatsReserve.address);

            // The balance of the reserve in blur/weth should be 3 ETH each
            expect(blur_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));
        }
        
        const weth_balance = await weth.balanceOf(plutocatsReserve.address);
        

       
        let balance = await ethers.provider.getBalance(plutocatsReserve.address);

        // Deposit the royalties
        await plutocatsReserve.depositRoyalties();

        let new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
        
        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(plutocatsReserve.address)).to.be.eq(0);
        expect(await blur.balanceOf(plutocatsReserve.address)).to.be.eq(0);

        expect(new_balance).to.be.gte(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));
        
    });
    it("It should claim royalties if only weth available", async function () {
        await reserveGovernor.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = plutocatsReserve.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await plutocatsToken.getPrice();
            await plutocatsToken.mint({ value: price });
        }

        await mine(1);

        // Make some initial deposits
        await weth['deposit()']({value: ethers.BigNumber.from("3000000000000000000")});
        await weth.transfer(plutocatsReserve.address, ethers.BigNumber.from("3000000000000000000"));
        
        const weth_balance = await weth.balanceOf(plutocatsReserve.address);
        const blur_balance = await blur.balanceOf(plutocatsReserve.address);

        // The balance of the reserve in blur/weth should be 3 ETH each
        
        expect(weth_balance).to.be.eq(ethers.BigNumber.from("3000000000000000000"));


        let balance = await ethers.provider.getBalance(plutocatsReserve.address);

        // Deposit the royalties
        await plutocatsReserve.depositRoyalties();

        let new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
        
        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(plutocatsReserve.address)).to.be.eq(0);
        expect(await blur.balanceOf(plutocatsReserve.address)).to.be.eq(0);

        expect(new_balance).to.be.gt(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));
        
    });
    it("It should claim royalties every time", async function () {
        await reserveGovernor.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = plutocatsReserve.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await plutocatsToken.getPrice();
            await plutocatsToken.mint({ value: price });
        }

        await mine(1);


        for (let i=0; i>10; i++){
            let blur_amt = ethers.utils.parseEther((Math.random() * 1.5 + 0.5).toFixed(18).toString());
            let weth_amt = ethers.utils.parseEther((Math.random() * 1.5 + 0.5).toFixed(18).toString());
            await weth['deposit()']({value: weth_amt});
            await weth.transfer(plutocatsReserve.address, weth_amt);
            await blur['deposit(address)'](plutocatsReserve.address, {value: blur_amt});

            const weth_balance = await weth.balanceOf(plutocatsReserve.address);
            const blur_balance = await blur.balanceOf(plutocatsReserve.address);

            expect(blur_balance).to.be.eq(blur_amt);
            expect(weth_balance).to.be.eq(weth_amt);

            let balance = await ethers.provider.getBalance(plutocatsReserve.address);

            await plutocatsReserve.depositRoyalties();

            let new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
            
            expect(await weth.balanceOf(plutocatsReserve.address)).to.be.eq(0);
            expect(await blur.balanceOf(plutocatsReserve.address)).to.be.eq(0);

            expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));


        }
        
    });

    describe.skip("DE-IMPLEMENTED: Owner should be able to claim royalties from an arbitrary withdrawable contract", function () {
        let s1: SignerWithAddress;
        let other: SignerWithAddress;
        let rS1;
        let withdrawable: MockWithdrawable;
        let weth_balance: BigNumber;
        let blur_balance: BigNumber;
        let withdrawable_balance: BigNumber;
        let new_balance: BigNumber;
        let balance: BigNumber;

        beforeEach(async function () {
            await _beforeEach();
            [s1, other] = await ethers.getSigners();
            await reserveGovernor.doUpgrade()
            rS1 = plutocatsReserve.connect(s1);
            for (let i = 0; i < 10; i++) {
                const price = await plutocatsToken.getPrice();
                await plutocatsToken.mint({ value: price });
            }
            await mine(1);
            const withdrawableFactory = await ethers.getContractFactory('MockWithdrawable');
            withdrawable = await withdrawableFactory.deploy();
            await withdrawable['deposit(address)'](plutocatsReserve.address, {value: ethers.BigNumber.from("3000000000000000000")});
            balance = await ethers.provider.getBalance(plutocatsReserve.address);
            await plutocatsReserve.depositRoyalties();
            new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
            weth_balance = await weth.balanceOf(plutocatsReserve.address);
            blur_balance = await blur.balanceOf(plutocatsReserve.address);
            withdrawable_balance = await withdrawable.balanceOf(plutocatsReserve.address);

        });
        it("Should have correct initial values", async function () {
            expect(weth_balance).to.be.eq(0);
            expect(blur_balance).to.be.eq(0);
            expect(withdrawable_balance).to.be.eq(ethers.BigNumber.from("3000000000000000000"));
            expect(new_balance).to.be.eq(balance);
        });
        it("Should fail if called by non-owner", async function () {
            await expect(reserveGovernor.connect(other).withdrawEthFrom(withdrawable.address)).to.be.reverted;
        });
        it("Should fail if called directly by non-owner", async function () {
            await expect(await plutocatsReserve.owner()).to.be.eq(reserveGovernor.address);
            await expect(plutocatsReserve.connect(other).withdrawEthFrom(withdrawable.address)).to.be.reverted;
        });
        it("Should fail if called directly with non-withdrawable contract by owner", async function () {
            await expect(plutocatsReserve.connect(wallet).withdrawEthFrom(plutocatsToken.address)).to.be.reverted;
        });
        it("Should fail if called directly with withdrawable contract by owner", async function () {
            await expect(plutocatsReserve.connect(wallet).withdrawEthFrom(withdrawable.address)).to.be.reverted;
        });
        it.skip("DE-IMPLEMENTED: Should not fail if called on the governor, by the owner, with a withdrawable contract", async function () {
            await expect(reserveGovernor.connect(wallet).withdrawEthFrom(withdrawable.address)).to.be.reverted;
            // await reserveGovernor.connect(wallet).withdrawEthFrom(withdrawable.address);
            // let new_new_balance = await ethers.provider.getBalance(plutocatsReserve.address);
            
            // Balance should be +3 ETH
            // expect(await withdrawable.balanceOf(plutocatsReserve.address)).to.be.eq(0);

            // expect(new_new_balance).to.be.eq(new_balance.add(ethers.BigNumber.from("3000000000000000000")));
        });
    });
});

