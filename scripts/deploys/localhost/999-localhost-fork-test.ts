import '@nomiclabs/hardhat-ethers';
import { BigNumber, Signer } from 'ethers';
import { ethers, network } from 'hardhat';
import { 
  CurvePool__factory, 
  StaxLP__factory, 
  TempleUniswapV2Pair__factory, 
  LiquidityOps__factory, 
  LockerProxy__factory,
  FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, 
  VeFXSProxy__factory,
  SmartWalletWhitelist__factory,
  ERC20__factory,
} from '../../../typechain';
import {
  DeployedContracts,
  DEPLOYED_CONTRACTS,
  ensureExpectedEnvvars,
  mine,
} from '../helpers';

async function sendLP(DEPLOYED: DeployedContracts, to: Signer, amount: BigNumber) {
  // Transfer v2pair from a whale
  const lpBigHolderAddress = "0xA5F74Ae4b22A792f18C42Ec49A85cF560F16559F";
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [lpBigHolderAddress],
  });
  const lpBigHolder = await ethers.getSigner(lpBigHolderAddress);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, lpBigHolder);
  await mine(v2pair.transfer(await to.getAddress(), amount));

  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [lpBigHolderAddress],
  });
}

async function createVeFXSLock(DEPLOYED: DeployedContracts, templeMultisig: Signer, veFxsOps: Signer) {
  const veFxsProxy = VeFXSProxy__factory.connect(DEPLOYED.VEFXS_PROXY, templeMultisig);
  
  // Give the operator some FXS
  // impersonate frax multisig and whitelist VeFxsProxy for veFXS locking
  let fraxMultisig: Signer;
  {
    const fraxMultisigAddress = "0xB1748C79709f4Ba2Dd82834B8c82D4a505003f27";
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [fraxMultisigAddress]
    });
    fraxMultisig = await ethers.getSigner(fraxMultisigAddress);
    
    const smartWalletWhitelistAddress = "0x53c13BA8834a1567474b19822aAD85c6F90D9f9F";
    let smartWalletWhitelist = SmartWalletWhitelist__factory.connect(smartWalletWhitelistAddress, fraxMultisig);
    smartWalletWhitelist.connect(fraxMultisig).approveWallet(veFxsProxy.address);
  }
  
  const fxsToken = ERC20__factory.connect(DEPLOYED.FXS, fraxMultisig);

  const veFxsOpsAddr = await veFxsOps.getAddress();
  const amount = ethers.utils.parseEther("1000");
  await fxsToken.transfer(veFxsOpsAddr, amount);
  await veFxsProxy.approveOpsManager(veFxsOpsAddr, true); 

  // Liquidity Ops does not yet 
  await fxsToken.connect(veFxsOps).approve(veFxsProxy.address, amount);
  const currentTime = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  const idealUnlockTime = currentTime + 86400*365;  // 1 year

  // Create lock
  const lockedBefore = await veFxsProxy.locked();

  if (lockedBefore.amount.eq(0)) {
    await veFxsProxy.connect(veFxsOps).createLock(amount, idealUnlockTime);
  } else {
    await veFxsProxy.connect(veFxsOps).increaseAmount(amount);
  }

  const lockedAfter = await veFxsProxy.locked();
  console.log("Created veFXS Lock:", lockedAfter);
}

async function main() {
  ensureExpectedEnvvars();
  const [owner, fred, veFxsOps] = await ethers.getSigners();

  let DEPLOYED: DeployedContracts;

  if (DEPLOYED_CONTRACTS[network.name] === undefined) {
    console.log(`No contracts configured for ${network.name}`)
    return;
  } else {
    DEPLOYED = DEPLOYED_CONTRACTS[network.name];
  }

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [DEPLOYED.MULTISIG],
  });
  const templeMultisig = await ethers.getSigner(DEPLOYED.MULTISIG);

  const curvePool = CurvePool__factory.connect(DEPLOYED.CURVE_POOL, templeMultisig);
  const staxlp = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, templeMultisig);
  const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, templeMultisig);
  const lockerProxy = LockerProxy__factory.connect(DEPLOYED.LOCKER_PROXY, templeMultisig);
  const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, templeMultisig);
  const lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(DEPLOYED.FRAX_TEMPLE_UNIFIED_FARM, templeMultisig);

  const amount = ethers.utils.parseEther("10");
  
  if ((await v2pair.balanceOf(await fred.getAddress())).lt(amount)) {
    await sendLP(DEPLOYED, fred, amount);
  }

  console.log("Fred xLP bal:", await staxlp.balanceOf(await fred.getAddress()));
  console.log("Fred LP bal:", await v2pair.balanceOf(await fred.getAddress()));
  
  const curveBalancesBefore = await curvePool.get_balances();
  console.log("Curve Pool balances:", curveBalancesBefore);
  
  // Seed the curve pool if empty
  if (curveBalancesBefore[0].eq(0) && curveBalancesBefore[1].eq(0)) {
    console.log("\nTemple multisig is seeding the curve pool...");
    const seedAmount = ethers.utils.parseEther("1");

    // Temporarily grant the msig the minter role, and mint new xlp   
    await mine(staxlp.addMinter(await templeMultisig.getAddress()));
    await mine(staxlp.mint(await templeMultisig.getAddress(), seedAmount));
    await mine(staxlp.removeMinter(await templeMultisig.getAddress()));
    
    // Give the msig some LP
    await sendLP(DEPLOYED, templeMultisig, seedAmount);

    console.log("Temple msig xLP bal:", await staxlp.balanceOf(await templeMultisig.getAddress()));
    console.log("Temple msig LP bal:", await v2pair.balanceOf(await templeMultisig.getAddress()));

    // Add the liquidity
    await mine(staxlp.approve(curvePool.address, seedAmount));
    await mine(v2pair.approve(curvePool.address, seedAmount));
    const addLiquidityFn = curvePool.functions['add_liquidity(uint256[2],uint256,address)'];
    await mine(addLiquidityFn([seedAmount, seedAmount], 0, await templeMultisig.getAddress()));
    console.log("Curve Pool Balances:", await curvePool.get_balances());
  }

  const fredLPBal = await v2pair.balanceOf(await fred.getAddress());
  if (fredLPBal.gt(0) && (await (v2pair.balanceOf(liquidityOps.address))).eq(0)) {
    const amountToLock = fredLPBal.sub(ethers.utils.parseEther("2"));
    console.log("\nLocking LP for xLP:", amountToLock);
    await v2pair.connect(fred).approve(lockerProxy.address, amountToLock);
    await mine(lockerProxy.connect(fred).lock(amountToLock, false));
  }

  const v2PairBalance = await v2pair.balanceOf(liquidityOps.address);
  console.log("\napplyLiquidity() for: ", v2PairBalance);
  const minCurveAmountOut = (await liquidityOps.minCurveLiquidityAmountOut(v2PairBalance, 5e7));
  await mine(liquidityOps.applyLiquidity(v2PairBalance, minCurveAmountOut));
  
  const fredLPBal2 = await v2pair.balanceOf(await fred.getAddress());
  if (fredLPBal2.gt(0)) {
    const ammQuote = await lockerProxy.buyFromAmmQuote(fredLPBal2);
    await v2pair.connect(fred).approve(lockerProxy.address, fredLPBal2);
    console.log("\nBuying xLP with LP:", fredLPBal2, ammQuote);
    await mine(lockerProxy.connect(fred).buyFromAmm(fredLPBal2, false, ammQuote));
  }

  console.log("Curve Pool balances:", await curvePool.get_balances());
  console.log("liquidity ops xLP bal:", await staxlp.balanceOf(liquidityOps.address));
  console.log("liquidity ops LP bal:", await v2pair.balanceOf(liquidityOps.address));
  console.log("Fred xLP bal:", await staxlp.balanceOf(await fred.getAddress()));
  console.log("Fred LP bal:", await v2pair.balanceOf(await fred.getAddress()));
  
  await createVeFXSLock(DEPLOYED, templeMultisig, veFxsOps);

  const stakes = await lpFarm.lockedStakesOf(liquidityOps.address);
  const lockDuration = stakes[0].ending_timestamp.sub(stakes[0].start_timestamp);
  console.log("Time (seconds) until gauge unlocks:", lockDuration.toString(), "In days:", lockDuration.div(60*60*24).toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
