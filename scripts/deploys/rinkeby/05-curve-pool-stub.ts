import '@nomiclabs/hardhat-ethers';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { CurvePoolStub, CurvePoolStub__factory, StaxLP__factory } from '../../../typechain';
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

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const coins: [string, string, string, string] = [
    DEPLOYED.STAX_TOKEN, DEPLOYED.FXS, //DEPLOYED.TEMPLE_V2_PAIR, // fxs for testing
    ZERO_ADDRESS, ZERO_ADDRESS];
  const A = 50;
  const fee = 29400000; // 0.294 %
  const assetType = 3; // 'Other'
  const implementationIndex = 3;
  const rateMultipliers: [BigNumber, BigNumber] = [
        BigNumber.from(ethers.utils.parseEther("1")),
        BigNumber.from(ethers.utils.parseEther("1")),
    ];

  const curvePoolStubFactory = new CurvePoolStub__factory(owner);
  const curvePoolStub: CurvePoolStub = await deployAndMine(
    'CurvePoolStub', curvePoolStubFactory, curvePoolStubFactory.deploy,
    "Stax Frax/Temple xLP + LP",
    "xFraxTplLP",  // Note: The symbol has to be <= 10 chars
    [DEPLOYED.STAX_TOKEN, DEPLOYED.TEMPLE_V2_PAIR],
    rateMultipliers,
    A,
    fee,
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