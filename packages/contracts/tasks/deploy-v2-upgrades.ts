import { task, types } from 'hardhat/config';
import { ContractDeployment, UpgradedContractName, DeployedContract } from './types';
import promptjs from 'prompt';
import { printContractsTable } from './utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

task('deploy-v2-upgrades', 'Deploys the governor and reserve v2')
    .addParam('governor', 'The address of the existing governor contract', undefined, types.string, false)
    .addParam('blurPoolAddress', 'The address of the existing blur pool contract', undefined, types.string, false)
    .addParam('wethAddress', 'The address of the existing weth contract', undefined, types.string, false)
    .addParam('blastAddress', 'The address of the existing blast contract', undefined, types.string, false)
    .addFlag('autodeploy', 'Deploy all contracts without user interaction')
    .addFlag('local', 'Deploy contracts locally')
    .addOptionalParam('onlylatest', 'Use only the latest governor and reserve contracts', true, types.boolean)
    .addOptionalParam('forked', 'Forked mainnet', false, types.boolean)
    //.addOptionalParam('verify', 'Verify contracts on etherscan', false, types.boolean)
    .addOptionalParam(
        'silent',
        'Disable logging',
        false,
        types.boolean,
    )
    .setAction(async ({ autodeploy, governor, blurPoolAddress, wethAddress, blastAddress, silent, onlylatest, local, forked }, { run, ethers, network }) => {
        let deployer: SignerWithAddress;
        
        const PLUTOCATS_DEPLOYER = forked ? process.env.PLUTOCATS_DEPLOYER || (await ethers.getSigners())[0].address : (await ethers.getSigners())[0].address;
        
        if(forked) {
            deployer = await ethers.getImpersonatedSigner(PLUTOCATS_DEPLOYER);
            
            await network.provider.send("hardhat_setBalance", [
                PLUTOCATS_DEPLOYER,
                "0x56bc75e2d63100000", // 100 ETH should be plenty
                ]);
            
        } else {
            deployer = await ethers.getSigner(PLUTOCATS_DEPLOYER);
            
        }

        const deployment: Record<UpgradedContractName, DeployedContract> = {} as Record<
            UpgradedContractName,
            DeployedContract
        >;

        if (!silent) {
            console.log('deploy governor and reserve v2');
            console.log('deployer', deployer.address, 'governor', governor);
        }

        if (!autodeploy) {
            promptjs.start();
            const result = await promptjs.get([
                {
                    properties: {
                        confirm: {
                            pattern: /^(Y)$/,
                            description:
                                'Type "Y" to confirm deployment.',
                        },
                    },
                },
            ]);

            if (result.confirm !== 'Y') {
                console.log(`Exiting...`);
                return;
            }
        }

        let gasPrice = await ethers.provider.getGasPrice();
        const gasInGwei = Math.round(Number(ethers.utils.formatUnits(gasPrice, 'gwei')));

        if (!autodeploy) {
            const gasResult = await promptjs.get([
                {
                    properties: {
                        gasPrice: {
                            type: 'integer',
                            required: true,
                            description: 'Enter a gas price (gwei)',
                            default: gasInGwei,
                        },
                    },
                },
            ]);
            gasPrice = ethers.utils.parseUnits(gasResult.gasPrice.toString(), 'gwei');
        }

        const reserveFactory = await ethers.getContractFactory('PlutocatsReserveV2', deployer);
        const reserveContract = await reserveFactory.deploy({gasPrice,});

        

        const governorFactory = await ethers.getContractFactory('ReserveGovernorV2', deployer);
        const governorContract = await governorFactory.deploy(governor, reserveContract.address, blurPoolAddress, wethAddress, blastAddress, { gasPrice,});
        await governorContract.deployed();

        

        deployment.PlutocatsReserveV2 = {
            name: 'PlutocatsReserveV2',
            instance: reserveContract,
            address: reserveContract.address,
            constructorArguments: [],
            libraries: {},
        };

        deployment.ReserveGovernorV2 = {
            name: 'ReserveGovernorV2',
            instance: governorContract,
            address: governorContract.address,
            constructorArguments: [governor, reserveContract.address, blurPoolAddress, wethAddress],
            libraries: {},
        };

        if (!onlylatest) {
            const reserveFactoryA = await ethers.getContractFactory('PlutocatsReserveV2A', deployer);
            const reserveContractA = await reserveFactoryA.deploy({gasPrice,});

            const governorContractA = await governorFactory.deploy(governor, reserveContractA.address, blurPoolAddress, wethAddress, blastAddress, { gasPrice,});
            await governorContractA.deployed();

            deployment.PlutocatsReserveV2A = {
                name: 'PlutocatsReserveV2A',
                instance: reserveContractA,
                address: reserveContractA.address,
                constructorArguments: [],
                libraries: {},
            };

            deployment.ReserveGovernorV2A = {
                name: 'ReserveGovernorV2A',
                instance: governorContractA,
                address: governorContractA.address,
                constructorArguments: [governor, reserveContractA.address, blurPoolAddress, wethAddress],
                libraries: {},
            };
        }

        if (!local) {
            const result = await promptjs.get([
                {
                    properties: {
                        confirm: {
                            pattern: /^(Y)$/,
                            description:
                                'Type "Y" verify contracts.',
                        },
                    },
                },
            ]);

            if (result.confirm !== 'Y') {
                console.log(`Exiting...`);
                return;
            }

            // Verify the contracts on Etherscan
            console.log('verify contracts');

            // fs.writeFileSync('./contracts.json', JSON.stringify({ contracts }, null, 2), 'utf-8');
            await run('verify-etherscan', {
                deployment,
            });
        }
        

        if (!silent) {
            printContractsTable(deployment);
        }

        return deployment;
    });
