import { ethers, network } from "hardhat";
import { BaseContract, BigNumber, ContractFactory, ContractTransaction } from "ethers";

export interface DeployedContracts {
  FRAX: string,
  TEMPLE: string
  FXS: string
  TREASURY: string,
  TREASURY_MANAGEMENT: string,

  TEMPLE_V2_PAIR: string,
  TEMPLE_V2_ROUTER: string,

  MULTISIG: string,

  STAX_TOKEN: string,
  STAX_STAKING: string,
  REWARDS_MANAGER: string,
  FXS_GAUGE_CONTROLLER: string,
  FRAX_TEMPLE_UNIFIED_FARM: string,
  CURVE_POOL: string,
  CURVE_FACTORY: string,
  CURVE_POOL_IMPLEMENTATION: string,
  LIQUIDITY_OPS: string,
  LOCKER_PROXY: string,
  VEFXS: string,
  TEMP_REWARD_DISTRIBUTOR: string,
  TEMP_REWARD_OPS: string,
  VEFXS_PROXY: string,
  SMART_WALLET_WHITELIST: string
}

export interface PolygonContracts {
  SANDALWOOD_TOKEN: string,
  OPENING_CEREMONY_QUEST: string,
}

export const DEPLOYED_CONTRACTS: {[key: string]: DeployedContracts} = {
  rinkeby: {

    // From network/environment
    FRAX: '0x5eD8BD53B0c3fa3dEaBd345430B1A3a6A4e8BD7C',  // Uses DAI as a proxy for TEMPLE (which we can mint)
    FXS: '0x10A8faD8367bd2598bf47A54F3394EE7Eec904B4',
    // Active contracts
    TEMPLE: '0x359655dcB8A32479680Af81Eb38eA3Bb2B42Af54',
    TREASURY: '0xA443355cE4F9c1AA6d68e057a962E86E071B0ed3',

    // currently not configured, need to swap treasury owner via
    // multisig. Test on rinkeby before doing the same on mainnet
    TREASURY_MANAGEMENT: '0xB9A7F07f5D0ea3AFa454486cffe39ceFec8e136C',
    TEMPLE_V2_PAIR: '0x57fd5b0CcC0Ad528050a2D5e3b3935c08F058Dca',  // TEMPLE/DAI as proxy for TEMPLE/FRAX
    TEMPLE_V2_ROUTER: '0xb50341AF85763d2D997F4ba764EbBdfAeeC0E07d',

    MULTISIG: '0x577BB87962b76e60d3d930c1B9Ddd6DFD64d24A2',

    // staking
    STAX_STAKING: '0x984278F08FF2158A9c39615F216DAc8E1b39b1F8',
    STAX_TOKEN: '0xE59d5940e7E5c09b9aE8a31c66fDdD7d85d99A1f',
    REWARDS_MANAGER: '0x94A4248723AAAAb83F45e9A56c448A10ca0cCe9f',
    TEMP_REWARD_DISTRIBUTOR: '0x7557Bb8586b87cAB8Ae0A9b92aE8e6FaAB3CB109',
    TEMP_REWARD_OPS: '0x11d23F25723F0e8E675e8CAA8727Cf3cc6AcC43B',

    // liqudity ops
    LIQUIDITY_OPS: '0xA151e97Fd1721dD0768C10620668f2eaB763bb83',
    LOCKER_PROXY: '0xD472864E88227F092ba85E716c63ed3760448F7A', 

    // FXS
    FXS_GAUGE_CONTROLLER: '0x370eB2c1747a087c1798440cb42C4dddd838b430',
    FRAX_TEMPLE_UNIFIED_FARM: '0x64cA87224370c4a732B863b6950CD1f8fbD91d29',
    VEFXS: '0xf71E122f053fFE38E4D72F2ea855578D04c81458',
    VEFXS_PROXY: '0xC2163d8Fe49002cD5C28C22C914fe003805A8a98',
    SMART_WALLET_WHITELIST: '0x0E3e6cCc93B6994F12Ca9aFA4f5E0aFC14f5fbb9',

    // CURVE
    CURVE_POOL: '0x4d368172cBd01d7690F5665914560f8da9451f46', 
    CURVE_POOL_IMPLEMENTATION: '0x481A6fa618FD12868FcAd336ebF34649fE06abC2',
    CURVE_FACTORY: '0xD3D0E404D8BaFcBFa7aba5B2Fae6429323FA3be7',
  },
  mainnet: {
    // Existing mainnet contracts
    MULTISIG: '0x8c2D06e11ca4414e00CdEa8f28633A2edAf79499',

    FXS: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0',
    TEMPLE_V2_PAIR: '0x6021444f1706f15465bEe85463BCc7d7cC17Fc03',
    FRAX_TEMPLE_UNIFIED_FARM: '0x10460d02226d6ef7B2419aE150E6377BdbB7Ef16',
    CURVE_FACTORY: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    FXS_GAUGE_CONTROLLER: '0x3669C421b77340B2979d1A00a792CC2ee0FcE737',
    VEFXS: '0xc8418aF6358FFddA74e09Ca9CC3Fe03Ca6aDC5b0',
    SMART_WALLET_WHITELIST: '0x53c13BA8834a1567474b19822aAD85c6F90D9f9F',

    // New STAX contracts - to fill in.
    STAX_TOKEN: '',
    CURVE_POOL: '',
    STAX_STAKING: '',
    REWARDS_MANAGER: '',
    LIQUIDITY_OPS: '',
    LOCKER_PROXY: '',
    VEFXS_PROXY: '0xdf291abc418B074CF7Ec304C1608aA5346e4e10B',

    // Unused in mainnet deploy:
    TEMP_REWARD_DISTRIBUTOR: '',
    TEMP_REWARD_OPS: '',

    CURVE_POOL_IMPLEMENTATION: '',
    TEMPLE_V2_ROUTER: '',
    TEMPLE: '',
    TREASURY: '',
    TREASURY_MANAGEMENT: '',
    FRAX: '',
  },
  localhost: {
    // STAX contracts are deterministic when forking mainnet with:
    //   npx hardhat node --fork-block-number 14702622 --fork "https://eth-mainnet.alchemyapi.io/v2/XXX"
    
    // Existing mainnet contracts
    MULTISIG: '0x4D6175d58C5AceEf30F546C0d5A557efFa53A950',
    FXS: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0',
    TEMPLE_V2_PAIR: '0x6021444f1706f15465bEe85463BCc7d7cC17Fc03',
    FRAX_TEMPLE_UNIFIED_FARM: '0x10460d02226d6ef7B2419aE150E6377BdbB7Ef16',
    CURVE_FACTORY: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    FXS_GAUGE_CONTROLLER: '0x3669C421b77340B2979d1A00a792CC2ee0FcE737',
    VEFXS: '0xc8418aF6358FFddA74e09Ca9CC3Fe03Ca6aDC5b0',
    SMART_WALLET_WHITELIST: '0x53c13BA8834a1567474b19822aAD85c6F90D9f9F',

    // New STAX contracts - to fill in.
    STAX_TOKEN: '0xaB7B4c595d3cE8C85e16DA86630f2fc223B05057',
    CURVE_POOL: '0xd5d3efC90fFB38987005FdeA303B68306aA5C624',
    STAX_STAKING: '0x045857BDEAE7C1c7252d611eB24eB55564198b4C',
    REWARDS_MANAGER: '0x2b5A4e5493d4a54E717057B127cf0C000C876f9B',
    LIQUIDITY_OPS: '0x413b1AfCa96a3df5A686d8BFBF93d30688a7f7D9',
    LOCKER_PROXY: '0x02df3a3F960393F5B349E40A599FEda91a7cc1A7',
    VEFXS_PROXY: '0x821f3361D454cc98b7555221A06Be563a7E2E0A6',

    // Unused in mainnet deploy:
    CURVE_POOL_IMPLEMENTATION: '',
    TEMPLE_V2_ROUTER: '',
    TEMPLE: '',
    TREASURY: '',
    TREASURY_MANAGEMENT: '',
    FRAX: '',
    TEMP_REWARD_OPS: '',
    TEMP_REWARD_DISTRIBUTOR: '',
  }
}

/**
 * Current block timestamp
 */
export const blockTimestamp = async () => {
  return (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
}

/** number to attos (what all our contracts expect) */
export function toAtto(n: number): BigNumber {
  return ethers.utils.parseEther(n.toString());
}

/** number from attos (ie, human readable) */
export function fromAtto(n: BigNumber): number {
  return Number.parseFloat(ethers.utils.formatUnits(n, 18));
}

export async function mine(tx: Promise<ContractTransaction>) {
  console.log(`Mining transaction: ${(await tx).hash}`);
  await (await tx).wait();
}

/**
 * Typesafe helper that works on contract factories to create, deploy, wait till deploy completes
 * and output useful commands to setup etherscan with contract code
 */
export async function deployAndMine<T extends BaseContract, D extends (...args: any[]) => Promise<T>>(
                name: string,
                factory: ContractFactory,
                deploy: D,
                ...args: Parameters<D>): Promise<T> {

  if (factory.deploy !== deploy) {
    throw new Error("Contract factory and deploy method don't match");
  }

  const renderedArgs: string = args.map(a => a.toString()).join(' ');

  console.log(`*******Deploying ${name} on ${network.name} with args ${renderedArgs}`);
  const contract = await factory.deploy(...args) as T;
  console.log(`Deployed... waiting for transaction to mine: ${contract.deployTransaction.hash}`);
  console.log();
  await contract.deployed();
  console.log('Contract deployed');
  console.log(`${name}=${contract.address}`);
  console.log(`export ${name}=${contract.address}`);
  console.log(`yarn hardhat verify --network ${network.name} ${contract.address} ${renderedArgs}`);
  console.log('********************\n');

  return contract;
}

/**
 * Check if process.env.MAINNET_ADDRESS_PRIVATE_KEY (required when doing deploy)
 */
export function expectAddressWithPrivateKey() {
  if (network.name == 'mainnet' && !process.env.MAINNET_ADDRESS_PRIVATE_KEY) {
    throw new Error("Missing environment variable MAINNET_ADDRESS_PRIVATE_KEY. A mainnet address private key with eth is required to deploy/manage contracts");
  }

  if (network.name == 'rinkeby' && !process.env.RINKEBY_ADDRESS_PRIVATE_KEY) {
    throw new Error("Missing environment variable RINKEBY_ADDRESS_PRIVATE_KEY. A mainnet address private key with eth is required to deploy/manage contracts");
  }
}

const expectedEnvvars: {[key: string]: string[]} = {
  mainnet: ['MAINNET_ADDRESS_PRIVATE_KEY', 'MAINNET_RPC_URL', 'MAINNET_GAS_IN_GWEI'],
  rinkeby: ['RINKEBY_ADDRESS_PRIVATE_KEY', 'RINKEBY_RPC_URL'],
  matic: ['MATIC_ADDRESS_PRIVATE_KEY', 'MATIC_RPC_URL'],
  localhost: [],
}

/**
 * Check if the required environment variables exist
 */
export function ensureExpectedEnvvars() {
  let hasAllExpectedEnvVars = true;
  for (const envvarName of expectedEnvvars[network.name]) {
    if (!process.env[envvarName]) {
      console.error(`Missing environment variable ${envvarName}`);
      hasAllExpectedEnvVars = false;
    }
  }

  if (!hasAllExpectedEnvVars) {
    throw new Error(`Expected envvars missing`);
  }
}

export function getDeployedContracts(): DeployedContracts {
  if (DEPLOYED_CONTRACTS[network.name] === undefined) {
    console.log(`No contracts configured for ${network.name}`);
    throw new Error(`No contracts configured for ${network.name}`);
  } else {
    return DEPLOYED_CONTRACTS[network.name];
  }
}