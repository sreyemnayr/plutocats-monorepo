import { ContractDeployment, ContractName, DeployedContract } from './types';
import { task, types } from 'hardhat/config';
import promptjs from 'prompt';
import { printContractsTable } from './utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BLAST_BYTECODE } from '../predeployed';
import { PlutocatsReserve__factory } from '../typechain';
// import { impersonateAccount } from '@nomicfoundation/hardhat-network-helpers';

promptjs.colors = false;
promptjs.message = '> ';
promptjs.delimiter = '';

// get the encoded data for UUPS proxy initilization.
function getInitializerData(contractInterface: any, args: any) {
    const initializer = 'initialize';
    const fragment = contractInterface.getFunction(initializer);
    return contractInterface.encodeFunctionData(fragment, args);
}

task('load', 'Loads deployed contracts')
    .addOptionalParam('testing', 'Test mode', false, types.boolean)
    .setAction(async ({testing}, { ethers, network }) => {
        const deployment: Record<ContractName, DeployedContract> = {} as Record<
                ContractName,
                DeployedContract
            >;
        let deployer: SignerWithAddress;
        let operator: SignerWithAddress;

        const PLUTOCATS_DEPLOYER = process.env.PLUTOCATS_DEPLOYER || (await ethers.getSigners())[0].address;
        const BLAST_POINTS_OPERATOR = process.env.BLAST_POINTS_OPERATOR || (await ethers.getSigners())[1].address;
        

        if(testing) {
            await network.provider.send("hardhat_setCode", [process.env.BLAST_PREDEPLOY, BLAST_BYTECODE]);
            deployer = await ethers.getImpersonatedSigner(PLUTOCATS_DEPLOYER);
            operator = await ethers.getImpersonatedSigner(BLAST_POINTS_OPERATOR);
            await network.provider.send("hardhat_setBalance", [
                PLUTOCATS_DEPLOYER,
                "0x21e19e0c9bab2400000", // 100 ETH should be plenty
                ]);
            
        } else {
            deployer = await ethers.getSigner(PLUTOCATS_DEPLOYER);
            operator = await ethers.getSigner(BLAST_POINTS_OPERATOR);
        }
        
        const contracts: Record<ContractName, DeployedContract> = {
            MockBlast: {
                address: process.env.BLAST_PREDEPLOY || '',
            },
            NFTDescriptorV2: {
                address: process.env.NFT_DESCRIPTOR_V2 || '',
            },
            SVGRenderer: {
                address: process.env.SVG_RENDERER || '',
            },
            PlutocatsDescriptor: {
                address: process.env.PLUTOCATS_DESCRIPTOR || '',
                constructorArguments: [process.env.PLUTOCATS_ART || '', process.env.SVG_RENDERER || ''],
                libraries: {NFTDescriptorV2: process.env.NFT_DESCRIPTOR_V2 || ''} as Record<string,string>,
            },
            Inflator: {
                address: process.env.INFLATOR || '',
            },
            PlutocatsArt: {
                address: process.env.PLUTOCATS_ART || '',
                constructorArguments: [process.env.PLUTOCATS_DESCRIPTOR || '', process.env.INFLATOR || '']
            },
            PlutocatsSeeder: {
                address: process.env.PLUTOCATS_SEEDER || '',
            },
            PlutocatsToken: {
                address: process.env.PLUTOCATS_TOKEN || '',
                constructorArguments: [1710445629, process.env.PLUTOCATS_RESERVE || '', process.env.PLUTOCATS_DESCRIPTOR || '', process.env.PLUTOCATS_SEEDER || '', true, process.env.MOCK_BLAST || '']
            },
            PlutocatsReserve: {
                address: process.env.PLUTOCATS_RESERVE || '',
            },
            PlutocatsReserveProxy: {
                address: process.env.PLUTOCATS_RESERVE_PROXY || '',
                constructorArguments: [process.env.PLUTOCATS_RESERVE || '', getInitializerData(PlutocatsReserve__factory.connect(process.env.PLUTOCATS_RESERVE || '', deployer).interface, [process.env.PLUTOCATS_TOKEN || '', process.env.RESERVE_GOVERNOR || '', process.env.BLAST_PREDEPLOY || '', process.env.BLAST_POINTS || '', BLAST_POINTS_OPERATOR])]
            },
            ReserveGovernor: {
                address: process.env.RESERVE_GOVERNOR || '',
                constructorArguments: [process.env.PLUTOCATS_TOKEN || '', process.env.PLUTOCATS_DESCRIPTOR || '', process.env.PLUTOCATS_RESERVE_PROXY || '', 1000]
            },
        } as Record<ContractName, DeployedContract>;


        for (const [name, contract] of Object.entries(contracts)) {
            
            const factory = await ethers.getContractFactory(name, {
                signer: deployer,
                libraries: contract?.libraries || {},
            });

            const deployedContract = await factory.attach(contract.address);

            deployment[name as ContractName] = {
                ...contract,
                name,
                instance: deployedContract,
            };

        }

        return deployment;
    });