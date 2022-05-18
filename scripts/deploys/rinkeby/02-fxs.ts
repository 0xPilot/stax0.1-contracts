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

  const fxsFactory = new StaxLP__factory(owner);
  const FXS: StaxLP = await deployAndMine(
    'FXS', fxsFactory, fxsFactory.deploy,
    'FraxShare Token',
    'FXS'
  )

  // add minters and transfer ownership
  await mine(FXS.addMinter(DEPLOYED.MULTISIG));
  await mine(FXS.addMinter(await owner.getAddress()));
  await mine(FXS.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });