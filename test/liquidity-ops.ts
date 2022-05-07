import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, mineNBlocks, shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    //LPLockerSingle, LPLockerSingle__factory,
    TempleUniswapV2Pair__factory, 
    RewardsManager, RewardsManager__factory,
    StaxLPStaking, StaxLPStaking__factory, 
    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory,
    ERC20, ERC20__factory,
    LiquidityOps, LiquidityOps__factory,
    LockerProxy, LockerProxy__factory,
} from "../typechain";

import { lpBigHolderAddress, fraxMultisigAddress, templeMultisigAddress, 
    fraxUnifiedFarmAddress, lpTokenAddress, fxsTokenAddress, templeTokenAddress, 
    curveFactoryAddress } from "./addresses";

import * as curveFactoryJson from './abi/curve-factory.json';
import * as curveStableSwapJson from './abi/curve-stable-swap.json';

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
    //let locker: LPLockerSingle;
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
            curveFactory = (await ethers.getContractAt(JSON.parse(curveFactoryJson.result), curveFactoryAddress, owner));
            
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
            const deploy_plain_pool_fn = curveFactory.functions['deploy_plain_pool(string,string,address[4],uint256,uint256,uint256,uint256)'];
            const tx = await expect(deploy_plain_pool_fn("STAX TEMPLE/FRAX xLP + LP", "xTFLP+TFLP", coins, A, fee, assetType, implementationIndex))
                .to.emit(curveFactory, "PlainPoolDeployed")
                .withArgs(coins, A, fee, await owner.getAddress());
            
            expect(await curveFactory.pool_count(), numPoolsBefore+1);
        
            const curvePoolAddresses = await curveFactory.functions['find_pool_for_coins(address,address)'](staxLPToken.address, v2pair.address);
            expect(curvePoolAddresses.length).eq(1);
            const curvePoolAddress = curvePoolAddresses[0];
            expect(curvePoolAddress).not.eq(ZERO_ADDRESS);

            curvePool = (await ethers.getContractAt(JSON.parse(curveStableSwapJson.result), curvePoolAddress, owner));
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

            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 10000);
            await v2pair.connect(templeMultisig).approve(curvePool.address, 10000);

            // Send the msig some eth for the transaction.
            await owner.sendTransaction({
                to: await templeMultisig.getAddress(),
                value: ethers.utils.parseEther("0.2"),
              });

            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([10000, 10000], 1, await templeMultisig.getAddress());

            console.log("Temple Multisig Liquidity:", await curvePool.balanceOf(await templeMultisig.getAddress()));
            console.log("Curve Pool Total Supply:", await curvePool.totalSupply());
        }
    });

    describe.only("Liquidity", async () => {
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

        it("should set curve pool 0", async() => {
            await liquidityOps.setCurvePool0();
            expect(await curvePool.coins(0), staxLPToken.address);
            expect(await liquidityOps.curveStableSwap0IsXlpToken()).eq(true);
        });

        it.only("should lock rightly", async() => {
            // Need to add both the locker and liquidity ops as xlp minters
            await liquidityOps.setLockParams(80, 100);
            await staxLPToken.addMinter(locker.address);
            await staxLPToken.addMinter(liquidityOps.address);

            // Get some LP into the liquidity ops.
            await v2pair.connect(alan).approve(locker.address, 300);
            await locker.connect(alan).lock(100);
            
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(100);
            
            await expect(liquidityOps.applyLiquidity())
                .to.emit(liquidityOps, "Locked")
                .withArgs(0.8*100);
                //.to.emit(liquidityOps, "LiquidityAdded")
                //.withArgs(0.2*100, 100, 100);
            
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(0);

            // // 80% of LP into the lpFarm and equiv xLP minted, 20% remains as LP in the locker.
            // expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(100);
            // expect(await staxLPToken.balanceOf(locker.address)).to.eq(20);
            //expect(await v2pair.balanceOf(locker.address)).to.eq(0.2*100);

            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*100);

            const lockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            const lockedStake = lockedStakes[0];
            expect(lockedStake.liquidity).eq(0.8*100);  // From the first lock of 100, 80% of the LP is locked in the lpFarm

            // case next lock
            await locker.connect(alan).lock(50);
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(50);

            await liquidityOps.applyLiquidity();
            expect(await v2pair.balanceOf(liquidityOps.address)).eq(10);

            expect(await lpFarm.lockedLiquidityOf(liquidityOps.address)).to.eq(0.8*(100+50));
            expect(await liquidityOps.lockTimeForMaxMultiplier()).to.eq(lockedStake.ending_timestamp - lockedStake.start_timestamp);

            // await expect(locker.connect(alan).lock(50)).to.emit(locker, "Locked").withArgs(await alan.getAddress(), 40, 10);
            // expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(150);

            // // validate locker's lock
            // expect(await lpFarm.lockedLiquidityOf(locker.address)).to.eq(120);
            // expect(await locker.lockTimeForMaxMultiplier()).to.eq(lockedStake.ending_timestamp - lockedStake.start_timestamp);
            // expect(lockedStake.lock_multiplier).to.eq(BigNumber.from("3000000000000000000"));

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            // try to lock in old kek_id, should create new lock
            await locker.connect(alan).lock(50);
            await liquidityOps.applyLiquidity();

            expect(await lpFarm.lockedStakesOfLength(liquidityOps.address)).to.eq(2);
            const newLockedStakes = await lpFarm.lockedStakesOf(liquidityOps.address);
            expect(newLockedStakes[1].liquidity).to.eq(0.8*50);

            // // Verify the ratios
            // expect(await locker.totalXlpMintedForLiquidity()).eq(200*0.2);
            // const userLockedData = await locker.userLockedData(await alan.getAddress());
            // expect(userLockedData.xlpMintedForLiquidity).eq(200*0.2);
            // expect(userLockedData.xlpMintedForLock).eq(200*0.8);
            
            // TODO(pb): harvest rewards and send to rewards Manager and check balances
        });

    //     it("multiple users locking", async() => {
    //         await locker.setLockParams(80, 100);
    //         await staxLPToken.addMinter(locker.address);

    //         // Alan locks 100 LP
    //         await v2pair.connect(alan).approve(locker.address, 150);
    //         expect(await locker.connect(alan).lock(100))
    //             .to.emit(locker, "Locked").withArgs(await alan.getAddress(), 80, 20);

    //         // Policy change
    //         await locker.setLockParams(90, 100);

    //         // Alan locks another 50 LP
    //         expect(await locker.connect(alan).lock(50))
    //             .to.emit(locker, "Locked").withArgs(await alan.getAddress(), 45, 5);

    //         // Frank locks 100 LP
    //         await v2pair.connect(frank).approve(locker.address, 100);
    //         expect(await locker.connect(frank).lock(100))
    //             .to.emit(locker, "Locked").withArgs(await frank.getAddress(), 90, 10);

    //         // 80% of LP into the lpFarm and equiv xLP minted, 20% remains as LP in the locker.
    //         expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(150);
    //         expect(await staxLPToken.balanceOf(await frank.getAddress())).to.eq(100);
    //         expect(await staxLPToken.balanceOf(locker.address)).to.eq(100*0.2 + 50*0.1 + 100*0.1);
    //         expect(await v2pair.balanceOf(locker.address)).to.eq(100*0.2 + 50*0.1 + 100*0.1);

    //         const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
    //         const lockedStake = lockedStakes[0];
    //         expect(lockedStake.liquidity).eq(100*0.8 + 50*0.9 + 100*0.9);

    //         // Verify the ratios
    //         expect(await locker.totalXlpMintedForLiquidity()).eq(100*0.2 + 50*0.1 + 100*0.1);
    //         const alanLockedData = await locker.userLockedData(await alan.getAddress());
    //         expect(alanLockedData.xlpMintedForLiquidity).eq(100*0.2 + 50*0.1);
    //         expect(alanLockedData.xlpMintedForLock).eq(100*0.8 + 50*0.9);

    //         const frankLockedData = await locker.userLockedData(await frank.getAddress());
    //         expect(frankLockedData.xlpMintedForLiquidity).eq(100*0.1);
    //         expect(frankLockedData.xlpMintedForLock).eq(100*0.9);
    //     });

    //     it("should withdraw and relock", async() => {
    //         // lock
    //         await locker.setLockParams(80, 100);
    //         await v2pair.connect(alan).approve(locker.address, 300);
    //         await staxLPToken.addMinter(locker.address);
    //         await locker.connect(alan).lock(100);

    //         // fast forward to end of locktime
    //         await mineForwardSeconds(7 * 86400);

    //         // new lock stake
    //         const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
    //         const lockedStake = lockedStakes[0];
    //         const kekId = lockedStake.kek_id;
    //         await locker.connect(alan).lock(50);
    //         let newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
    //         const liquidity = await lpFarm.lockedLiquidityOf(locker.address);
    //         // withdraw and expect relock
    //         await expect(locker.withdrawAndRelock(kekId))
    //             .to.emit(locker, "WithdrawAndReLock")
    //             .withArgs(kekId, lockedStake.liquidity);
    //         // liquidity should remain the same due to relock
    //         expect(await lpFarm.lockedLiquidityOf(locker.address)).to.eq(liquidity);
    //         newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
            
    //         // "deleted" old stake values should be null
    //         expect(newLockedStakes[0].start_timestamp).to.eq(0);
    //         expect(newLockedStakes[0].liquidity).to.eq(0);
    //         expect(newLockedStakes[0].ending_timestamp).to.eq(0);
    //         expect(newLockedStakes[0].lock_multiplier).to.eq(0);
    //     });

    //     it("lp manager withdraws lp token reserves", async () => {
    //         // lock and withdraw reserves
    //         // case first lock
    //         await locker.setLockParams(80, 100);
    //         await v2pair.connect(alan).approve(locker.address, 300);
    //         await staxLPToken.addMinter(locker.address);
    //         await locker.connect(alan).lock(100);
    //         await locker.connect(alan).lock(100);
            
    //         // check reserves
    //         expect(await v2pair.balanceOf(locker.address)).to.eq(40);
    //         const lpBalanceLocker = await v2pair.balanceOf(locker.address);
    //         const lpBalanceManager = await v2pair.balanceOf(await alan.getAddress());
    //         console.log("bal of lp manager before withdrawing ", await v2pair.balanceOf(await alan.getAddress()));
    //         // withdraw reserves
    //         await locker.connect(alan).withdrawLPToken(lpBalanceLocker);
    //         expect(await v2pair.balanceOf(await alan.getAddress())).to.eq(lpBalanceLocker.add(lpBalanceManager));
    //     });

    //     it("only one active locked stake exists over time", async () => {
    //         // lock twice
    //         await v2pair.connect(alan).approve(locker.address, 300);
    //         await staxLPToken.addMinter(locker.address);
    //         await locker.connect(alan).lock(100);
    //         await locker.connect(alan).lock(100);

    //         expect(await lpFarm.lockedStakesOfLength(locker.address)).eq(1);

    //         // fast forward to end of locktime
    //         await mineForwardSeconds(7 * 86400);

    //         const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
    //         expect(lockedStakes.length).eq(1);
            
    //         const lockedStake = lockedStakes[0];
    //         const kekId = lockedStake.kek_id;
    //         await locker.connect(alan).lock(50);
    //         let newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
    //       //  const liquidity = await lpFarm.lockedLiquidityOf(locker.address);

    //         expect(newLockedStakes.lentgh).eq(2);

    //         await expect(locker.withdrawAndRelock(kekId))
    //            .to.emit(locker, "WithdrawAndReLock")
    //            .withArgs(kekId, lockedStake.liquidity);

    //     });

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