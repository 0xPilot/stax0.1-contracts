import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { 
  RewardsDistributor,
  RewardsDistributor__factory,
  RewardsOps__factory,
} from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  mine,
  getDeployedContracts,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const rewardsManagerFactory = new RewardsDistributor__factory(owner);
  const rewardsDistributor: RewardsDistributor = await deployAndMine(
    'RewardsDistributor', rewardsManagerFactory, rewardsManagerFactory.deploy,
    DEPLOYED.STAX_STAKING
  );

  const rewardsOpsFactory = new RewardsOps__factory(owner);
  const rewardsOps = await deployAndMine(
    'RewardsOps', rewardsOpsFactory, rewardsOpsFactory.deploy,
    rewardsDistributor.address,
    [DEPLOYED.FXS, DEPLOYED.TEMPLE]
  );
  
  // post deploy: multisig adds rewardsOps as minter of fxs and temple
    
  await mine(rewardsDistributor.setOperator(rewardsOps.address));
  await mine(rewardsDistributor.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });