import { ethers, network } from "hardhat";
import { Signer, BigNumber, BigNumberish } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, shouldThrow, ZERO_ADDRESS } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    TempleUniswapV2Pair__factory, 
    RewardsManager, RewardsManager__factory,
    StaxLPStaking, StaxLPStaking__factory, 
    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory,
    ERC20, ERC20__factory,
    LiquidityOps, LiquidityOps__factory,
    LockerProxy, LockerProxy__factory,
    CurvePool,
    TempleUniswapV2Pair, FraxUnifiedFarmERC20
} from "../typechain";
import { lpBigHolderAddress, fraxMultisigAddress, templeMultisigAddress, 
    fraxUnifiedFarmAddress, lpTokenAddress, fxsTokenAddress, templeTokenAddress
} from "./addresses";
import { createCurveStableSwap } from "./curve-pool-helper";

describe("Liquidity Ops", async () => {
    let staxLPToken: StaxLP;
    let owner: Signer;
    let alan: Signer;
    let frank: Signer;
    let validProxy: Signer;
    let feeCollector: Signer;
    let lpBigHolder: Signer;
    let fraxMultisig: Signer;
    let templeMultisig: Signer;
    let v2pair: TempleUniswapV2Pair
    let lpFarm: FraxUnifiedFarmERC20;
    let rewardsManager: RewardsManager;
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let templeToken: ERC20;
    let curvePool: CurvePool;
    let liquidityOps: LiquidityOps;
    let locker: LockerProxy;
    const curveSlippage: BigNumberish = 5e7;  // 0.5%

    before( async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                forking: {
                    jsonRpcUrl: process.env.MAINNET_RPC_URL,
                    blockNumber: Number(process.env.FORK_BLOCK_NUMBER),
                },
            },
            ],
        });
    });

    beforeEach(async () => {
        [owner, alan, frank, validProxy, feeCollector] = await ethers.getSigners();
        
        // lp token
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
        lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(fraxUnifiedFarmAddress, alan);
        staking = await new StaxLPStaking__factory(owner).deploy(staxLPToken.address, await alan.getAddress());
        rewardsManager = await new RewardsManager__factory(owner).deploy(staking.address);

        // impersonate temple msig
        {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [templeMultisigAddress]
            });
            templeMultisig = await ethers.getSigner(templeMultisigAddress);
        }

        // impersonate account and transfer lp tokens
        {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [lpBigHolderAddress],
            });
            lpBigHolder = await ethers.getSigner(lpBigHolderAddress);

            await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 10000);
            await v2pair.connect(lpBigHolder).transfer(await templeMultisig.getAddress(), 1000000);
        }

        curvePool = await createCurveStableSwap(owner, staxLPToken, v2pair, templeMultisig);

        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
        templeToken = ERC20__factory.connect(templeTokenAddress, alan);

        // impersonate frax comptroller /multisig and reduce lock time for max multiplier
        {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [fraxMultisigAddress]
            });
            fraxMultisig = await ethers.getSigner(fraxMultisigAddress);
            await lpFarm.connect(fraxMultisig).setMiscVariables([
                BigNumber.from("3000000000000000000"),
                BigNumber.from("2000000000000000000"),
                BigNumber.from("2000000000000000000"),
                BigNumber.from("4000000000000000000"),
                BigNumber.from(86400 * 7), // reduce to 7 days
                BigNumber.from(86400 * 1) // min lock time
            ]);

            // add to valid migrators and proxies
            await lpFarm.connect(fraxMultisig).toggleMigrator(await owner.getAddress());
            await lpFarm.connect(fraxMultisig).toggleValidVeFXSProxy(await validProxy.getAddress());

            // Set the gauge temple rewards to a higher rate (same as fxs as of now)
            await lpFarm.connect(fraxMultisig).setRewardVars(
                templeToken.address, await lpFarm.rewardRates(0), 
                ZERO_ADDRESS, ZERO_ADDRESS);

            // send fxs and temple to lp farm to ensure enough reward tokens before fast forwarding
            fxsToken.connect(fraxMultisig).transfer(lpFarm.address, await fxsToken.balanceOf(await fraxMultisig.getAddress()));
            templeToken.connect(templeMultisig).transfer(lpFarm.address, await templeToken.balanceOf(await templeMultisig.getAddress()));

            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [fraxMultisigAddress],
            });
        }

        liquidityOps = await new LiquidityOps__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address,
            curvePool.address, rewardsManager.address, await feeCollector.getAddress());
            
        locker = await new LockerProxy__factory(owner).deploy(liquidityOps.address, v2pair.address, 
            staxLPToken.address, staking.address, curvePool.address);
        await staxLPToken.addMinter(locker.address);
    });

    describe("Liquidity", async () => {
        it("admin tests", async () => {
            await shouldThrow(liquidityOps.connect(alan).setPegDefender(await frank.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setLPFarm(lpFarm.address), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setLockParams(80, 100), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setFeeParams(20, 100), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setRewardsManager(await alan.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).recoverToken(v2pair.address, await alan.getAddress(), 10), /only owner or defender/);
            await shouldThrow(liquidityOps.connect(alan).setFarmLockTime(86400*365), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).stakerToggleMigrator(await alan.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setVeFXSProxy(await alan.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).withdrawLocked(ethers.constants.HashZero, await alan.getAddress()), /Ownable: caller is not the owner/);

            await shouldThrow(liquidityOps.connect(alan).removeLiquidity(100, 0, 0), /not defender/);
            await shouldThrow(liquidityOps.connect(owner).removeLiquidity(100, 0, 0), /not defender/);
            await shouldThrow(liquidityOps.connect(alan).removeLiquidityImbalance([10, 1], 100), /not defender/);
            await shouldThrow(liquidityOps.connect(alan).exchange(v2pair.address, 100, 100), /not defender/);

            await shouldThrow(liquidityOps.minCurveLiquidityAmountOut(100, 1e10), /invalid slippage/);
            await shouldThrow(liquidityOps.minCurveLiquidityAmountOut(100, 99961e6), /invalid slippage/);  // Fee = 0.04%, so total is 100.01%

            // happy paths
            await liquidityOps.setPegDefender(await frank.getAddress());
            await liquidityOps.setLPFarm(lpFarm.address);
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setFeeParams(20, 100);
            await liquidityOps.setRewardsManager(await alan.getAddress());
            await liquidityOps.stakerToggleMigrator(await owner.getAddress());

            await lpFarm.connect(validProxy).proxyToggleStaker(liquidityOps.address);
            await liquidityOps.setVeFXSProxy(await validProxy.getAddress());
            await liquidityOps.minCurveLiquidityAmountOut(100, 9996e6);  // Fee = 0.04%, so total == 100%

            await shouldThrow(liquidityOps.connect(frank).removeLiquidity(100, 0, 0), /not enough tokens/);
            await shouldThrow(liquidityOps.applyLiquidity(100, 100), /not enough liquidity/);
            await shouldThrow(liquidityOps.connect(frank).exchange(v2pair.address, 100, 100), /not enough tokens/);
            await shouldThrow(liquidityOps.connect(frank).removeLiquidityImbalance([10, 1], 100), /no liquidity/);
            await shouldThrow(liquidityOps.connect(frank).exchange(fxsToken.address, 100, 100), /unknown token/);

            await shouldThrow(liquidityOps.setFarmLockTime(1), /Minimum lock time not met/);
            await shouldThrow(liquidityOps.setFarmLockTime((86400*1)-1), /Trying to lock for too long/);
        });

        it("should set peg defender", async () => {
            await liquidityOps.setPegDefender(await frank.getAddress());
            expect(await liquidityOps.pegDefender()).to.eq(await frank.getAddress());
        });

        it("should set lp farm", async () => {
            await liquidityOps.setLPFarm(await owner.getAddress());
            expect(await liquidityOps.lpFarm()).to.eq(await owner.getAddress());
        });

        it("should set lock params", async() => {
            await liquidityOps.setLockParams(80, 100);
            const [numerator, denominator] = await liquidityOps.lockRate();
            expect(numerator.toNumber()).to.eq(80);
            expect(denominator.toNumber()).to.eq(100);
        });

        it("should set fee params", async() => {
            await liquidityOps.setFeeParams(30, 100);
            const [numerator, denominator] = await liquidityOps.feeRate();
            expect(numerator.toNumber()).to.eq(30);
            expect(denominator.toNumber()).to.eq(100);
        });

        it("should set rewards manager", async() => {
            await liquidityOps.setRewardsManager(rewardsManager.address);
            expect(await liquidityOps.rewardsManager()).to.eq(rewardsManager.address);
        });

        it("should set fee collector", async() => {
            await liquidityOps.setFeeCollector(await feeCollector.getAddress());
            expect(await liquidityOps.feeCollector()).to.eq(await feeCollector.getAddress());
        });

        it("should set gauge lock time", async () => {
            const secs = 86400 * 7; // 1 week is the max allowable
            await expect(liquidityOps.setFarmLockTime(secs))
                .to.emit(liquidityOps, "FarmLockTimeSet")
                .withArgs(secs);
            expect(await liquidityOps.farmLockTime()).to.eq(secs);
        });

        it("should toggle migrator for migration", async () => {
            await liquidityOps.stakerToggleMigrator(await owner.getAddress());
        });

        it("should toggle migrator for migration", async () => {
            await liquidityOps.stakerToggleMigrator(await owner.getAddress());
        });

        it("should set reward tokens", async() => {
          await liquidityOps.setRewardTokens();
          const rewardTokens = await lpFarm.getAllRewardTokens();
          expect(await liquidityOps.rewardTokens(0)).to.eq(rewardTokens[0]);
          expect(await liquidityOps.rewardTokens(1)).to.eq(rewardTokens[1]);
        });

        it("owner or peg defender can recover tokens", async () => {
            // Accidentally transfer some coin to the locker
            await v2pair.connect(alan).transfer(liquidityOps.address, 100);
            await liquidityOps.setPegDefender(await frank.getAddress());
            
            // The owner can claim it back
            await expect(liquidityOps.recoverToken(v2pair.address, await owner.getAddress(), 50))
                .to.emit(liquidityOps, "TokenRecovered")
                .withArgs(await owner.getAddress(), 50);
            await expect(liquidityOps.connect(frank).recoverToken(v2pair.address, await frank.getAddress(), 50))
                .to.emit(liquidityOps, "TokenRecovered")
                .withArgs(await frank.getAddress(), 50);
            
            expect(await v2pair.balanceOf(await owner.getAddress())).eq(50);
            expect(await v2pair.balanceOf(await frank.getAddress())).eq(50);
        });

        it("apply liquidity bad slippage", async() => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100, false);

            // Apply the liquidity to the gauge/curve pool
            // 0% slippage, and expect 1 more than what's possible to receive such that slippage screws us
            const minCurveAmountOut = (await liquidityOps.minCurveLiquidityAmountOut(100, 0)).add(1);
            await shouldThrow(liquidityOps.applyLiquidity(100, minCurveAmountOut), /Slippage screwed you/);
        });

        it("should lock rightly", async() => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100, false);
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(100);

            const balancesBefore = await curvePool.get_balances();
            expect(balancesBefore[0]).eq(9000);
            expect(balancesBefore[1]).eq(9000);

            // Apply the liquidity to the gauge/curve pool
            const virtualPriceBefore = await curvePool.get_virtual_price();
            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await expect(liquidityOps.applyLiquidity(100, minCurveAmountOut))
                .to.emit(liquidityOps, "Locked")
                .withArgs(0.8*100)
                // .to.emit(liquidityOps, "LiquidityAdded")   // Waffle version 3.4.4 can't chain emit's
                // .withArgs(0.2*100, 0.2*100, 40);

            const virtualPriceAfter = await curvePool.get_virtual_price();
            expect(virtualPriceAfter).to.eq(virtualPriceBefore);
            const balancesAfter = await curvePool.get_balances();
            expect(balancesAfter[0]).eq(9020);
            expect(balancesAfter[1]).eq(9020);

            expect(await v2pair.balanceOf(liquidityOps.address)).eq(0);
            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*100);

            const lockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            const lockedStake = lockedStakes[0];
            expect(lockedStake.liquidity).eq(0.8*100);  // From the first lock of 100, 80% of the LP is locked in the lpFarm

            // case next lock
            await locker.connect(alan).lock(50, false);
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(50);
            const minCurveAmountOut2 = await liquidityOps.minCurveLiquidityAmountOut(50, curveSlippage);
            await liquidityOps.applyLiquidity(50, minCurveAmountOut2);
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(0);

            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*(100+50));
            expect(await lpFarm.lock_time_for_max_multiplier()).to.eq(lockedStake.ending_timestamp.sub(lockedStake.start_timestamp));

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            // try to lock in old kek_id, should create new lock
            await locker.connect(alan).lock(50, false);
            const minCurveAmountOut3 = await liquidityOps.minCurveLiquidityAmountOut(50, curveSlippage);
            await liquidityOps.applyLiquidity(50, minCurveAmountOut3);

            expect(await lpFarm.lockedStakesOfLength(liquidityOps.address)).to.eq(2);
            const newLockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            expect(newLockedStakes[1].liquidity).to.eq(0.8*50);
        });

        it("multiple users locking", async() => {
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            const staxLPSupplyBefore = (await staxLPToken.totalSupply()).toNumber();

            // Alan locks 100 LP
            await v2pair.connect(alan).approve(locker.address, 150);
            expect(await locker.connect(alan).lock(100, false));

            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await expect(liquidityOps.applyLiquidity(100, minCurveAmountOut))
                .to.emit(liquidityOps, "Locked")
                .withArgs(0.8*100)
                .to.emit(liquidityOps, "LiquidityAdded")
                .withArgs(0.2*100, 0.2*100, (0.2*100)+20);

            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore+100+20);

            // Policy change
            await liquidityOps.setLockParams(90, 100);
            const staxLPSupplyBefore2 = (await staxLPToken.totalSupply()).toNumber();

            // Alan locks another 50 LP
            expect(await locker.connect(alan).lock(50, false));

            // send Frank some lp tokens
            await v2pair.connect(templeMultisig).transfer(await frank.getAddress(), 100);

            // Frank locks 100 LP
            await v2pair.connect(frank).approve(locker.address, 100);
            await locker.connect(frank).lock(100, false);

            // 80% of LP into the lpFarm and equiv xLP minted, 20% remains as LP in the locker.
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(150);
            expect(await staxLPToken.balanceOf(await frank.getAddress())).to.eq(100);
            expect(await staxLPToken.balanceOf(locker.address)).to.eq(0);
            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore+100+20+150);

            expect(await v2pair.balanceOf(liquidityOps.address)).to.eq(150);

            const lockedLiquidityBefore = await lpFarm.lockedLiquidityOf(liquidityOps.address);
            const virtualPriceBefore = await curvePool.get_virtual_price();
            const minCurveAmountOut2 = await liquidityOps.minCurveLiquidityAmountOut(150, curveSlippage);
            await liquidityOps.applyLiquidity(150, minCurveAmountOut2);
            const virtualPriceAfter = await curvePool.get_virtual_price();
            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(lockedLiquidityBefore.add(0.9*(150)));
            // normalized price
            expect(virtualPriceAfter).to.eq(virtualPriceBefore);

            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore2+150+15);
        });

        it("removes liquidity", async () => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            await liquidityOps.setPegDefender(await frank.getAddress());

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100, false);

            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await liquidityOps.applyLiquidity(100, minCurveAmountOut);

            const liquidityBefore = await curvePool.balanceOf(liquidityOps.address);
            // calculate amount of each token in lp to receive
            // value = old_balance * _burn_amount / total_supply
            const balanceCoin0 = await curvePool.balances(0);
            const balanceCoin1 = await curvePool.balances(1);
            const totalSupply = await curvePool.totalSupply();
            const amount0 = balanceCoin0.mul(10).div(totalSupply);
            const amount1 = balanceCoin1.mul(10).div(totalSupply);
            await expect(liquidityOps.connect(frank).removeLiquidity(10, 0, 0))
                .to.emit(liquidityOps, "LiquidityRemoved")
                .withArgs(amount1, amount0, 10);
            expect(await curvePool.balanceOf(liquidityOps.address)).to.eq(liquidityBefore.sub(10));
        });

        it("removes liquidity imbalance", async () => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            await liquidityOps.setPegDefender(await frank.getAddress());

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100, false);

            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await liquidityOps.applyLiquidity(100, minCurveAmountOut);

            const liquidityBefore = await curvePool.balanceOf(liquidityOps.address);
            
            const lpBalBefore = await v2pair.balanceOf(liquidityOps.address);
            const xlpBalBefore = await staxLPToken.balanceOf(liquidityOps.address);
            await expect(liquidityOps.connect(frank).removeLiquidityImbalance([10, 1], liquidityBefore))
                .to.emit(liquidityOps, "RemovedLiquidityImbalance");
            expect(await curvePool.balanceOf(liquidityOps.address)).to.lt(liquidityBefore);
            expect(await v2pair.balanceOf(liquidityOps.address)).to.eq(lpBalBefore.add(BigNumber.from(1)));
            expect(await staxLPToken.balanceOf(liquidityOps.address)).to.eq(xlpBalBefore.add(10));
        });

        it("should withdraw and relock", async() => {
            // lock
            await liquidityOps.setLockParams(80, 100);
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(liquidityOps.address);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(100, false);

            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await liquidityOps.applyLiquidity(100, minCurveAmountOut);

            // fast forward to end of locktime
            await mineForwardSeconds(8 * 86400);

            // new lock stake
            const lockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            const lockedStake = lockedStakes[0];
            const kekId = lockedStake.kek_id;
            // withdraw and expect relock
            await expect(liquidityOps.withdrawAndRelock(kekId))
                .to.emit(liquidityOps, "WithdrawAndReLock")
                .withArgs(kekId, lockedStake.liquidity);

            let newLockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            // liquidity should remain the same due to relock
            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(80);
                
            // "deleted" old stake values should be null
            expect(newLockedStakes[0].start_timestamp).to.eq(0);
            expect(newLockedStakes[0].liquidity).to.eq(0);
            expect(newLockedStakes[0].ending_timestamp).to.eq(0);
            expect(newLockedStakes[0].lock_multiplier).to.eq(0);

            // Withdrawing the old kek_id again should now fail.
            await shouldThrow(liquidityOps.withdrawAndRelock(kekId), /nothing to withdraw/);

            // lock, fast forward and relock again to ensure only one active lock
            await locker.connect(alan).lock(50, false);
            const minCurveAmountOut2 = await liquidityOps.minCurveLiquidityAmountOut(50, curveSlippage);
            await liquidityOps.applyLiquidity(50, minCurveAmountOut2);
            await mineForwardSeconds(8 * 86400);
            await liquidityOps.withdrawAndRelock(newLockedStakes[1].kek_id);
            newLockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            expect(newLockedStakes.length).to.eq(3);
            expect(newLockedStakes[0].start_timestamp).to.eq(0);
            expect(newLockedStakes[0].liquidity).to.eq(0);
            expect(newLockedStakes[0].ending_timestamp).to.eq(0);
            expect(newLockedStakes[0].lock_multiplier).to.eq(0);
            expect(newLockedStakes[1].start_timestamp).to.eq(0);
            expect(newLockedStakes[1].liquidity).to.eq(0);
            expect(newLockedStakes[1].ending_timestamp).to.eq(0);
            expect(newLockedStakes[1].lock_multiplier).to.eq(0);
        });

        it("should withdraw only", async() => {
            // lock
            await liquidityOps.setLockParams(80, 100);
            await v2pair.connect(alan).approve(locker.address, 10000);
            await staxLPToken.addMinter(liquidityOps.address);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(10000, false);

            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(10000, curveSlippage);
            await liquidityOps.applyLiquidity(10000, minCurveAmountOut);

            // fast forward to end of locktime
            await mineForwardSeconds(8 * 86400);

            // new lock stake
            const lockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            const lockedStake = lockedStakes[0];
            const kekId = lockedStake.kek_id;

            const frankAddr = await frank.getAddress();
            const lpBefore = await v2pair.balanceOf(frankAddr);
            const fxsBefore = await fxsToken.balanceOf(frankAddr);
            const templeBefore = await templeToken.balanceOf(frankAddr);
            await expect(liquidityOps.withdrawLocked(kekId, frankAddr))
                .to.emit(lpFarm, "WithdrawLocked")
                .withArgs(liquidityOps.address, 10000*0.8, kekId, frankAddr);

            // Check that frank ended up being sent the LP, and any earned rewards
            expect(await v2pair.balanceOf(frankAddr)).eq(lpBefore.add(10000*0.8));
            expect(await fxsToken.balanceOf(frankAddr)).gt(fxsBefore);
            expect(await templeToken.balanceOf(frankAddr)).gt(templeBefore);
        });

        it("exchanges one coin for another", async () => {
            // add minters, set params
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            await liquidityOps.setPegDefender(await frank.getAddress());

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100, false);

            // lock and add liquidity
            const virtualPriceBefore = await curvePool.get_virtual_price();
            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(100, curveSlippage);
            await liquidityOps.applyLiquidity(100, minCurveAmountOut)
            const virtualPriceAfter = await curvePool.get_virtual_price();
            expect(virtualPriceAfter).to.eq(virtualPriceBefore);

            // distort virtual price by adding liquidity off ratio
            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 1000);
            await v2pair.connect(templeMultisig).approve(curvePool.address, 100);
            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([1000, 1], 1, await templeMultisig.getAddress());

            // note: a considerable large difference in balances of coins would lead to peg being off, and therefore user getting lesser coins
            // proof price is off using amount one gets
            // using a large enough number to introduce imbalance. caller of peg defender should calculate offchain (could be a keeper/bot)
            const inputAmount = 2000;
            const expected = await curvePool.get_dy(0, 1, inputAmount);
            // ideal amount with 0.04% fee
            const idealAmountAfterFee = Math.floor(inputAmount * (0.9996));
            expect(expected).lt(idealAmountAfterFee);
            // calculate how much of y needed to bring balances of coins close
            // note: difference in balances doesn't always mean peg is off
            const balance0 = await curvePool.balances(0);
            const balance1 = await curvePool.balances(1);
            const balanceDiff = balance0.sub(balance1);
            const toExchange = balanceDiff.div(2);

            // lock more to introduce some lp in liquidity ops
            await v2pair.connect(alan).approve(locker.address, toExchange);
            await locker.connect(alan).lock(toExchange, false);
            
            const amountToReceive = await curvePool.get_dy(1, 0, toExchange);
            await expect(liquidityOps.connect(frank).exchange(v2pair.address, toExchange, amountToReceive))
                .to.emit(liquidityOps, "CoinExchanged")
                .withArgs(v2pair.address, toExchange, amountToReceive);
            const balance0After = await curvePool.balances(0);
            const balance1After = await curvePool.balances(1);
            expect(Math.abs(balance0After.sub(balance1After).toNumber())).to.lt(2);
        });
    });

    describe("Rewards", async () => {
        beforeEach(async () => {
            await liquidityOps.setLockParams(100, 100);
            await liquidityOps.setFeeParams(20, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);

            await liquidityOps.setRewardTokens();
            await liquidityOps.setRewardsManager(rewardsManager.address);
            await liquidityOps.setFeeCollector(await feeCollector.getAddress());
       
            await v2pair.connect(alan).approve(locker.address, 10000);
            await locker.connect(alan).lock(10000, false);
            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(10000, curveSlippage);
            await liquidityOps.applyLiquidity(10000, minCurveAmountOut);
        });

        it("reward tokens are set", async () => {
            expect(await liquidityOps.rewardTokens(0)).eq(fxsToken.address);
            expect(await liquidityOps.rewardTokens(1)).eq(templeToken.address);
        });

        it("gets rewards", async () => {
            const templeBalanceBefore = await templeToken.balanceOf(liquidityOps.address);
            const fxsBalanceBefore = await fxsToken.balanceOf(liquidityOps.address);

            // fast forward
            await mineForwardSeconds(2 * 86400);
            await expect(liquidityOps.getReward())
                .to.emit(liquidityOps, "RewardClaimed");

            const fxsBalanceAfter = await fxsToken.balanceOf(liquidityOps.address);
            const templeBalanceAfter = await templeToken.balanceOf(liquidityOps.address);

            expect(fxsBalanceAfter).to.gt(fxsBalanceBefore);
            expect(templeBalanceAfter).to.gt(templeBalanceBefore);
        });

        it("harvests rewards", async () => {
            const templeBalanceBefore = await templeToken.balanceOf(liquidityOps.address);
            const fxsBalanceBefore = await fxsToken.balanceOf(liquidityOps.address);

            // fast forward and get reward
            await mineForwardSeconds(2 * 86400);

            await liquidityOps.getReward();

            const fxsBalanceAfter = await fxsToken.balanceOf(liquidityOps.address);
            const templeBalanceAfter = await templeToken.balanceOf(liquidityOps.address);

            // liquidity ops has the rewards
            expect(fxsBalanceAfter).gt(fxsBalanceBefore);
            expect(templeBalanceAfter).gt(templeBalanceBefore);

            // The fee collector doesn't yet have rewards.
            expect(await fxsToken.balanceOf(await feeCollector.getAddress())).eq(0);
            expect(await templeToken.balanceOf(await feeCollector.getAddress())).eq(0);

            await expect(liquidityOps.harvestRewards())
                .to.emit(liquidityOps, "RewardHarvested");

            // Now rewards manager has the rewards.
            expect(await templeToken.balanceOf(liquidityOps.address)).eq(0);
            expect(await fxsToken.balanceOf(liquidityOps.address)).eq(0);
            const rewardsManagerTempleAfter = await templeToken.balanceOf(rewardsManager.address);
            const rewardsManagerFXSAfter = await fxsToken.balanceOf(rewardsManager.address);
            const feeCollectorTempleAfter = await templeToken.balanceOf(await feeCollector.getAddress());
            const feeCollectorFXSAfter = await fxsToken.balanceOf(await feeCollector.getAddress());

            // Rewards are split between the rewards manager and the fee collector
            expect(rewardsManagerTempleAfter.add(feeCollectorTempleAfter)).eq(templeBalanceAfter);
            expect(rewardsManagerFXSAfter.add(feeCollectorFXSAfter)).eq(fxsBalanceAfter);
        });
    });
});