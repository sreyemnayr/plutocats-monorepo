import config from './hardhat.config'

export default {
    ...config,
    networks: {
        ...config.networks,
        hardhat: {
            initialBaseFeePerGas: 0,
            forking: {
                enabled: true,
                url: process.env?.BLAST_MAINNET_RPC_URL || 'https://rpc.blast.io',
                blockNumber: 7334235,
            },
        },
    }
}