import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { BigNumber, Signer } from 'ethers';
import { 
  VeFXS, VeFXS__factory,
  FraxUnifiedFarmERC20TempleFRAXTEMPLEMod, FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory } from '../../../typechain';
import {
  deployAndMine,
  DeployedContracts,
  ensureExpectedEnvvars,
  mine,
  getDeployedContracts,
} from '../helpers';

async function deployVeFXS(DEPLOYED: DeployedContracts, owner: Signer) {
  const veFxsFactory = new VeFXS__factory(owner);
  const veFxs: VeFXS = await deployAndMine(
    'VeFXS', veFxsFactory, veFxsFactory.deploy,
    DEPLOYED.FXS,
    'Vote escrow FXS',
    'veFXS',
    'veFXS_1.0.0 '
  );

  await mine(veFxs.commit_transfer_ownership(DEPLOYED.MULTISIG));

  return veFxs.address;
}

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const rewardTokens = [DEPLOYED.FXS, DEPLOYED.TEMPLE];
  const rewardManagers = [DEPLOYED.MULTISIG, DEPLOYED.MULTISIG];
  const rewardRatesManual = [BigNumber.from("23443294610300761"), BigNumber.from("23443294610300761")]; // currently set on mainnet. changed temple rate from 1267427122940430
  const gaugeControllers = [DEPLOYED.FXS_GAUGE_CONTROLLER, ZERO_ADDRESS];
  // normally a contract, but for test purposes we send the funds directly (instead of syncing)
  // set reward distributors to address(0) so when sync is called, no contract is called for reward distribution
  const rewardDistributors = [ZERO_ADDRESS, ZERO_ADDRESS];

  const veFxsAddress = await deployVeFXS(DEPLOYED, owner);

  const lpFarmFactory: FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory = new FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory(owner);
  const lpFarm: FraxUnifiedFarmERC20TempleFRAXTEMPLEMod = await deployAndMine(
    'FraxUnifiedFarmTempleFraxMod', lpFarmFactory, lpFarmFactory.deploy,
    await owner.getAddress(), // temp owner
    veFxsAddress,
    DEPLOYED.FRAX,
    rewardTokens,
    rewardManagers,
    rewardRatesManual,
    gaugeControllers,
    rewardDistributors,
    DEPLOYED.TEMPLE_V2_PAIR
  )

  // set misc variables
  const lockMaxMultiplier = BigNumber.from("3000000000000000000");
  const veFxsMaxMultiplier = BigNumber.from("2000000000000000000");
  const veFxsPerFraxForMaxBoost = BigNumber.from("2000000000000000000");
  const veFxsBoostScaleFactor = BigNumber.from("4000000000000000000");
  const lockTimeForMaxMultiplier = BigNumber.from(86400 * 1) // reduce to 1 day
  const lockTimeMin = BigNumber.from(300) // min lock time. 5 mins
  await mine(lpFarm.setMiscVariables([
    lockMaxMultiplier,
    veFxsMaxMultiplier,
    veFxsPerFraxForMaxBoost,
    veFxsBoostScaleFactor,
    lockTimeForMaxMultiplier,
    lockTimeMin
  ]));

  // transfer ownership
  await mine(lpFarm.nominateNewOwner(DEPLOYED.MULTISIG));
  // after deployment, it's required for multisig to accept ownership by calling function `acceptOwnership()`
  // distribute rewards and sync
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });