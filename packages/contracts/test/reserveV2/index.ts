import chai from 'chai';
import { ethers, run } from 'hardhat';
import type { BigNumber, Signer } from 'ethers';
import { solidity } from 'ethereum-waffle';
import { 
    MockWithdrawable, 
    MockWithdrawable__factory, 
    PlutocatsMultiTool, 
    PlutocatsReserve,
    PlutocatsReserve__factory,
    PlutocatsReserveV2, 
    PlutocatsReserveV2__factory 
} from '../../typechain';
import { OriginalContracts, UpgradedContracts } from '../../tasks/types';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { time, mine, reset} from "@nomicfoundation/hardhat-network-helpers";

import config from '../../hardhat.config';

chai.use(solidity);
const { expect } = chai;

describe("Reserve contract upgrades to V2 and performs existing functions and royalty withdrawals", function () {
    let reserveV1: PlutocatsReserve;
    let reserveV2: PlutocatsReserveV2;
    let wallet: SignerWithAddress;
    let blur: MockWithdrawable;
    let weth: MockWithdrawable;
    let CHAIN_ID: number;

    let contracts: OriginalContracts;
    let contractsV2: UpgradedContracts;

    let mintedId: BigNumber;

    const _beforeEach = (async function () {
        await reset(config.networks?.hardhat?.forking?.url, config.networks?.hardhat?.forking?.blockNumber)
        
        const network = await ethers.provider.getNetwork();
        
        
        CHAIN_ID = network.chainId;

        let deployer: SignerWithAddress;

        if (CHAIN_ID == 81457) { // MAINNET FORK, LOAD DEPLOYED CONTRACTS
            deployer = await ethers.getImpersonatedSigner(process.env.PLUTOCATS_DEPLOYER || '0xec740561f99D0cF6EeCb9f7A84Cf35394425f63b');
            await ethers.provider.send("hardhat_setBalance", [
                deployer.address,
                "0x21e19e0c9bab2400000", // 100k ETH should be plenty
            ]);

            contracts = await run('load', {
                testing: true
            });
            
            blur = MockWithdrawable__factory.connect(process.env?.BLUR_POOL || "0xB772d5C5F4A2Eef67dfbc89AA658D2711341b8E5", deployer);
            weth = MockWithdrawable__factory.connect(process.env?.WETH || "0x4200000000000000000000000000000000000004", deployer);
            
            
        } else { // LOCAL FORK, DEPLOY FRESH

            [deployer] = await ethers.getSigners();
            await ethers.provider.send("hardhat_setBalance", [
                deployer.address,
                "0x21e19e0c9bab2400000", // 100k ETH should be plenty
            ]);

            
            contracts = await run('deploy', {
                autodeploy: true,
                includepredeploy: true,
                silent: true,
                blastpoints: '0x2fc95838c71e76ec69ff817983BFf17c710F34E0',
                blastpointsoperator: deployer.address
            });

            await deployer.sendTransaction({to: contracts.PlutocatsReserveProxy.address, value: ethers.BigNumber.from("4300000000000000000")});

            blur = await (await ethers.getContractFactory('MockWithdrawable', deployer)).deploy({gasPrice: await ethers.provider.getGasPrice(),});
            weth = MockWithdrawable__factory.connect(process.env?.WETH_SEPOLIA || "0x4200000000000000000000000000000000000023", deployer);
            
            await run('populate-descriptor', {
                nftDescriptor: contracts.NFTDescriptorV2.address,
                plutocatsDescriptor: contracts.PlutocatsDescriptor.address,
                silent: true,
            });

            await contracts.PlutocatsToken.instance.connect(deployer).transferOwnership(contracts.ReserveGovernor.address);
            await contracts.PlutocatsDescriptor.instance.connect(deployer).transferOwnership(contracts.ReserveGovernor.address);

            const price = await contracts.PlutocatsToken.instance.getPrice();
            await contracts.PlutocatsToken.instance.mint({ value: price });

            

            let tokenBalance = await contracts.PlutocatsToken.instance.balanceOf(wallet.address);
            const tokenIds = [];
            for(let i = 0; i < tokenBalance.toNumber(); i++){
                const tokenId = await contracts.PlutocatsToken.instance.tokenOfOwnerByIndex(wallet.address, i)
                tokenIds.push(tokenId);
            }
            await contracts.PlutocatsToken.instance.connect(wallet).setApprovalForAll(contracts.PlutocatsReserveProxy.address, true);
            
            reserveV1 = PlutocatsReserve__factory.connect(contracts.PlutocatsReserveProxy.address, deployer);

            await reserveV1.connect(wallet).quit(tokenIds);

        }
        
        wallet = deployer;


        // mint 20% of the total supply
        const totalSupply = (await contracts.PlutocatsToken.instance.adjustedTotalSupply()).toNumber();
        let enough = Math.max(Math.ceil(totalSupply / 8), 1);
        
        let tokensOwned = (await contracts.PlutocatsToken.instance.balanceOf(deployer.address)).toNumber();

        if(tokensOwned < enough){
            const gasPrice = await ethers.provider.getGasPrice();
            const multiminter = await (await ethers.getContractFactory('PlutocatsMultiTool', deployer)).deploy(contracts.PlutocatsToken.address, contracts.PlutocatsReserveProxy.address, {gasPrice});
            
            let amount = enough - tokensOwned;
            const price = await multiminter.estimateMaxPricePer(amount);
            
            await contracts.PlutocatsToken.instance.mint({ value: price });

            while(amount > 0){
                const max = Math.min(amount, 20);
                await multiminter.connect(deployer).buyMultiple(max, { value: price.mul(max) });
                amount -= max;
            }
        }
        

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
        
        await contracts.ReserveGovernor.instance.connect(wallet).propose(contractsV2.ReserveGovernorV2.address);
        
        // Vote
        await contracts.ReserveGovernor.instance.connect(wallet).vote(contractsV2.ReserveGovernorV2.address, 1);
        
        
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const eightdays = ethers.BigNumber.from((cts + (86400 * 8)));

        // Wait 8 days
        await time.increaseTo(eightdays);
        await mine(1);

        
        await contracts.ReserveGovernor.instance.connect(wallet).settleVotes(contractsV2.ReserveGovernorV2.address);
        await mine(1);

        reserveV2 = PlutocatsReserveV2__factory.connect(contracts.PlutocatsReserveProxy.address, deployer);
        

    });


    beforeEach(_beforeEach);

    describe("Only allow quits if token approval is set first", function () {
        let minted: BigNumber[] = [];
        beforeEach(async function () {
            minted = []
            await _beforeEach();
            await contractsV2.ReserveGovernorV2.instance.connect(wallet).doUpgrade()
            for (let i = 0; i < 2; i++) {
                const price = await contracts.PlutocatsToken.instance.getPrice();
                minted.push((await contracts.PlutocatsToken.instance.callStatic.mint({ value: price })));
                await contracts.PlutocatsToken.instance.mint({ value: price });
            }
        });

        it("Should fail if no approval is set", async function () {
            await expect(reserveV2.quit([minted[0]])).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
        });

        it("Should not fail if approval is set", async function () {
            await contracts.PlutocatsToken.instance.approve(reserveV2.address, minted[0]);
            await expect(reserveV2.quit([minted[0]])).to.not.be.reverted;
        });

    });

    it("It should fail if sender does not own the tokens provided", async function () {
        await contractsV2.ReserveGovernorV2.instance.connect(wallet).doUpgrade()

        let minted: BigNumber[] = [];

        for (let i = 0; i < 2; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            minted.push((await contracts.PlutocatsToken.instance.callStatic.mint({ value: price })));
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await contracts.PlutocatsToken.instance.transferFrom(wallet.address, "0x000000000000000000000000000000000000dEaD", minted[0]);

        // 0 is not owned by the sender should revert
        await expect(reserveV2.quit(minted)).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

        // approve and quit on owned tokens should work
        await contracts.PlutocatsToken.instance.setApprovalForAll(reserveV2.address, true);
        await expect(reserveV2.quit(minted.slice(1))).to.not.be.reverted;
    });

    it("It should revert if duplicate tokenIds are passed in burn", async function () {
        await contractsV2.ReserveGovernorV2.instance.connect(wallet).doUpgrade()
        
        let minted: BigNumber[] = [];

        for (let i = 0; i < 2; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            minted.push((await contracts.PlutocatsToken.instance.callStatic.mint({ value: price })));
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await expect(reserveV2.quit([minted[0]])).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

        // approve and quit should work
        await contracts.PlutocatsToken.instance.approve(reserveV2.address, minted[0]);

        // Duplicate ids passed should always revert)
        await expect(reserveV2.quit([minted[0], minted[0], minted[0]])).to.be.revertedWith("ERC721: transfer of token that is not own");
    });

    it("Only owner can set blast governor", async function () {
        await contractsV2.ReserveGovernorV2.instance.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        await expect(reserveV2.connect(s1).setGovernor(ethers.constants.AddressZero)).to.be.reverted;
    });

    it("It should calc pro rata claim correctly using adjusted supply", async function () {
        await contractsV2.ReserveGovernorV2.instance.doUpgrade()
        

        // approve and quit should work
        const minted = []

        for (let i = 0; i < 2; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            minted.push((await contracts.PlutocatsToken.instance.callStatic.mint({ value: price })));
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await contracts.PlutocatsToken.instance.approve(reserveV2.address, minted[0]);
        await expect(reserveV2.quit([minted[0]])).to.not.be.reverted;

        const startingReserveBalance = await ethers.provider.getBalance(reserveV2.address);

        const [_, s1, s2] = await ethers.getSigners();

        let catsTokenS1 = contracts.PlutocatsToken.instance.connect(s1);
        let catsTokenS2 = contracts.PlutocatsToken.instance.connect(s2);
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

        await catsTokenS1.setApprovalForAll(reserveV2.address, true);
        await catsTokenS2.setApprovalForAll(reserveV2.address, true);

        // we now have 10 tokens minted by 2 different buyers
        // if we unroll the reserve in reverse order to which tokens
        // were minted, callers should receive back equal amounts
        let rS1 = reserveV2.connect(s1);
        let rS2 = reserveV2.connect(s2);

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

        const reserveBalance = await ethers.provider.getBalance(reserveV2.address);
        
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


    /* New tests for royalty claims */

    it("It should claim royalties", async function () {
        const [_, s1] = await ethers.getSigners();
        const rS1 = reserveV2.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await mine(1);

        // Make some initial deposits
        if (CHAIN_ID != 81457){
            await blur['deposit(address)'](reserveV2.address, {value: ethers.BigNumber.from("3000000000000000000")});
        }
        
        await weth['deposit()']({value: ethers.BigNumber.from("3000000000000000000")});
        await weth.transfer(reserveV2.address, ethers.BigNumber.from("3000000000000000000"));

        const weth_balance = await weth.balanceOf(reserveV2.address);
        const blur_balance = await blur.balanceOf(reserveV2.address);

        // The balance of the reserve in blur/weth should be 3 ETH each
        expect(weth_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));
        expect(blur_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));

        const reserveFactory = await ethers.getContractFactory('PlutocatsReserveV2', wallet);
        const reserveV2Implementation: PlutocatsReserveV2 = reserveFactory.attach(contractsV2.PlutocatsReserveV2.address);

        const DEV_ADDRESS = await reserveV2Implementation.DEV_ADDRESS();
        
       
        let dev_balance = await ethers.provider.getBalance(DEV_ADDRESS);
        

        let dev_bounty = await reserveV2Implementation.DEV_BOUNTY();
        expect(dev_bounty).to.be.eq(ethers.BigNumber.from("4000000000000000000"));

        let balance = await ethers.provider.getBalance(reserveV2.address);

        // Deposit the royalties
        await contractsV2.ReserveGovernorV2.instance.connect(wallet).doUpgrade()
       
        let new_balance = await ethers.provider.getBalance(reserveV2.address);
        let new_dev_balance = await ethers.provider.getBalance(DEV_ADDRESS);

        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(reserveV2.address)).to.be.eq(0);
        expect(await blur.balanceOf(reserveV2.address)).to.be.eq(0);

        expect(new_balance).to.be.gt(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)).sub(dev_bounty));
                
        // Dev balance should increase by the dev bounty amount
        expect(new_dev_balance).to.be.eq(dev_balance.add(dev_bounty));
    });
    it("It should claim royalties if only blur available", async function () {
        await contractsV2.ReserveGovernorV2.instance.connect(wallet).doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = reserveV2.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await mine(1);

        let blur_balance = ethers.BigNumber.from(0);

        // Make some initial deposits
        if (CHAIN_ID != 81457){
            await blur['deposit(address)'](reserveV2.address, {value: ethers.BigNumber.from("3000000000000000000")});
            blur_balance = await blur.balanceOf(reserveV2.address);

            // The balance of the reserve in blur/weth should be 3 ETH each
            expect(blur_balance).to.be.gte(ethers.BigNumber.from("3000000000000000000"));
        }
        
        const weth_balance = await weth.balanceOf(reserveV2.address);
        

       
        let balance = await ethers.provider.getBalance(reserveV2.address);

        // Deposit the royalties
        await reserveV2.depositRoyalties();

        let new_balance = await ethers.provider.getBalance(reserveV2.address);
        
        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(reserveV2.address)).to.be.eq(0);
        expect(await blur.balanceOf(reserveV2.address)).to.be.eq(0);

        expect(new_balance).to.be.gte(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));
        
    });
    it("It should claim royalties if only weth available", async function () {
        await contractsV2.ReserveGovernorV2.instance.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = reserveV2.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await mine(1);

        // Make some initial deposits
        await weth['deposit()']({value: ethers.BigNumber.from("3000000000000000000")});
        await weth.transfer(reserveV2.address, ethers.BigNumber.from("3000000000000000000"));
        
        const weth_balance = await weth.balanceOf(reserveV2.address);
        const blur_balance = await blur.balanceOf(reserveV2.address);

        // The balance of the reserve in blur/weth should be 3 ETH each
        
        expect(weth_balance).to.be.eq(ethers.BigNumber.from("3000000000000000000"));


        let balance = await ethers.provider.getBalance(reserveV2.address);

        // Deposit the royalties
        await reserveV2.depositRoyalties();

        let new_balance = await ethers.provider.getBalance(reserveV2.address);
        
        // There should no longer be any royalties in the reserve
        expect(await weth.balanceOf(reserveV2.address)).to.be.eq(0);
        expect(await blur.balanceOf(reserveV2.address)).to.be.eq(0);

        expect(new_balance).to.be.gt(balance);

        expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));
        
    });
    it("It should claim royalties every time", async function () {
        await contractsV2.ReserveGovernorV2.instance.doUpgrade()

        const [_, s1] = await ethers.getSigners();
        const rS1 = reserveV2.connect(s1);

        // Mint some tokens
        
        for (let i = 0; i < 10; i++) {
            const price = await contracts.PlutocatsToken.instance.getPrice();
            await contracts.PlutocatsToken.instance.mint({ value: price });
        }

        await mine(1);


        for (let i=0; i>10; i++){
            let blur_amt = ethers.utils.parseEther((Math.random() * 1.5 + 0.5).toFixed(18).toString());
            let weth_amt = ethers.utils.parseEther((Math.random() * 1.5 + 0.5).toFixed(18).toString());
            await weth['deposit()']({value: weth_amt});
            await weth.transfer(reserveV2.address, weth_amt);
            await blur['deposit(address)'](reserveV2.address, {value: blur_amt});

            const weth_balance = await weth.balanceOf(reserveV2.address);
            const blur_balance = await blur.balanceOf(reserveV2.address);

            expect(blur_balance).to.be.eq(blur_amt);
            expect(weth_balance).to.be.eq(weth_amt);

            let balance = await ethers.provider.getBalance(reserveV2.address);

            await reserveV2.depositRoyalties();

            let new_balance = await ethers.provider.getBalance(reserveV2.address);
            
            expect(await weth.balanceOf(reserveV2.address)).to.be.eq(0);
            expect(await blur.balanceOf(reserveV2.address)).to.be.eq(0);

            expect(new_balance).to.be.eq(balance.add(weth_balance.add(blur_balance)));


        }
        
    });
    it("It can claim gas from all managed contracts", async function () {
        if (CHAIN_ID != 81457){
            this.skip();
        }
        const reserveBalance = await ethers.provider.getBalance(reserveV2.address);
        await contractsV2.ReserveGovernorV2.instance.doUpgrade()
        
        await contractsV2.ReserveGovernorV2.instance.claimMaxGas();
        const newReserveBalance = await ethers.provider.getBalance(reserveV2.address);
        expect(newReserveBalance).to.be.gt(reserveBalance);
    });

});

