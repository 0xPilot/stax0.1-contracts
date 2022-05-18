import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { StaxLPStaking__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const staxStakingLPFactory = new StaxLPStaking__factory(owner);
  await deployAndMine(
    'StaxStaking', staxStakingLPFactory, staxStakingLPFactory.deploy,
    DEPLOYED.STAX_TOKEN,
    DEPLOYED.MULTISIG // temp rewards distributor
  )
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });