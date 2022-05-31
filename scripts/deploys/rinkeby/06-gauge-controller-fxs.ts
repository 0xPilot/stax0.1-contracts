import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { GaugeController, GaugeController__factory } from '../../../typechain';
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
  // note: gauge controller for Temple is using rewardRatesManual[] and therefore no need to have a gauge controller for temple
 
  const fxsGaugeControllerFactory = new GaugeController__factory(owner);
  const fxsGaugeController: GaugeController = await deployAndMine(
    'FXSGaugeController', fxsGaugeControllerFactory, fxsGaugeControllerFactory.deploy,
    DEPLOYED.FXS, // token
    DEPLOYED.MULTISIG // voting escrow. using random address, not needed for these tests (can't be address 0)
  );

  await mine(fxsGaugeController.commit_transfer_ownership(DEPLOYED.MULTISIG));
  await mine(fxsGaugeController.apply_transfer_ownership());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
