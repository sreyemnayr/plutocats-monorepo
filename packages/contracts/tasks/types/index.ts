import { Contract } from 'ethers';
import { 
    NFTDescriptorV2, 
    PlutocatsDescriptor, 
    SVGRenderer, 
    PlutocatsArt, 
    Inflator,
    PlutocatsSeeder,
    PlutocatsToken,
    PlutocatsReserve,
    MockBlast,
    PlutocatsReserveProxy,
    ReserveGovernor,
    PlutocatsReserveV2,
    ReserveGovernorV2,
} from '../../typechain';

export enum ChainId {
    Mainnet = 1,
    Local = 31337,
}

export type PlutocatsDescriptorContractNames = 'NFTDescriptorV2' | 'PlutocatsDescriptor' | 'SVGRenderer' | 'PlutocatsArt' | 'Inflator';
// prettier-ignore
export type ContractName = PlutocatsDescriptorContractNames | 'PlutocatsSeeder' | 'PlutocatsToken' | 'PlutocatsReserve' | 'MockBlast' | 'PlutocatsReserveProxy' | 'ReserveGovernor';

export type UpgradedContractName = 'PlutocatsReserveV2' | 'ReserveGovernorV2';

export type ContractType = NFTDescriptorV2 | PlutocatsDescriptor | SVGRenderer | PlutocatsArt | Inflator | PlutocatsSeeder | PlutocatsToken | PlutocatsReserve | MockBlast | PlutocatsReserveProxy | ReserveGovernor | PlutocatsReserveV2 | ReserveGovernorV2;

export interface ContractDeployment {
    args?: (string | number | (() => string))[];
    libraries?: () => Record<string, string>;
    waitForConfirmation?: boolean;
    validateDeployment?: () => void;
}

export interface DeployedContract {
    name: string;
    address: string;
    instance: Contract;
    constructorArguments: (string | number)[];
    libraries: Record<string, string>;
}

export interface TypedDeployedContract<T extends ContractType> {
    name: string;
    address: string;
    instance: T;
    constructorArguments: (string | number)[];
    libraries: Record<string, string>;
}

export interface ContractRow {
    Address: string;
    'Deployment Hash'?: string;
}

export interface OriginalContracts {
    NFTDescriptorV2: TypedDeployedContract<NFTDescriptorV2>;
    PlutocatsDescriptor: TypedDeployedContract<PlutocatsDescriptor>;
    SVGRenderer: TypedDeployedContract<SVGRenderer>;
    PlutocatsArt: TypedDeployedContract<PlutocatsArt>;
    Inflator: TypedDeployedContract<Inflator>;
    PlutocatsSeeder: TypedDeployedContract<PlutocatsSeeder>;
    PlutocatsToken: TypedDeployedContract<PlutocatsToken>;
    PlutocatsReserve: TypedDeployedContract<PlutocatsReserve>;
    MockBlast: TypedDeployedContract<MockBlast>;
    PlutocatsReserveProxy: TypedDeployedContract<PlutocatsReserveProxy>;
    ReserveGovernor: TypedDeployedContract<ReserveGovernor>;
}

export interface UpgradedContracts {
    PlutocatsReserveV2: TypedDeployedContract<PlutocatsReserveV2>;
    ReserveGovernorV2: TypedDeployedContract<ReserveGovernorV2>;
}

