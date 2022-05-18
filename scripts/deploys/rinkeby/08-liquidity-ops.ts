import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';
import { LiquidityOps, LiquidityOps__factory } from '../../../typechain';
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

  const liquidityOpsFactory = new LiquidityOps__factory(owner);
  const liquidityOps: LiquidityOps = await deployAndMine(
    'LiquidityOps', liquidityOpsFactory, liquidityOpsFactory.deploy,
    DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, // lp farm
    DEPLOYED.TEMPLE_V2_PAIR, // lp token
    DEPLOYED.STAX_TOKEN,
    DEPLOYED.CURVE_POOL,
    DEPLOYED.REWARDS_MANAGER,
    DEPLOYED.MULTISIG
  );

  await mine(liquidityOps.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
