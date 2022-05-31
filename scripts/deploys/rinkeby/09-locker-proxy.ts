import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { LockerProxy__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const lockerProxyFactory = new LockerProxy__factory(owner);
  await deployAndMine(
    'LockerProxy', lockerProxyFactory, lockerProxyFactory.deploy,
    DEPLOYED.LIQUIDITY_OPS, 
    DEPLOYED.TEMPLE_V2_PAIR, // lp token
    DEPLOYED.STAX_TOKEN,
    DEPLOYED.STAX_STAKING,
    DEPLOYED.CURVE_POOL
  );

  // Ownership transferred to the msig in 99-post-deploy.ts
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
