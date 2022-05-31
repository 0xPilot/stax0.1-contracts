import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { RewardsManager__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const rewardsManagerFactory = new RewardsManager__factory(owner);
  await deployAndMine(
    'RewardsManager', rewardsManagerFactory, rewardsManagerFactory.deploy,
    DEPLOYED.STAX_STAKING
  )
    
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