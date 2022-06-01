import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { 
  CurvePool__factory,
  CurveFactory__factory,
  StaxLP__factory,
  TempleUniswapV2Pair__factory } from '../../../typechain';
import {
  ensureExpectedEnvvars,
  mine,
  getDeployedContracts,
} from '../helpers';

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  const curveFactory = CurveFactory__factory.connect(DEPLOYED.CURVE_FACTORY, owner);
  const staxLPToken = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner); // should be TEMPLE_V2_PAIR, was FXS
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const curvePoolAddressesBefore = await curveFactory.functions['find_pool_for_coins(address,address)'](staxLPToken.address, v2pair.address);
  if (curvePoolAddressesBefore[0] != ZERO_ADDRESS) {
      console.log("Curve pool for xLP/LP alread exists at:", curvePoolAddressesBefore[0]);
      return;
  }

  console.log("Pool count before:", await curveFactory.pool_count());

  // The params are the same as for cvxCRV/CRV, since the intended behaviour is similar.
  const coins: [string, string, string, string] = [
      staxLPToken.address, v2pair.address,
      ZERO_ADDRESS, ZERO_ADDRESS];
  const A = 40;  // Same ballpark as cvxCRV/CRV
  const fee = 29400000; // 0.294 %
  const assetType = 3; // 'Other'
  const implementationIndex = 3; // Optimised version
  
  const deployPlainPoolFn = curveFactory.functions['deploy_plain_pool(string,string,address[4],uint256,uint256,uint256,uint256)'];
  await mine(deployPlainPoolFn(
    "Stax Frax/Temple xLP + LP", "xFraxTplLP",  // Note: The symbol has to be <= 10 chars
    coins, A, fee, assetType, implementationIndex));
  
  console.log("Pool count after:", await curveFactory.pool_count());

  const curvePoolAddresses = await curveFactory.functions['find_pool_for_coins(address,address)'](staxLPToken.address, v2pair.address);
  const curvePoolAddress = curvePoolAddresses[0];
  console.log("Curve Pool Address:", curvePoolAddress);
  const curvePool = CurvePool__factory.connect(curvePoolAddress, owner);
  console.log("Curve Pool Name:", await curvePool.name());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });