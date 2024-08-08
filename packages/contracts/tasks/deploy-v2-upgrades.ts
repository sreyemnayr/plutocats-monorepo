import { task, types } from 'hardhat/config';
import { ContractDeployment, UpgradedContractName, DeployedContract } from './types';
import promptjs from 'prompt';
import { printContractsTable } from './utils';

task('deploy-v2-upgrades', 'Deploys the governor and reserve v2')
    .addParam('governor', 'The address of the existing governor contract', undefined, types.string, false)
    .addParam('blurPoolAddress', 'The address of the existing blur pool contract', undefined, types.string, false)
    .addParam('wethAddress', 'The address of the existing weth contract', undefined, types.string, false)
    .addFlag('autodeploy', 'Deploy all contracts without user interaction')
    .addOptionalParam(
        'silent',
        'Disable logging',
        false,
        types.boolean,
    )
    .setAction(async ({ autodeploy, governor, blurPoolAddress, wethAddress, silent }, { ethers, network }) => {
        const [deployer] = await ethers.getSigners();
        const bal = await ethers.provider.getBalance(deployer.address);

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
        const governorContract = await governorFactory.deploy(governor, reserveContract.address, blurPoolAddress, wethAddress, { gasPrice,});
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

        if (!silent) {
            printContractsTable(deployment);
        }

        return deployment;
    });
