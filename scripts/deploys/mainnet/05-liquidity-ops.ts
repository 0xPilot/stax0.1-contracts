import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { LiquidityOps__factory } from '../../../typechain';
import {
  deployAndMine,
  ensureExpectedEnvvars,
  getDeployedContracts
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const liquidityOpsFactory = new LiquidityOps__factory(owner);
  await deployAndMine(
    'LiquidityOps', liquidityOpsFactory, liquidityOpsFactory.deploy,
    DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, // lp farm
    DEPLOYED.TEMPLE_V2_PAIR, // lp token
    DEPLOYED.STAX_TOKEN, // xlp token
    DEPLOYED.CURVE_POOL, // xlp/lp curve pool
    DEPLOYED.REWARDS_MANAGER, // rewards manager
    DEPLOYED.MULTISIG, // temp fee collector. Note policy is set to not collect any fees by default.
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