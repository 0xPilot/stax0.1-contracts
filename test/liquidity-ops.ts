import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    TempleUniswapV2Pair__factory, 
    RewardsManager, RewardsManager__factory,
    StaxLPStaking, StaxLPStaking__factory, 
    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory,
    ERC20, ERC20__factory,
    LiquidityOps, LiquidityOps__factory,
    LockerProxy, LockerProxy__factory,
    CurveFactory__factory,
    CurvePool__factory
} from "../typechain";

import { lpBigHolderAddress, fraxMultisigAddress, templeMultisigAddress, 
    fraxUnifiedFarmAddress, lpTokenAddress, fxsTokenAddress, templeTokenAddress, 
    curveFactoryAddress } from "./addresses";


describe("Liquidity Ops", async () => {
    let staxLPToken: StaxLP;
    let owner: Signer;
    let alan: Signer;
    let frank: Signer;
    let validProxy: Signer;
    let lpBigHolder: Signer;
    let fraxMultisig: Signer;
    let templeMultisig: Signer;
    let v2pair: Contract; //TempleUniswapV2Pair
    let lpFarm: Contract; //FraxUnifiedFarmERC20;
    let rewardsManager: RewardsManager;
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let templeToken: ERC20;
    let curveFactory: Contract;
    let curvePool: Contract;
    let liquidityOps: LiquidityOps;
    let locker: LockerProxy;


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
        [owner, alan, frank, validProxy] = await ethers.getSigners();
        
        // lp token
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
        lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(fraxUnifiedFarmAddress, alan);
        staking = await new StaxLPStaking__factory(owner).deploy(v2pair.address, await alan.getAddress());
        rewardsManager = await new RewardsManager__factory(owner).deploy(staking.address);

        // Create the curve stable swap
        {
            curveFactory = CurveFactory__factory.connect(curveFactoryAddress, owner);
            
            const numPoolsBefore = await curveFactory.pool_count();

            const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
            const coins = [
                staxLPToken.address, v2pair.address,
                ZERO_ADDRESS, ZERO_ADDRESS];
            const A = 200;
            const fee = 4000000; // 0.04% - the minimum
            const assetType = 3; // 'Other'
            // curveFactory.plain_implementations[N_COINS][idx]
            // curveFactory.plain_implementations(2, 3) = 0x4A4d7868390EF5CaC51cDA262888f34bD3025C3F
            const implementationIndex = 3;
            // The deploy_plain_pool doesn't get added to the object correctly from the ABI (perhaps because it's overloaded)
            // We need to call it by name
            await expect(curveFactory.functions['deploy_plain_pool(string,string,address[4],uint256,uint256,uint256,uint256)']
                ("STAX TEMPLE/FRAX xLP + LP", "xTFLP+TFLP", coins, A, fee, assetType, implementationIndex))
                .to.emit(curveFactory, "PlainPoolDeployed")
                .withArgs(coins, A, fee, await owner.getAddress());
            
            expect(await curveFactory.pool_count(), numPoolsBefore+1);
        
            const curvePoolAddresses = await curveFactory.functions['find_pool_for_coins(address,address)'](staxLPToken.address, v2pair.address);
            expect(curvePoolAddresses.length).eq(1);
            const curvePoolAddress = curvePoolAddresses[0];
            expect(curvePoolAddress).not.eq(ZERO_ADDRESS);

            curvePool = CurvePool__factory.connect(curvePoolAddress, owner);
            expect((await curvePool.name())).eq('Curve.fi Factory Plain Pool: STAX TEMPLE/FRAX xLP + LP');
        }

        liquidityOps = await new LiquidityOps__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address,
            curvePool.address, rewardsManager.address);

        locker = await new LockerProxy__factory(owner).deploy(liquidityOps.address, v2pair.address, staxLPToken.address);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
        templeToken = ERC20__factory.connect(templeTokenAddress, alan);

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

            await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 300);
            await v2pair.connect(lpBigHolder).transfer(await templeMultisig.getAddress(), 10000);
        }

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

            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [fraxMultisigAddress],
            });
        }

        // Seed the pool 1:1
        {
            // Assume it's done manually from some temple msig
            await staxLPToken.addMinter(await templeMultisig.getAddress());
            await staxLPToken.connect(templeMultisig).mint(await templeMultisig.getAddress(), 10000);

            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 9000);
            await v2pair.connect(templeMultisig).approve(curvePool.address, 9000);

            // Send the msig some eth for the transaction.
            await owner.sendTransaction({
                to: await templeMultisig.getAddress(),
                value: ethers.utils.parseEther("0.2"),
              });

            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([9000, 9000], 1, await templeMultisig.getAddress());

            // to counter "transaction run out of gas errors"
            // When using this plugin, the `gas`, `gasPrice` and `gasMultiplier` parameters from your `hardhat.config` 
            // are not automatically applied to transactions
            //console.log("Temple Multisig Liquidity:", await curvePool.balanceOf(await templeMultisig.getAddress(), {gasLimit: 50000}));
            //console.log("Curve Pool Total Supply:", await curvePool.totalSupply({gasLimit: 50000}));
        }
    });

    describe("Liquidity", async () => {
        it("admin tests", async () => {
            await shouldThrow(liquidityOps.connect(alan).setOperator(await frank.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setLPFarm(lpFarm.address), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setLockParams(80, 100), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setOtherParams(1e8), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setRewardsManager(await alan.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).recoverToken(v2pair.address, await alan.getAddress(), 10), /Ownable: caller is not the owner/);
            
            await shouldThrow(liquidityOps.connect(alan).stakerToggleMigrator(await alan.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(liquidityOps.connect(alan).setVeFXSProxy(await alan.getAddress()), /Ownable: caller is not the owner/);

            await shouldThrow(liquidityOps.connect(alan).removeLiquidity(100, 0, 0), /not operator/);
            await shouldThrow(liquidityOps.connect(owner).removeLiquidity(100, 0, 0), /not operator/);

            // happy paths
            await liquidityOps.setOperator(await frank.getAddress());
            await liquidityOps.setLPFarm(lpFarm.address);
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setOtherParams(1e8);
            await liquidityOps.setRewardsManager(await alan.getAddress());
            await liquidityOps.stakerToggleMigrator(await owner.getAddress());

            await lpFarm.connect(validProxy).proxyToggleStaker(liquidityOps.address);
            await liquidityOps.setVeFXSProxy(await validProxy.getAddress());

            await shouldThrow(liquidityOps.connect(frank).removeLiquidity(100, 0, 0), /not enough tokens/);
            await shouldThrow(liquidityOps.applyLiquidity(), /not enough liquidity/);
        });

        it("should set operator", async () => {
            await liquidityOps.setOperator(await frank.getAddress());
            expect(await liquidityOps.operator()).to.eq(await frank.getAddress());
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

        it("should set other params", async() => {
            await liquidityOps.setOtherParams(1e8);
            expect(await liquidityOps.curveLiquiditySlippage()).eq(1e8);
        });

        it("should set rewards manager", async() => {
            await liquidityOps.setRewardsManager(rewardsManager.address);
            expect(await liquidityOps.rewardsManager()).to.eq(rewardsManager.address);
        });

        it("should toggle migrator for migration", async () => {
            await liquidityOps.stakerToggleMigrator(await owner.getAddress());
        });

        it("should return right time for max lock", async() => {
            expect(await liquidityOps.lockTimeForMaxMultiplier()).to.eq(7 * 86400);
        });

        it("should set reward tokens", async() => {
          await liquidityOps.setRewardTokens();
          const rewardTokens = await lpFarm.getAllRewardTokens();
          expect(await liquidityOps.rewardTokens(0)).to.eq(rewardTokens[0]);
          expect(await liquidityOps.rewardTokens(1)).to.eq(rewardTokens[1]);
        });

        it("owner can recover tokens", async () => {
            // Accidentally transfer some coin to the locker
            await v2pair.connect(alan).transfer(liquidityOps.address, 100);
            
            // The owner can claim it back
            await expect(liquidityOps.recoverToken(v2pair.address, await owner.getAddress(), 100))
                .to.emit(liquidityOps, "TokenRecovered")
                .withArgs(await owner.getAddress(), 100);
            
            expect(await v2pair.balanceOf(await owner.getAddress())).eq(100);
        });

        // to counter "transaction run out of gas errors"
        // When using this plugin, the `gas`, `gasPrice` and `gasMultiplier` parameters from your `hardhat.config` 
        // are not automatically applied to transactions
        it("should set curve pool 0", async() => {
            await liquidityOps.setCurvePool0();
            expect(await curvePool.coins(0, {gasLimit: 50000}), staxLPToken.address);
            expect(await liquidityOps.curveStableSwap0IsXlpToken()).eq(true);
        });

        it("should lock rightly", async() => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setCurvePool0();
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100);            
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(100);

            const balancesBefore = await curvePool.get_balances({gasLimit:50000});
            expect(balancesBefore[0]).eq(9000);
            expect(balancesBefore[1]).eq(9000);

            // Apply the liquidity to the gauge/curve pool
            const virtualPriceBefore = await curvePool.get_virtual_price();
            await expect(liquidityOps.applyLiquidity())
                .to.emit(liquidityOps, "Locked")
                .withArgs(0.8*100)
                .to.emit(liquidityOps, "LiquidityAdded")
                .withArgs(0.2*100, 0.2*100, 40);

            const virtualPriceAfter = await curvePool.get_virtual_price();
            expect(virtualPriceAfter).to.eq(virtualPriceBefore);
            const balancesAfter = await curvePool.get_balances({gasLimit:50000});
            expect(balancesAfter[0]).eq(9020);
            expect(balancesAfter[1]).eq(9020);

            expect(await v2pair.balanceOf(liquidityOps.address)).eq(0);
            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*100);

            const lockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            const lockedStake = lockedStakes[0];
            expect(lockedStake.liquidity).eq(0.8*100);  // From the first lock of 100, 80% of the LP is locked in the lpFarm

            // case next lock
            await locker.connect(alan).lock(50);
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(50);
            await liquidityOps.applyLiquidity();
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(0);

            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*(100+50));
            expect(await liquidityOps.lockTimeForMaxMultiplier()).to.eq(lockedStake.ending_timestamp - lockedStake.start_timestamp);

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            // try to lock in old kek_id, should create new lock
            await locker.connect(alan).lock(50);
            await liquidityOps.applyLiquidity();

            expect(await lpFarm.lockedStakesOfLength(liquidityOps.address)).to.eq(2);
            const newLockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            expect(newLockedStakes[1].liquidity).to.eq(0.8*50);
        });

        it("multiple users locking", async() => {
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setCurvePool0();
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            const staxLPSupplyBefore = (await staxLPToken.totalSupply()).toNumber();

            // Alan locks 100 LP
            await v2pair.connect(alan).approve(locker.address, 150);
            expect(await locker.connect(alan).lock(100));

            await expect(liquidityOps.applyLiquidity())
                .to.emit(liquidityOps, "Locked")
                .withArgs(0.8*100)
                .to.emit(liquidityOps, "LiquidityAdded")
                .withArgs(0.2*100, 0.2*100, (0.2*100)+20);

            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore+100+20);

            // Policy change
            await liquidityOps.setLockParams(90, 100);
            const staxLPSupplyBefore2 = (await staxLPToken.totalSupply()).toNumber();

            // Alan locks another 50 LP
            expect(await locker.connect(alan).lock(50));

            // send Frank some lp tokens
            await v2pair.connect(templeMultisig).transfer(await frank.getAddress(), 100);

            // Frank locks 100 LP
            await v2pair.connect(frank).approve(locker.address, 100);
            await locker.connect(frank).lock(100);

            // 80% of LP into the lpFarm and equiv xLP minted, 20% remains as LP in the locker.
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(150);
            expect(await staxLPToken.balanceOf(await frank.getAddress())).to.eq(100);
            expect(await staxLPToken.balanceOf(locker.address)).to.eq(0);
            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore+100+20+150);

            expect(await v2pair.balanceOf(liquidityOps.address)).to.eq(150);

            const lockedLiquidityBefore = await lpFarm.lockedLiquidityOf(liquidityOps.address);
            const virtualPriceBefore = await curvePool.get_virtual_price();
            await liquidityOps.applyLiquidity();
            const virtualPriceAfter = await curvePool.get_virtual_price();
            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(lockedLiquidityBefore.add(0.9*(150)));
            // normalized price
            expect(virtualPriceAfter).to.eq(virtualPriceBefore);

            expect(await staxLPToken.totalSupply()).eq(staxLPSupplyBefore2+150+15);
        });

        it("removes liquidity", async () => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setCurvePool0();
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);
            await liquidityOps.setOperator(await frank.getAddress());

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100);

            await liquidityOps.applyLiquidity();

            const liquidityBefore = await curvePool.balanceOf(liquidityOps.address, {gasLimit: 200000});
            // calculate amount of each token in lp to receive
            // value = old_balance * _burn_amount / total_supply
            const balanceCoin0 = await curvePool.balances(0, {gasLimit: 200000});
            const balanceCoin1 = await curvePool.balances(1, {gasLimit: 200000});
            const totalSupply = await curvePool.totalSupply({gasLimit: 200000});
            const amount0 = balanceCoin0.mul(10).div(totalSupply);
            const amount1 = balanceCoin1.mul(10).div(totalSupply);
            await expect(liquidityOps.connect(frank).removeLiquidity(10, 0, 0, {gasLimit: 200000}))
                .to.emit(liquidityOps, "LiquidityRemoved")
                .withArgs(amount1, amount0, 10);
            expect(await curvePool.balanceOf(liquidityOps.address, {gasLimit: 200000})).to.eq(liquidityBefore.sub(10));
        });

        it("should withdraw and relock", async() => {
            // lock
            await liquidityOps.setLockParams(80, 100);
            await liquidityOps.setCurvePool0();
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(liquidityOps.address);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(100);

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            await liquidityOps.applyLiquidity();

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

            // lock, fast forward and relock again to ensure only one active lock
            await locker.connect(alan).lock(50);
            await liquidityOps.applyLiquidity();
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

    });

    describe("Rewards", async () => {
        beforeEach(async () => {
            await liquidityOps.setLockParams(100, 100);
            await staxLPToken.addMinter(locker.address);

            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(300);

            await liquidityOps.setRewardTokens();
            await liquidityOps.setRewardsManager(rewardsManager.address);
       
            // send fxs and temple to lp farm to ensure enough reward tokens before fast forwarding
            fxsToken.connect(fraxMultisig).transfer(lpFarm.address, await fxsToken.balanceOf(await fraxMultisig.getAddress()));
            templeToken.connect(templeMultisig).transfer(lpFarm.address, await templeToken.balanceOf(await templeMultisig.getAddress()));
        });

        it("reward tokens are set", async () => {
            expect(await liquidityOps.rewardTokens(0)).eq(fxsToken.address);
            expect(await liquidityOps.rewardTokens(1)).eq(templeToken.address);
        });

        it("gets rewards", async () => {
            // fast forward
            await mineForwardSeconds(10 * 86400);
            await expect(liquidityOps.getReward())
                .to.emit(liquidityOps, "RewardClaimed");
        });

        it("harvests rewards", async () => {
            // fast forward and get reward
            await mineForwardSeconds(10 * 86400);
            await liquidityOps.getReward();
            const templeBalanceBefore = await templeToken.balanceOf(liquidityOps.address);
            const fxsBalanceBefore = await fxsToken.balanceOf(liquidityOps.address);

            await expect(liquidityOps.harvestRewards())
                .to.emit(liquidityOps, "RewardHarvested");

            expect(await templeToken.balanceOf(rewardsManager.address)).to.eq(templeBalanceBefore);
            expect(await fxsToken.balanceOf(rewardsManager.address)).to.eq(fxsBalanceBefore);
        });
    });
});