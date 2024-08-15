import { task, types } from 'hardhat/config';
import { DeployedContract } from './types';
import { MarketMultiBuyer } from '../typechain';
import promptjs from 'prompt';

task('deploy-multibuyer', 'Deploys the market multi-buyer utility')
    .addParam('plutocats', 'The address of the plutocats contract', process.env.PLUTOCATS_TOKEN, types.string, true)
    .addParam('reserve', 'The address of the reserve contract', process.env.PLUTOCATS_RESERVE_PROXY, types.string, true)
    .addParam('deployment', 'The address of the deployment', undefined, types.string, true)
    .setAction(async ({ plutocats, reserve, deployment }, { ethers, network, run }) => {
        const [deployer] = await ethers.getSigners();
        const bal = await ethers.provider.getBalance(deployer.address);

        if(!plutocats){
            plutocats = process.env.PLUTOCATS_TOKEN;
        }
        if(!reserve){
            reserve = process.env.PLUTOCATS_RESERVE_PROXY;
        }

        const marketBuyerFactory = await ethers.getContractFactory('MarketMultiBuyer', deployer);
        let marketBuyerContract: MarketMultiBuyer;

        if(!deployment){
            console.log('deploy market multi-buyer');
            console.log('deployer', deployer.address, 'plutocats', plutocats, 'reserve', reserve);
            console.log('balance', bal);

            promptjs.start();
            const result = await promptjs.get([
                {
                    properties: {
                        confirm: {
                            pattern: /^(Y|y)$/,
                            description:
                                'Type "Y" to confirm deployment.',
                        },
                    },
                },
            ]);

            if (result.confirm !== 'Y' && result.confirm !== 'y') {
                console.log(`Exiting...`);
                return;
            }

            
            marketBuyerContract = await marketBuyerFactory.deploy(plutocats, reserve,);

            await marketBuyerContract.deployed();

        } else {
            marketBuyerContract = await ethers.getContractAt('MarketMultiBuyer', deployment);
        }

        await run('verify:verify', {
            name: 'MarketMultiBuyer',
            address: marketBuyerContract.address,
            constructorArguments: [plutocats, reserve],
            instance: marketBuyerContract,
            libraries: {}
        });
        

        console.log('MarketBuyer deployed to:', marketBuyerContract.address);
    });
