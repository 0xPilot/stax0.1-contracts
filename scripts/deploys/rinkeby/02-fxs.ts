import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { StaxLP, StaxLP__factory } from '../../../typechain';
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