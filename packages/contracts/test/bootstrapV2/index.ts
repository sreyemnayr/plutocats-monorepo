import chai from 'chai';
import { ethers, run } from 'hardhat';
import { solidity } from 'ethereum-waffle';
import { PlutocatsToken, PlutocatsReserve, ReserveGovernor, PlutocatsDescriptor, ReserveGovernorV2, MockWithdrawable, MockWithdrawable__factory, MarketMultiBuyer } from '../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { time, mine, reset } from "@nomicfoundation/hardhat-network-helpers";
import { ContractName, UpgradedContractName, DeployedContract } from '../../tasks/types';
import config from '../../hardhat.config';

chai.use(solidity);
const { expect } = chai;

describe("ReserveGovernor and Bootstrap process with upgrade to v2", function () {
    let plutocatsToken: PlutocatsToken;
    let plutocatsReserve: PlutocatsReserve;
    let reserveGovernor: ReserveGovernor | ReserveGovernorV2;
    let plutocatsDescriptor: PlutocatsDescriptor;
    let wallet: SignerWithAddress;
    let blur: MockWithdrawable;
    let weth: MockWithdrawable;
    let CHAIN_ID: number;
    let multiminter: MarketMultiBuyer;

    let contracts: Record<ContractName, DeployedContract>;
    let contractsV2: Record<UpgradedContractName, DeployedContract>;

    beforeEach(async function () {
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
            
            plutocatsToken = contracts.PlutocatsToken.instance as PlutocatsToken;

            
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

            await deployer.sendTransaction({to: contracts.PlutocatsReserveProxy.address, value: ethers.BigNumber.from("4300000000000000000")});
        }
        
        const tokenFactory = await ethers.getContractFactory('PlutocatsToken', deployer);
        plutocatsToken = tokenFactory.attach(contracts.PlutocatsToken.address);

        const reserveFactory = await ethers.getContractFactory('PlutocatsReserve', deployer);
        plutocatsReserve = reserveFactory.attach(contracts.PlutocatsReserveProxy.address);

        const reserveV2Factory = await ethers.getContractFactory('PlutocatsReserveV2', deployer);

        const governorFactory = await ethers.getContractFactory('ReserveGovernor', deployer);
        reserveGovernor = governorFactory.attach(contracts.ReserveGovernor.address);

        const descriptorFactory = await ethers.getContractFactory('PlutocatsDescriptor', {
            libraries: {
                NFTDescriptorV2: contracts.NFTDescriptorV2.address,
            },
            signer: deployer,
        });

        
        plutocatsDescriptor = descriptorFactory.attach(contracts.PlutocatsDescriptor.address);

        wallet = deployer;

        // weth = wethFactory.attach("0x4300000000000000000000000000000000000004");

        contractsV2 = await run('deploy-v2-upgrades', {
            autodeploy: true,
            governor: contracts.ReserveGovernor.address,
            silent: true,
            blurPoolAddress: blur.address,
            wethAddress: weth.address,
            local: true,
            blastAddress: contracts.MockBlast.address,
        });

        // mint 20% of the total supply
        const totalSupply = (await plutocatsToken.adjustedTotalSupply()).toNumber();
        let enough = Math.max(Math.ceil(totalSupply / 8), 1);
        
        let tokensOwned = (await plutocatsToken.balanceOf(deployer.address)).toNumber();

        const gasPrice = await ethers.provider.getGasPrice();
        multiminter = await (await ethers.getContractFactory('MarketMultiBuyer', deployer)).deploy(plutocatsToken.address, contracts.PlutocatsReserveProxy.address, {gasPrice});
            
        if(tokensOwned < enough){
            let amount = enough - tokensOwned;
            const price = await multiminter.estimateMaxPricePer(amount);

            await plutocatsToken.mint({ value: price });
            
            while(amount > 0){
                const max = Math.min(amount, 20);
                await multiminter.connect(deployer).buyMultiple(max, { value: price.mul(max) });
                amount -= max;
            }
        }
        


        // Propose an upgrade of the governor to the new one.
        await reserveGovernor.connect(wallet).propose(contractsV2.ReserveGovernorV2.address);
        await mine(1);

        // Vote
        await reserveGovernor.vote(contractsV2.ReserveGovernorV2.address, 1);
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const eightdays = ethers.BigNumber.from((cts + (86400 * 8)));

        // let prop = await reserveGovernor.proposal(contractsV2.ReserveGovernorV2.address, period);

        // Wait 8 days
        await time.increaseTo(eightdays);
        await mine(1);

        await reserveGovernor.settleVotes(contractsV2.ReserveGovernorV2.address);
        
        
        plutocatsReserve = reserveV2Factory.attach(contracts.PlutocatsReserveProxy.address);

        const governorFactoryV2 = await ethers.getContractFactory('ReserveGovernorV2', deployer);
        reserveGovernor = governorFactoryV2.attach(contractsV2.ReserveGovernorV2.address);

        await (reserveGovernor as ReserveGovernorV2).doUpgrade();

        let tokenBalance = await plutocatsToken.balanceOf(wallet.address);
        const tokenIds = [];
        for(let i = 0; i < tokenBalance.toNumber(); i++){
            const tokenId = await plutocatsToken.tokenOfOwnerByIndex(wallet.address, i)
            tokenIds.push(tokenId);
        }
        await plutocatsToken.connect(wallet).setApprovalForAll(plutocatsReserve.address, true);
        await plutocatsReserve.connect(wallet).quit(tokenIds);


    });

    it("All ownable contracts should have the reserve governor set as owner post deploy", async function () {
        const tokenOwner = await plutocatsToken.owner();
        const reserveOwner = await plutocatsReserve.owner();
        const descriptorOwner = await plutocatsDescriptor.owner();
        const governorOwner = await reserveGovernor.owner();

        expect(tokenOwner).to.equal(reserveGovernor.address);
        expect(reserveOwner).to.equal(reserveGovernor.address);
        expect(descriptorOwner).to.equal(reserveGovernor.address);
        expect(governorOwner).to.equal(wallet.address);
    });

    it("Only owner can propose", async function () {
        const [_, s1, s2] = await ethers.getSigners();

        await expect(reserveGovernor.connect(s1).propose(wallet.address)).to.be.reverted;
        await expect(reserveGovernor.connect(wallet).propose(s1.address)).to.not.be.reverted;

        // only one prop per period... should revert
        await expect(reserveGovernor.connect(wallet).propose(s2.address)).to.be.reverted;


        // settle created prop
        const period = await reserveGovernor.proposalPeriod();
        const prop = await reserveGovernor.proposal(s1.address, period);
        await time.increaseTo(prop.endTime.add(10));
        await reserveGovernor.connect(wallet).settleVotes(s1.address);

        await reserveGovernor.connect(wallet).transferOwnership(s1.address);
        await expect(reserveGovernor.connect(s1).propose(wallet.address)).to.not.be.reverted;
        await reserveGovernor.connect(s1).transferOwnership(wallet.address);
    });

    it("Plutocats can vote", async function () {
        const signers = await ethers.getSigners();

        let totalSupply = await plutocatsToken.adjustedTotalSupply();
        if(totalSupply.eq(0)){
            await plutocatsToken.mint({ value: await plutocatsToken.getPrice() });
            totalSupply = await plutocatsToken.adjustedTotalSupply();
        }
        let per = Math.max(Math.ceil(totalSupply.mul(15).div(100).div(5).toNumber()), 3);

        for (let i = 0; i < 5; i++) {
            // mint plutocats for each address
            let amount = per;
            const price = totalSupply.gt(0) ? await multiminter.estimateMaxPricePer(per) : await plutocatsToken.getPrice();
            while(amount > 0){
                const max = Math.min(amount, 20);
                await multiminter.connect(signers[i]).buyMultiple(max, { value: price.mul(max) });
                amount -= max;
            }
        }

        // propose a new address
        const newOwner = signers[1];
        await reserveGovernor.connect(wallet).propose(newOwner.address);
        const period = await reserveGovernor.proposalPeriod();

        // proposal settings should be correct
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const sevendays = ethers.BigNumber.from((cts + (86400 * 7)));
        const eightdays = ethers.BigNumber.from((cts + (86400 * 8)));
        const prop = await reserveGovernor.proposal(newOwner.address, period);
        expect(prop.quorum).to.be.gt(0);
        expect(prop.endTime).to.be.gte(sevendays);
        expect(prop.endTime).to.be.lt(eightdays);

        // allow voting
        for (let i = 0; i < 5; i++) {
            await reserveGovernor.connect(signers[i]).vote(newOwner.address, 1);
        }

        // settle the vote and ensure all ownership transfered
        await time.increaseTo(prop.endTime.add(10));
        await reserveGovernor.settleVotes(newOwner.address);

        // ensure that governance is forever locked
        await expect(reserveGovernor.propose(signers[0].address)).to.be.revertedWith("GovernanceLocked()");
    });

    it("Proposal quorum is properly calculated", async function () {
        const signers = await ethers.getSigners();

        // 50 mints at 10% quorum = 5 expected votes
        for (let i = 0; i < 5; i++) {
            // mint plutocats for each address
            for (let i = 0; i < 10; i++) {
                const price = await plutocatsToken.getPrice();
                await plutocatsToken.connect(signers[i]).mint({ value: price });
            }
        }

        const totalSupply = await plutocatsToken.adjustedTotalSupply();
        const quorum = totalSupply.mul(10).div(100);


        // propose a new address
        const newOwner = signers[1];
        await reserveGovernor.connect(wallet).propose(newOwner.address);
        const period = await reserveGovernor.proposalPeriod();

        // proposal settings should be correct
        const prop = await reserveGovernor.proposal(newOwner.address, period);
        expect(prop.quorum).to.be.eq(quorum);
    });

    it('Can repropose if failed and ownership is transferred after settlement', async function () {
        const signers = await ethers.getSigners();

        let totalSupply = await plutocatsToken.adjustedTotalSupply();
        if(totalSupply.eq(0)){
            await plutocatsToken.mint({ value: await plutocatsToken.getPrice() });
            totalSupply = await plutocatsToken.adjustedTotalSupply();
        }
        let per = Math.max(Math.ceil(totalSupply.mul(15).div(100).div(5).toNumber()), 3);

        for (let i = 0; i < 5; i++) {
            // mint plutocats for each address
            let amount = per;
            const price = totalSupply.gt(0) ? await multiminter.estimateMaxPricePer(per) : await plutocatsToken.getPrice();
            while(amount > 0){
                const max = Math.min(amount, 20);
                await multiminter.connect(signers[i]).buyMultiple(max, { value: price.mul(max) });
                amount -= max;
            }
        }

        // propose a new address
        const newOwner = signers[1];
        await reserveGovernor.connect(wallet).propose(newOwner.address);
        let period = await reserveGovernor.proposalPeriod();

        // proposal settings should be correct
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const sevendays = ethers.BigNumber.from((cts + (86400 * 7)));
        const eightdays = ethers.BigNumber.from((cts + (86400 * 8)));

        let prop = await reserveGovernor.proposal(newOwner.address, period);
        expect(prop.quorum).to.be.gt(0);
        expect(prop.endTime).to.be.gte(sevendays);
        expect(prop.endTime).to.be.lt(eightdays);

        // zero weight votes don't count
        await reserveGovernor.connect(signers[6]).vote(newOwner.address, 1);
        prop = await reserveGovernor.proposal(newOwner.address, period);
        expect(prop.forVotes).to.be.eq(0);

        // allow voting
        for (let i = 0; i < 5; i++) {
            await reserveGovernor.connect(signers[i]).vote(newOwner.address, 0);
        }

        // settle the vote no ownership transfered
        await time.increaseTo(prop.endTime.add(10));
        await reserveGovernor.settleVotes(newOwner.address);

        /// it should allow reproposing a new prop on failure
        await reserveGovernor.connect(wallet).propose(newOwner.address);
        period = await reserveGovernor.proposalPeriod();
        prop = await reserveGovernor.proposal(newOwner.address, period);
        await time.increaseTo(prop.endTime.add(1000));
        await expect(reserveGovernor.settleVotes(newOwner.address)).to.not.be.reverted;


        await reserveGovernor.connect(wallet).propose(newOwner.address);
        prop = await reserveGovernor.proposal(newOwner.address, period.add(1));
        for (let i = 0; i < 5; i++) {
            await reserveGovernor.connect(signers[i]).vote(newOwner.address, 1);
        }

        await time.increaseTo(prop.endTime.add(10));
        await reserveGovernor.settleVotes(newOwner.address);

        // prop is passed. governance is locked and all ownership of contracts transferred
        const govLocked = await reserveGovernor.governanceLocked();
        expect(govLocked).to.be.true;

        const dOwner = await plutocatsDescriptor.owner();
        expect(dOwner).to.be.eq(newOwner.address);
        const tOwner = await plutocatsToken.owner();
        expect(tOwner).to.be.eq(newOwner.address);
        const rOwner = await plutocatsReserve.owner();
        expect(rOwner).to.be.eq(newOwner.address);

        // new owner can transfer ownership
        expect(plutocatsReserve.connect(newOwner).transferOwnership(signers[0].address)).to.not.be.reverted;
        expect(plutocatsToken.connect(newOwner).transferOwnership(signers[0].address)).to.not.be.reverted;
        expect(plutocatsDescriptor.connect(newOwner).transferOwnership(signers[0].address)).to.not.be.reverted;
    });

    it('Vote snapshot is taken', async function () {
        const signers = await ethers.getSigners();

        for (let i = 0; i < 5; i++) {
            // mint 3 plutocats for each address
            for (let j = 0; j < 3; j++) {
                const price = await plutocatsToken.getPrice();
                await plutocatsToken.connect(signers[i]).mint({ value: price });
            }
        }

        // propose a new address
        const newOwner = signers[1];
        await reserveGovernor.connect(wallet).propose(newOwner.address);
        const period = await reserveGovernor.proposalPeriod();

        await expect(reserveGovernor.connect(signers[1]).vote(newOwner.address, 1)).to.not.be.reverted;
        let prop = await reserveGovernor.proposal(newOwner.address, period);
        expect(prop.forVotes).to.be.eq(3);

        /// Voting reverts if on a invalid address
        await expect(reserveGovernor.connect(signers[1]).vote(plutocatsToken.address, 1)).to.be.revertedWith("InvalidProposal()");

        /// Cannot vote twice
        await expect(reserveGovernor.connect(signers[1]).vote(newOwner.address, 1)).to.be.revertedWith("HasVoted()");

        await mine(30);

        // mint 3 more tokens after proposal created
        for (let i = 0; i < 3; i++) {
            const price = await plutocatsToken.getPrice();
            await plutocatsToken.connect(signers[2]).mint({ value: price });
        }

        await expect(reserveGovernor.connect(signers[2]).vote(newOwner.address, 1)).to.not.be.reverted;
        prop = await reserveGovernor.proposal(newOwner.address, period);

        // total voting for 2 people should be 6
        expect(prop.forVotes).to.be.eq(6);
    });
});