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

describe("MultiBuyer", function () {
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

    it("Mints multiple tokens", async function () {
        const priceSingle = await plutocatsToken.getPrice();
        await plutocatsToken.mint({ value: priceSingle });

        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const twoDays = ethers.BigNumber.from((cts + (86400 * 2)));
        await time.increaseTo(twoDays);
        await mine(1);

        const tokenBalance = await plutocatsToken.balanceOf(wallet.address);
        const tokensToMint = 10;
        const price = await multiminter.estimateMaxPricePer(tokensToMint);
        await multiminter.buyMultiple(tokensToMint, { value: price.mul(tokensToMint) });
        const newTokenBalance = await plutocatsToken.balanceOf(wallet.address);
        expect(newTokenBalance).to.equal(tokenBalance.add(tokensToMint));
        
    });

    it("Can recycle mint/quit for multiple tokens", async function () {
        const priceSingle = await plutocatsToken.getPrice();
        await plutocatsToken.mint({ value: priceSingle });

        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const twoDays = ethers.BigNumber.from((cts + (86400 * 2)));
        await time.increaseTo(twoDays);
        await mine(1);

        const tokenBalance = await plutocatsToken.balanceOf(wallet.address);
        const totalSupply = await plutocatsToken.totalSupply();
        const adjustedTotalSupply = await plutocatsToken.adjustedTotalSupply();
        const ethBalance = await ethers.provider.getBalance(wallet.address);


        const tokensToMint = 10;
        const price = await multiminter.estimateMaxPricePer(tokensToMint);
        
        const gasPrice = await ethers.provider.getGasPrice();
        const tx = await multiminter.recycleMultiple(tokensToMint, { value: price.mul(tokensToMint), gasPrice });
        const gasEstimate = tx.gasLimit.mul(gasPrice);
        const newTotalSupply = await plutocatsToken.totalSupply();
        const newAdjustedTotalSupply = await plutocatsToken.adjustedTotalSupply();
        const newEthBalance = await ethers.provider.getBalance(wallet.address);

        expect(newTotalSupply).to.equal(totalSupply.add(tokensToMint));
        expect(newAdjustedTotalSupply).to.equal(adjustedTotalSupply);
        const newTokenBalance = await plutocatsToken.balanceOf(wallet.address);
        expect(newTokenBalance).to.equal(tokenBalance);
        
        expect(newEthBalance).to.be.closeTo(ethBalance, gasEstimate);
        
    });

    it("Can catch the VRGDA up when it has fallen behind", async function () {
        const priceSingle = await plutocatsToken.getPrice();
        await plutocatsToken.mint({ value: priceSingle });
        
        const cts = (await ethers.provider.getBlock('latest')).timestamp;
        const twoDays = ethers.BigNumber.from((cts + (86400 * 2)));
        await time.increaseTo(twoDays);
        await mine(1);

        const tokenBalance = await plutocatsToken.balanceOf(wallet.address);
        const tokensToMint = 10;
        let startPrice = await plutocatsToken.getPrice();
        let currentPrice = startPrice;
        let price = await multiminter.estimateMaxPricePer(tokensToMint);
        await multiminter.buyMultiple(tokensToMint, { value: price.mul(tokensToMint) });
        
        

        let enough = 0;

        await ethers.provider.send("evm_setIntervalMining", [0]);
        await ethers.provider.send("evm_setAutomine", [false]);
        // Every 21 days, mint enough to increase the mint price.
        for(let i = 0; i < 3; i++){
            enough = (await multiminter.estimateMaxAtCurrentPrice()).toNumber() - 1;

            console.log("Enough: ", enough);

            if(i > 0){
                expect(enough).to.be.gte(200);
                price = await multiminter.estimateMaxPricePer(enough);
                let promises = []
                while(enough > 0){
                    const max = Math.min(enough, 40);
                    console.log("Recycling: ", max);
                    promises.push(multiminter.connect(wallet).recycleMultiple(max, { value: price }));
                    enough -= max;
                }
                promises.push(plutocatsToken.mint({ value: currentPrice }));
                promises.push(plutocatsToken.mint({ value: currentPrice }));
                await Promise.all(promises);
                await mine(4);
            }
            
            
            
            currentPrice = await plutocatsToken.getPrice();
            expect(currentPrice).to.be.gte(startPrice);

            startPrice = currentPrice;

            // Go 21 days into the future - the contract will expect to have ~210 more tokens minted
            console.log("Time traveling")
            const cts = (await ethers.provider.getBlock('latest')).timestamp;
            const twentyOneDays = ethers.BigNumber.from((cts + (86400 * 21)));
            await time.increaseTo(twentyOneDays);
            await mine(1);

        }
        await ethers.provider.send("evm_setAutomine", [true]);

        
        


    });

    
});