import '@nomiclabs/hardhat-ethers';
import { BigNumber, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { 
  CurvePoolStub, CurvePoolStub__factory, 
  FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory, FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, 
  LiquidityOps__factory, LockerProxy__factory, 
  RewardsManager__factory, 
  StaxLP__factory, TempleERC20Token__factory, TempleUniswapV2Pair__factory, 
  VeFXS__factory } from '../../../typechain';
import {
  blockTimestamp,
  deployAndMine,
  DeployedContracts,
  ensureExpectedEnvvars,
  mine,
  getDeployedContracts,
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
    "xFraxTplLP",
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
    const amount = ethers.utils.parseEther("15000");
    await mine(staxlp.mint(await owner.getAddress(), amount));

    await mine(staxlp.approve(curvePoolStub.address, amount));
    await mine(v2pair.approve(curvePoolStub.address, amount));

    const addLiquidityFn = curvePoolStub.functions['add_liquidity(uint256[2],uint256,address)'];
    await mine(addLiquidityFn([amount, amount], 0, await owner.getAddress()));
}

async function sendFarmRewardsAndSync(DEPLOYED: DeployedContracts, owner: Signer) {
    const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
    const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
    const temple = StaxLP__factory.connect(DEPLOYED.TEMPLE, owner);
    await mine(fxs.mint(await owner.getAddress(), BigNumber.from(ethers.utils.parseEther("10000"))));
    await mine(fxs.transfer(lpFarm.address, BigNumber.from(ethers.utils.parseEther("200")), {gasLimit: 500000}));
    await mine(temple.transfer(lpFarm.address, BigNumber.from(ethers.utils.parseEther("200")), {gasLimit: 500000}));

    await mine(lpFarm.sync({gasLimit: 500000}));
}

async function lockAndStakeLP(DEPLOYED: DeployedContracts, owner: Signer) {
  const lockerProxy = LockerProxy__factory.connect(DEPLOYED.LOCKER_PROXY, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);

  await mine(v2pair.approve(lockerProxy.address, BigNumber.from(ethers.utils.parseEther("1"))));
  await mine(lockerProxy.lock(ethers.utils.parseEther("1"), true));
}

async function addMinters(DEPLOYED: DeployedContracts, owner: Signer) {
  const staxlp = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
  await mine(staxlp.addMinter(DEPLOYED.LOCKER_PROXY));
  await mine(staxlp.addMinter(DEPLOYED.LIQUIDITY_OPS));

  // get admin role and transferOwnership to multisig
  const adminRole = await staxlp.getRoleAdmin(await staxlp.CAN_MINT());
  await mine(staxlp.grantRole(adminRole, DEPLOYED.MULTISIG));
  await mine(staxlp.transferOwnership(DEPLOYED.MULTISIG));
}

async function addRewardsOpsAsMinter(DEPLOYED: DeployedContracts, owner: Signer) {
  const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
  const temple = TempleERC20Token__factory.connect(DEPLOYED.TEMPLE, owner);

  await mine(fxs.addMinter(DEPLOYED.TEMP_REWARD_OPS));
  await mine(temple.addMinter(DEPLOYED.TEMP_REWARD_OPS));
}

async function createVeFxsLock(DEPLOYED: DeployedContracts, owner: Signer) {
  const veFXS = VeFXS__factory.connect(DEPLOYED.VEFXS, owner);
  const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
  // increase totalSupply of veFXS to avoid division by zero in below transaction
  await mine(fxs.approve(veFXS.address, 1000));
  await mine(veFXS.create_lock(1000, await blockTimestamp() + (86400 * 7)));
  await mine(veFXS.checkpoint());
}

async function testlockStaked(DEPLOYED: DeployedContracts, owner: Signer) {
  const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);
  await mine(v2pair.approve(lpFarm.address, 1000));
  await mine(lpFarm.stakeLocked(1000, 8640));
}

async function applyLiquidity(DEPLOYED: DeployedContracts, owner: Signer) {
  const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, owner);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);
  const curvePool = CurvePoolStub__factory.connect(DEPLOYED.CURVE_POOL, owner);

  console.log("total supply before ", await curvePool.totalSupply());
  const v2PairBalance = await v2pair.balanceOf(liquidityOps.address);
  const minCurveAmountOut = (await liquidityOps.minCurveLiquidityAmountOut(v2PairBalance, 5e7));
  console.log("Adding liquidity of:", v2PairBalance, "expected new liquidity at least:", minCurveAmountOut);
  await mine(liquidityOps.applyLiquidity(v2PairBalance, minCurveAmountOut));
  console.log("total supply after ", await curvePool.totalSupply());
}

async function setOpsParams(DEPLOYED: DeployedContracts, owner: Signer) {
  const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, owner);
  await mine(liquidityOps.setRewardTokens());
  //await mine(liquidityOps.setLockParams(80, 100));
}

async function transferOwnerships(DEPLOYED: DeployedContracts, owner: Signer) {
  const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLEMod__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, owner);
  await mine(lpFarm.nominateNewOwner(DEPLOYED.MULTISIG));
}

async function distributeRewards(DEPLOYED: DeployedContracts, owner: Signer) {
  const fxs = StaxLP__factory.connect(DEPLOYED.FXS, owner);
  const rewardsManager = RewardsManager__factory.connect(DEPLOYED.REWARDS_MANAGER, owner);
  const temple = StaxLP__factory.connect(DEPLOYED.TEMPLE, owner);
  await mine(fxs.transfer(DEPLOYED.REWARDS_MANAGER, BigNumber.from(ethers.utils.parseEther("500"))));
  await mine(temple.transfer(DEPLOYED.TEMPLE, BigNumber.from(ethers.utils.parseEther("5000"))));
  await mine(rewardsManager.distribute(fxs.address));
  await mine(rewardsManager.distribute(temple.address));
}

async function main() {
  ensureExpectedEnvvars();
  const [owner] = await ethers.getSigners();
  const DEPLOYED = getDeployedContracts();

  //await deployCurvePoolStub2(DEPLOYED, owner);
  //await addLiquidity(DEPLOYED, owner);
  //await addMinters(DEPLOYED, owner);
  //await lockAndStakeLP(DEPLOYED, owner);
  //await applyLiquidity(DEPLOYED, owner);
  //await setOpsParams(DEPLOYED, owner);
  //await createVeFxsLock(DEPLOYED, owner);
  //await testlockStaked(DEPLOYED, owner);
  //await sendFarmRewardsAndSync(DEPLOYED, owner);
  //await transferOwnerships(DEPLOYED, owner);
  await distributeRewards(DEPLOYED, owner);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });