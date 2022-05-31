import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { SmartWalletWhitelist__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const smartWalletWLFactory: SmartWalletWhitelist__factory = new SmartWalletWhitelist__factory(owner);
  await deployAndMine(
    'SmartWalletWhitelist', smartWalletWLFactory, smartWalletWLFactory.deploy,
    DEPLOYED.MULTISIG
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });