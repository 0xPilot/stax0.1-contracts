import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { VeFXSProxy, VeFXSProxy__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts,
  mine
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const veFxsProxyFactory = new VeFXSProxy__factory(owner);
  const veFxsProxy: VeFXSProxy = await deployAndMine(
    'VeFXSProxy', veFxsProxyFactory, veFxsProxyFactory.deploy,
    DEPLOYED.VEFXS, 
    DEPLOYED.FXS_GAUGE_CONTROLLER
  );

  await mine(veFxsProxy.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });