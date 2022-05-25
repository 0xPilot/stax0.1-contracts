import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';
import { LockerProxy, LockerProxy__factory } from '../../../typechain';
import {
  deployAndMine,
  DeployedContracts,
  DEPLOYED_CONTRACTS,
  ensureExpectedEnvvars,
  mine,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();

  let DEPLOYED: DeployedContracts;

  if (DEPLOYED_CONTRACTS[network.name] === undefined) {
    console.log(`No contracts configured for ${network.name}`)
    return;
  } else {
    DEPLOYED = DEPLOYED_CONTRACTS[network.name];
  }

  const lockerProxyFactory = new LockerProxy__factory(owner);
  const lockerProxy: LockerProxy = await deployAndMine(
    'LockerProxy', lockerProxyFactory, lockerProxyFactory.deploy,
    DEPLOYED.LIQUIDITY_OPS, 
    DEPLOYED.TEMPLE_V2_PAIR, // lp token
    DEPLOYED.STAX_TOKEN,
    DEPLOYED.STAX_STAKING,
    DEPLOYED.CURVE_POOL
  );

  await mine(lockerProxy.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
