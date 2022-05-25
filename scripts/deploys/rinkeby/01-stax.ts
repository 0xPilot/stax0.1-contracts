import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';
import { StaxLP, StaxLP__factory } from '../../../typechain';
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

  const staxLPFactory = new StaxLP__factory(owner);
  const staxLP: StaxLP = await deployAndMine(
    'StaxToken', staxLPFactory, staxLPFactory.deploy,
    'Stax Frax/Temple LP Token', 'xFraxTempleLP'
  )

  await mine(staxLP.addMinter(DEPLOYED.MULTISIG));
  await mine(staxLP.addMinter(await owner.getAddress()));

  // Transfer xLP ownership to the multisig
  // Grant the msig the admin role (so it can then add/remove minters), and remove admin from the old owner.
  const adminRole = await staxLP.getRoleAdmin(await staxLP.CAN_MINT());
  await mine(staxLP.grantRole(adminRole, DEPLOYED.MULTISIG));
  await mine(staxLP.transferOwnership(DEPLOYED.MULTISIG));
  await mine(staxLP.revokeRole(adminRole, await owner.getAddress()));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });