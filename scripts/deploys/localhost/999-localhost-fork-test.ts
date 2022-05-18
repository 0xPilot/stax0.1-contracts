import '@nomiclabs/hardhat-ethers';
import { BigNumber, Signer } from 'ethers';
import { ethers, network } from 'hardhat';
import { CurvePool__factory, StaxLP__factory, TempleUniswapV2Pair__factory, LiquidityOps__factory, LockerProxy__factory } from '../../../typechain';
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

async function main() {
  ensureExpectedEnvvars();
  const [owner, fred] = await ethers.getSigners();

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

  const amount = ethers.utils.parseEther("10");
  
  if ((await v2pair.balanceOf(await fred.getAddress())).lt(amount)) {
    await sendLP(DEPLOYED, fred, amount);
  }

  console.log("Fred xLP bal:", await staxlp.balanceOf(await fred.getAddress()));
  console.log("Fred LP bal:", await v2pair.balanceOf(await fred.getAddress()));
  
  const curveBalancesBefore = await curvePool.get_balances({gasLimit: 50000});
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
    await mine(addLiquidityFn([seedAmount, seedAmount], 0, await templeMultisig.getAddress(), {gasLimit: 900000}));
    console.log("Curve Pool Balances:", await curvePool.get_balances({gasLimit: 50000}));
  }

  const fredLPBal = await v2pair.balanceOf(await fred.getAddress());
  if (fredLPBal.gt(0) && (await (v2pair.balanceOf(liquidityOps.address))).eq(0)) {
    console.log("\nLocking LP for xLP");
    await v2pair.connect(fred).approve(lockerProxy.address, fredLPBal);
    await mine(lockerProxy.connect(fred).lock(fredLPBal, false));
  }

  console.log("\napplyLiquidity() for: ", await v2pair.balanceOf(liquidityOps.address));
  await mine(liquidityOps.applyLiquidity({gasLimit: 900000}));
  
  console.log("Curve Pool balances:", await curvePool.get_balances({gasLimit: 50000}));
  console.log("liquidity ops xLP bal:", await staxlp.balanceOf(liquidityOps.address));
  console.log("liquidity ops LP bal:", await v2pair.balanceOf(liquidityOps.address));
  console.log("Fred xLP bal:", await staxlp.balanceOf(await fred.getAddress()));
  console.log("Fred LP bal:", await v2pair.balanceOf(await fred.getAddress()));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });