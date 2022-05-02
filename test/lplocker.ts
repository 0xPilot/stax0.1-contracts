import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, mineNBlocks, shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    LPLockerSingle, LPLockerSingle__factory,
    TempleUniswapV2Pair__factory,
    FraxUnifiedFarmERC20, FraxUnifiedFarmERC20__factory, 
    RewardsManager, RewardsManager__factory, StaxLPStaking, StaxLPStaking__factory, FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, ERC20, ERC20__factory
} from "../typechain";

import { lpBigHolderAddress, fraxMultisigAddress, templeMultisigAddress, 
    fraxUnifiedFarmAddress, lpTokenAddress, fxsTokenAddress, templeTokenAddress } from "./addresses";

describe("LP Locker", async () => {
    let staxLPToken: StaxLP;
    let owner: Signer;
    let minter: Signer;
    let alan: Signer;
    let validProxy: Signer;
    let lpBigHolder: Signer;
    let fraxMultisig: Signer;
    let templeMultisig: Signer;
    let v2pair: Contract; //TempleUniswapV2Pair
    let locker: LPLockerSingle;
    let lpFarm: Contract; //FraxUnifiedFarmERC20;
    let rewardsManager: RewardsManager;
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let templeToken: ERC20;

    beforeEach(async () => {
        [owner, minter, alan, validProxy] = await ethers.getSigners();
        // lp token
        //v2pair = new Contract(lpTokenAddress, TempleUniswapV2Pair__factory.abi);
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
        staking = await new StaxLPStaking__factory(owner).deploy(v2pair.address, await alan.getAddress());
        //lpFarm = new FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory(FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.abi, 
        //    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.bytecode).attach("0x10460d02226d6ef7B2419aE150E6377BdbB7Ef16");
        // for off-chain view functions
        lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(fraxUnifiedFarmAddress, alan);
        locker = await new LPLockerSingle__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address, await owner.getAddress());
        rewardsManager = await new RewardsManager__factory(owner).deploy(staking.address, locker.address);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
        templeToken = ERC20__factory.connect(templeTokenAddress, alan);

        await locker.setLPManager(await alan.getAddress(), true);
        
        // impersonate account and transfer lp tokens
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [lpBigHolderAddress],
        });
        lpBigHolder = await ethers.getSigner(lpBigHolderAddress);

        await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 300);

        // impersonate temple msig
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [templeMultisigAddress]
        });
        templeMultisig = await ethers.getSigner(templeMultisigAddress);

        // impersonate frax comptroller /multisig and reduce lock time for max multiplier
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
        //await lpFarm.connect(validProxy).proxyToggleStaker(locker.address);
        //await locker.setVeFXSProxy(await validProxy.getAddress());
    });

    describe("Locking", async () => {

        it("admin tests", async () => {
            shouldThrow(locker.connect(alan).setLPFarm(lpFarm.address), /Ownable: caller is not the owner/);
            shouldThrow(locker.connect(alan).setLPManager(await alan.getAddress(), true), /Ownable: caller is not the owner/);
            shouldThrow(locker.connect(alan).setLockParams(80, 100), /Ownable: caller is not the owner/);
            shouldThrow(locker.connect(alan).setRewardsManager(await alan.getAddress()), /Ownable: caller is not the owner/);
            shouldThrow(locker.connect(alan).recoverToken(v2pair.address, await alan.getAddress(), 10), /Ownable: caller is not the owner/);
            
            shouldThrow(locker.connect(alan).stakerToggleMigrator(await alan.getAddress()), /Ownable: caller is not the owner/);
            shouldThrow(locker.connect(alan).setVeFXSProxy(await alan.getAddress()), /Ownable: caller is not the owner/);

            // happy paths
            await locker.setLPFarm(lpFarm.address);
            await locker.setLPManager(await alan.getAddress(), true);
            await locker.setLockParams(80, 100);
            await locker.setRewardsManager(await alan.getAddress());
            await locker.stakerToggleMigrator(await owner.getAddress());

            await lpFarm.connect(validProxy).proxyToggleStaker(locker.address);
            await locker.setVeFXSProxy(await validProxy.getAddress());
        });

        it("should set lp farm", async () => {
            await locker.setLPFarm(await owner.getAddress());
            expect(await locker.lpFarm()).to.eq(await owner.getAddress());
        });

        it("should set lock params", async() => {
            await locker.setLockParams(80, 100);
            const [numerator, denominator] = await locker.lockRate();
            expect(numerator.toNumber()).to.eq(80);
            expect(denominator.toNumber()).to.eq(100);
        });

        it("should set reward tokens", async() => {
           await locker.setRewardTokens();
           const rewardTokens = await lpFarm.getAllRewardTokens();
           expect(await locker.rewardTokens(0)).to.eq(rewardTokens[0]);
           expect(await locker.rewardTokens(1)).to.eq(rewardTokens[1]);
        });

        it("should set rewards manager", async() => {
            await locker.setRewardsManager(rewardsManager.address);
            expect(await locker.rewardsManager()).to.eq(rewardsManager.address);
        });

        it("should set lp manager", async() => {
            await locker.setLPManager(await alan.getAddress(), true);
            expect(await locker.lpManagers(await alan.getAddress())).to.eq(true);
        });

        it("should toggle migrator for migration", async () => {
            await locker.stakerToggleMigrator(await owner.getAddress());
        });


        it("should return right time for max lock", async() => {
            expect(await locker.lockTimeForMaxMultiplier()).to.eq(7 * 86400);
        });

        it("should lock rightly", async() => {
            // case first lock
            await locker.setLockParams(80, 100);
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(100, ethers.utils.formatBytes32String("0x00"));
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(80);

            // locking additional with wrong kek_id
            shouldThrow(locker.connect(alan).lock(100, ethers.utils.formatBytes32String("0x00")), /Stake not found/);

            // case next lock
            const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
            const lockedStake = lockedStakes[0];
            const kekId = lockedStake.kek_id;
            await expect(locker.connect(alan).lock(50, kekId)).to.emit(locker, "Locked").withArgs(await alan.getAddress(), 40, 10);
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(120);

            // validate locker's lock
            expect(await lpFarm.lockedLiquidityOf(locker.address)).to.eq(120);
            expect(await locker.lockTimeForMaxMultiplier()).to.eq(lockedStake.ending_timestamp - lockedStake.start_timestamp);
            expect(lockedStake.lock_multiplier).to.eq(BigNumber.from("3000000000000000000"));

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            // try to lock in old kek_id, should create new lock
            await locker.connect(alan).lock(50, kekId);
            expect(await lpFarm.lockedStakesOfLength(locker.address)).to.eq(2);
            const newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
            expect(newLockedStakes[1].liquidity).to.eq(40);
        });

        it("should withdraw lock", async() => {
            // lock
            await locker.setLockParams(80, 100);
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(100, ethers.utils.formatBytes32String("0x00"));

            // fast forward to end of locktime
            await mineForwardSeconds(7 * 86400);

            // new lock stake
            const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
            const lockedStake = lockedStakes[0];
            const kekId = lockedStake.kek_id;
            await locker.connect(alan).lock(50, kekId)
            let newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
            const liquidity = await lpFarm.lockedLiquidityOf(locker.address);
            // withdraw and expect relock
            await expect(locker.withdrawLocked(kekId, newLockedStakes[1].kek_id)).to.emit(locker, "WithdrawLocked");
            // liquidity should remain the same due to relock
            expect(await lpFarm.lockedLiquidityOf(locker.address)).to.eq(liquidity);
            newLockedStakes = await lpFarm.lockedStakesOf(locker.address);
            
            // "deleted" old stake values should be null
            expect(newLockedStakes[0].start_timestamp).to.eq(0);
            expect(newLockedStakes[0].liquidity).to.eq(0);
            expect(newLockedStakes[0].ending_timestamp).to.eq(0);
            expect(newLockedStakes[0].lock_multiplier).to.eq(0);
        });

        it("lp manager withdraws lp token reserves", async () => {
            // lock and withdraw reserves
            // case first lock
            await locker.setLockParams(80, 100);
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(100, ethers.utils.formatBytes32String("0x00"));

            const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
            const lockedStake = lockedStakes[0];
            const kekId = lockedStake.kek_id;
            await locker.connect(alan).lock(100, kekId);
            
            // check reserves
            expect(await v2pair.balanceOf(locker.address)).to.eq(40);
            const lpBalanceLocker = await v2pair.balanceOf(locker.address);
            const lpBalanceManager = await v2pair.balanceOf(await alan.getAddress());
            console.log("bal of lp manager before withdrawing ", await v2pair.balanceOf(await alan.getAddress()));
            // withdraw reserves
            await locker.connect(alan).withdrawLPToken(lpBalanceLocker);
            expect(await v2pair.balanceOf(await alan.getAddress())).to.eq(lpBalanceLocker.add(lpBalanceManager));
        });

        it("owner can recover tokens", async () => {

        });
    });

    describe("Rewards", async () => {
        beforeEach(async () => {
            await locker.setLockParams(100, 100);
            await v2pair.connect(alan).approve(locker.address, 300);
            await staxLPToken.addMinter(locker.address);
            await locker.connect(alan).lock(300, ethers.utils.formatBytes32String("0x00"));

            await locker.setRewardTokens();
            await locker.setRewardsManager(rewardsManager.address);

            // send fxs and templ to lp farm to ensure enough reward tokens before fast forwarding
            fxsToken.connect(fraxMultisig).transfer(lpFarm.address, await fxsToken.balanceOf(await fraxMultisig.getAddress()));
            templeToken.connect(templeMultisig).transfer(lpFarm.address, await templeToken.balanceOf(await templeMultisig.getAddress()));
        });

        it("gets rewards", async () => {
            // fast forward
            await mineForwardSeconds(10 * 86400);

            await locker.getReward();
        });

        it("harvests rewards", async () => {
            // fast forward and get reward
            await mineForwardSeconds(10 * 86400);
            await locker.getReward();
            const templeBalanceBefore = await templeToken.balanceOf(locker.address);
            const fxsBalanceBefore = await fxsToken.balanceOf(locker.address);

            console.log(await locker.rewardTokens(0));

            //await locker.harvestRewards();
            await expect(locker.harvestRewards()).to.emit(locker, "RewardHarvested");

            expect(await templeToken.balanceOf(rewardsManager.address)).to.eq(templeBalanceBefore);
            expect(await fxsToken.balanceOf(rewardsManager.address)).to.eq(fxsBalanceBefore);
        });
    });
});