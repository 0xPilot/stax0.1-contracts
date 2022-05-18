import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';
import { StaxLPStaking, StaxLPStaking__factory } from '../../../typechain';
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

  const staxStakingLPFactory = new StaxLPStaking__factory(owner);
  const staxStaking: StaxLPStaking = await deployAndMine(
    'StaxStaking', staxStakingLPFactory, staxStakingLPFactory.deploy,
    DEPLOYED.STAX_TOKEN,
    DEPLOYED.MULTISIG // temp distributor
  )

  await mine(staxStaking.transferOwnership(DEPLOYED.MULTISIG));
  
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });