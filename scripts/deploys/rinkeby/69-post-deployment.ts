import '@nomiclabs/hardhat-ethers';
import { BigNumber, Signer } from 'ethers';
import { ethers, network } from 'hardhat';
import { 
  CurvePoolStub, CurvePoolStub__factory, 
  FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory, FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, 
  LiquidityOps__factory, LockerProxy__factory, 
  StaxLP__factory, TempleUniswapV2Pair__factory, 
  VeFXS__factory } from '../../../typechain';
import {
  blockTimestamp,
  deployAndMine,
  DeployedContracts,
  DEPLOYED_CONTRACTS,
  ensureExpectedEnvvars,
  mine,
} from '../helpers';


async function deployCurvePoolStub2(DEPLOYED: DeployedContracts, owner: Signer) {
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const coins: [string, string, string, string] = [
    DEPLOYED.STAX_TOKEN, DEPLOYED.FXS, //DEPLOYED.TEMPLE_V2_PAIR, // fxs for testing
    ZERO_ADDRESS, ZERO_ADDRESS];
  const A = 50;
  const fee = 15000000; // 0.15 %
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
    "xFraxTemple+FraxTempleLP",
    [DEPLOYED.STAX_TOKEN, DEPLOYED.TEMPLE_V2_PAIR],
    rateMultipliers,
    A,
    fee,
  );

  const staxlp = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);

  await staxlp.transfer(curvePoolStub.address, 10000);
  await v2pair.transfer(curvePoolStub.address, 10000);
}

async function addLiquidity(DEPLOYED: DeployedContracts, owner: Signer) {
    const curvePoolStub = CurvePoolStub__factory.connect(DEPLOYED.CURVE_POOL, owner);
    const staxlp = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
    const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);
    // prerequisite: mint and send lp to owner

    // mint, approve some more eth and add liquidity
    await mine(staxlp.mint(await owner.getAddress(), BigNumber.from(ethers.utils.parseEther("1000"))));

    await mine(staxlp.approve(curvePoolStub.address, BigNumber.from(ethers.utils.parseEther("500"))));
    await mine(v2pair.approve(curvePoolStub.address, BigNumber.from(ethers.utils.parseEther("500"))));

    const addLiquidityFn = curvePoolStub.functions['add_liquidity(uint256[2],uint256,address)'];
    await mine(addLiquidityFn([ethers.utils.parseEther("10"), ethers.utils.parseEther("10")], 0, await owner.getAddress(), {gasLimit: 900000}));
}

async function sendFarmRewardsAndSync(DEPLOYED: DeployedContracts, owner: Signer) {
    const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
    const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
    const temple = StaxLP__factory.connect(DEPLOYED.TEMPLE, owner);

    await mine(fxs.transfer(lpFarm.address, BigNumber.from(ethers.utils.parseEther("200"))));
    await mine(temple.transfer(lpFarm.address, BigNumber.from(ethers.utils.parseEther("200"))));

    await mine(lpFarm.sync());
}

async function lockAndStakeLP(DEPLOYED: DeployedContracts, owner: Signer) {
  const lockerProxy = LockerProxy__factory.connect(DEPLOYED.LOCKER_PROXY, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);

  await mine(v2pair.approve(lockerProxy.address, BigNumber.from(ethers.utils.parseEther("1"))));
  await mine(lockerProxy.lock(ethers.utils.parseEther("1"), true, {gasLimit: 400000}));
}

async function addMinters(DEPLOYED: DeployedContracts, owner: Signer) {
  const staxlp = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
  await mine(staxlp.addMinter(DEPLOYED.LOCKER_PROXY, {gasLimit: 400000}));
  await mine(staxlp.addMinter(DEPLOYED.LIQUIDITY_OPS, {gasLimit: 400000}));
}

async function createVeFxsLock(DEPLOYED: DeployedContracts, owner: Signer) {
  const veFXS = VeFXS__factory.connect(DEPLOYED.VEFXS, owner);
  const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
  // increase totalSupply of veFXS to avoid division by zero in below transaction
  await mine(fxs.approve(veFXS.address, 1000));
  await mine(veFXS.create_lock(1000, await blockTimestamp() + (86400 * 7), {gasLimit: 400000}));
  await mine(veFXS.checkpoint({gasLimit: 300000}));
}

async function testlockStaked(DEPLOYED: DeployedContracts, owner: Signer) {
  const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);
  await mine(v2pair.approve(lpFarm.address, 1000));
  await mine(lpFarm.stakeLocked(1000, 8640, {gasLimit: 900000}));
}

async function applyLiquidity(DEPLOYED: DeployedContracts, owner: Signer) {
  const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, owner);
  const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
  const curvePool = CurvePoolStub__factory.connect(DEPLOYED.CURVE_POOL, owner);
  console.log("total supply before ", await curvePool.totalSupply({gasLimit: 200000}));
  await mine(liquidityOps.applyLiquidity({gasLimit: 800000}));
  console.log("total supply after ", await curvePool.totalSupply({gasLimit: 200000}));
}

async function setOpsParams(DEPLOYED: DeployedContracts, owner: Signer) {
  const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, owner);
  await mine(liquidityOps.setCurvePool0());
  await mine(liquidityOps.setRewardTokens());
  //await mine(liquidityOps.setLockParams(80, 100, {gasLimit: 500000}));
}

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

  //await deployCurvePoolStub2(DEPLOYED, owner);
  //await addLiquidity(DEPLOYED, owner);
  //await addMinters(DEPLOYED, owner);
  //await lockAndStakeLP(DEPLOYED, owner);
  //await applyLiquidity(DEPLOYED, owner);
  await setOpsParams(DEPLOYED, owner);
  //await createVeFxsLock(DEPLOYED, owner);
  //await testlockStaked(DEPLOYED, owner);
  //await sendFarmRewardsAndSync(DEPLOYED, owner);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });