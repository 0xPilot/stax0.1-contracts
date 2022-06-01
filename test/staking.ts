import { ethers, network } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, shouldThrow, blockTimestamp, ZERO_ADDRESS, toAtto } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    LockerProxy, LockerProxy__factory, 
    TempleUniswapV2Pair__factory,
    RewardsManager, RewardsManager__factory, 
    StaxLPStaking, StaxLPStaking__factory, 
    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, 
    ERC20, ERC20__factory, 
    LiquidityOps, LiquidityOps__factory,
    CurvePool, 
    TempleUniswapV2Pair, FraxUnifiedFarmERC20,
} from "../typechain";
import { fraxMultisigAddress,
    fraxUnifiedFarmAddress, fxsTokenAddress,
    lpBigHolderAddress, lpTokenAddress,
    templeMultisigAddress, templeTokenAddress 
} from "./addresses";
import { createCurveStableSwap } from "./curve-pool-helper";

describe("Staking", async () => {
    let owner: Signer;
    let alan: Signer;
    let ben: Signer;
    let lpBigHolder: Signer;
    let fraxMultisig: Signer;
    let templeMultisig: Signer;
    let v2pair: TempleUniswapV2Pair
    let locker: LockerProxy;
    let lpFarm: FraxUnifiedFarmERC20;
    let rewardsManager: RewardsManager;
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let templeToken: ERC20;
    let staxLPToken: StaxLP;
    let liquidityOps: LiquidityOps;
    let curvePool: CurvePool;

    const ONE_E_18 = BigNumber.from(10).pow(18);

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
        [owner, alan, ben] = await ethers.getSigners();
        // lp token
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
        staking = await new StaxLPStaking__factory(owner).deploy(staxLPToken.address, await alan.getAddress());
        // for off-chain view functions
        lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(fraxUnifiedFarmAddress, alan);
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

            await v2pair.connect(lpBigHolder).transfer(await templeMultisig.getAddress(), 1000000);
        }

        curvePool = await createCurveStableSwap(owner, staxLPToken, v2pair, templeMultisig);
        
        liquidityOps = await new LiquidityOps__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address,
            curvePool.address, rewardsManager.address, await owner.getAddress());
        locker = await new LockerProxy__factory(owner).deploy(liquidityOps.address, v2pair.address, 
            staxLPToken.address, staking.address, curvePool.address);
        await staxLPToken.addMinter(locker.address);

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

            // Set the gauge temple rewards to a higher rate (same as fxs as of now)
            await lpFarm.connect(fraxMultisig).setRewardVars(
                templeToken.address, await lpFarm.rewardRates(0), 
                ZERO_ADDRESS, ZERO_ADDRESS);
        }
            
        await liquidityOps.setRewardTokens();
        await rewardsManager.setOperator(await owner.getAddress());
        await staking.setRewardDistributor(rewardsManager.address);
        await staking.addReward(fxsToken.address);
        await staking.addReward(templeToken.address);

        await liquidityOps.setFarmLockTime(86400 * 7); // 7 days
        await liquidityOps.setLockParams(80, 100);
        await staxLPToken.addMinter(locker.address);
        await staxLPToken.addMinter(liquidityOps.address);
    });

    it("admin tests", async () => {
        await shouldThrow(staking.connect(ben).setRewardDistributor(await alan.getAddress()), /Ownable: caller is not the owner/)
        await shouldThrow(staking.connect(ben).addReward(fxsToken.address), /Ownable: caller is not the owner/);
        await shouldThrow(staking.connect(ben).addReward(fxsToken.address), /Ownable: caller is not the owner/);
        await shouldThrow(staking.connect(ben).setMigrator(await alan.getAddress()), /Ownable: caller is not the owner/);
        await shouldThrow(staking.migrateWithdraw(await alan.getAddress(), 100), /not migrator/);

        // happy paths
        await staking.setRewardDistributor(await ben.getAddress());
        await staking.addReward(staxLPToken.address);
        await staking.setMigrator(await alan.getAddress());
    });

    it("should set migrator", async () => {
        await expect(staking.setMigrator(await alan.getAddress()))
            .to.emit(staking, "MigratorSet")
            .withArgs(await alan.getAddress());
        expect(await staking.migrator()).eq(await alan.getAddress());
    });

    // impersonate the from address so we can sign the transfer.
    async function transferAs(token: ERC20, fromAddress: string, toAddress: string, amount: BigNumber) {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [fromAddress]
        });
        const signer = await ethers.getSigner(fromAddress);

        await fxsToken.connect(signer).transfer(toAddress, amount);
        
        await network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [fromAddress]
        });
    }

    it("staking contracts should migrate", async () => {
        // Alan locks and stakes in the old contract.
        const amount = 10000;
        await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), amount);
        await v2pair.connect(alan).approve(locker.address, amount);
        await locker.connect(alan).lock(amount, true);
        await expect(await staking.balanceOf(await alan.getAddress())).eq(amount);
        
        // Transfer 100 FXS to the rewards manager, for distribution.
        const fxsRewards = toAtto(500);
        await transferAs(fxsToken, fraxMultisigAddress, rewardsManager.address, fxsRewards);
        await rewardsManager.distribute(fxsTokenAddress);

        // Fast forward so we have some rewards to claim.
        await mineForwardSeconds(2 * 86400);

        const fxsEarned = await staking.earned(await alan.getAddress(), fxsToken.address);
        expect(fxsEarned).gt(0);

        // Create a new contract
        const newStakingContract = await new StaxLPStaking__factory(owner).deploy(staxLPToken.address, await alan.getAddress());

        // The old staking contract sets the new staking contract as a valid migrator
        await staking.setMigrator(newStakingContract.address);

        // Can't withdraw more than we have staked
        await shouldThrow(newStakingContract.connect(alan).migrateStake(staking.address, amount+1, {gasLimit: 500000}), /Not enough staked tokens/);        

        // Now Alan migrates his stake over to the new contract.
        await expect(newStakingContract.connect(alan).migrateStake(staking.address, amount))
            .to.emit(newStakingContract, "Staked")
            .withArgs(await alan.getAddress(), amount);

        // Alan's gets the FXS rewards earnt from the old contract paid directly to him.
        expect(await fxsToken.balanceOf(await alan.getAddress())).gt(fxsEarned);

        // The old contract has no staked balance or earned rewards
        expect(await staking.balanceOf(await alan.getAddress())).eq(0);
        expect(await staking.earned(await alan.getAddress(), fxsToken.address)).eq(0);

        // The new contract has the staked balance
        expect(await newStakingContract.balanceOf(await alan.getAddress())).eq(amount);

        // And the new staking contract has no rewards yet as nothing has been distributed here.
        expect(await newStakingContract.earned(await alan.getAddress(), fxsToken.address)).eq(0);
    });

    describe("Staking and Rewards", async () => {
        beforeEach(async () => {
            // send fxs and temple to lp farm to ensure enough reward tokens before fast forwarding
            fxsToken.connect(fraxMultisig).transfer(lpFarm.address, BigNumber.from("10").pow(23));
            templeToken.connect(templeMultisig).transfer(lpFarm.address, BigNumber.from("10").pow(23));

            // start alan with empty fxs & temple by sending any surplus back to the multisigs
            fxsToken.transfer(await fraxMultisig.getAddress(), await fxsToken.balanceOf(await alan.getAddress()));
            templeToken.transfer(await templeMultisig.getAddress(), await templeToken.balanceOf(await alan.getAddress()));
        });

        // Check that the expected rewardPerToken and actual rewards paid to
        // the signer match expected.
        async function checkExpectedRewardPaid(
          rewardToken: ERC20, signer: Signer, previousTimestamp: number, 
          prevRewardPerToken: BigNumber, prevRewardsPerTokenPaid: BigNumber,
          prevEarned: BigNumber) {
            const signerAddress = await signer.getAddress();
            const currentTimestamp = await blockTimestamp();
            const elapsedRewardDuration = currentTimestamp - previousTimestamp;
            const totalStakedSupply = await staking.totalSupply();
            const signerXlpStaked = await staking.balanceOf(signerAddress);

            // The rewardPerToken is calculated based off the current total supply of staked
            // and the amount of time elapsed since the last checkpoint
            const rewardData = await staking.rewardData(rewardToken.address);
            const expectedRewardPerToken = prevRewardPerToken.add(
                rewardData.rewardRate
                .mul(elapsedRewardDuration)
                .mul(ONE_E_18)
                .div(totalStakedSupply)
            );
            expect(await staking.rewardPerToken(rewardToken.address)).eq(expectedRewardPerToken);

            const actualRewardBal = await rewardToken.balanceOf(signerAddress);
            const expectedRewardBal = ((expectedRewardPerToken.sub(prevRewardsPerTokenPaid))
                .mul(signerXlpStaked)
                .div(ONE_E_18))
                .add(prevEarned);
            expect(expectedRewardBal).eq(actualRewardBal);
        }

        async function testRewardCalcs(lockAndStakeAmount: BigNumber, fxsRewards: BigNumber, templeRewards: BigNumber) {
            // Give alan some LP, and lock it.
            await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), lockAndStakeAmount);
            await v2pair.connect(alan).approve(locker.address, lockAndStakeAmount);
            await locker.connect(alan).lock(lockAndStakeAmount, false);
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(lockAndStakeAmount);

            // lock stake and add liquidity
            const slippage = 5e9;
            const minCurveAmountOut = await liquidityOps.minCurveLiquidityAmountOut(lockAndStakeAmount, slippage);
            await liquidityOps.applyLiquidity(lockAndStakeAmount, minCurveAmountOut);

            // stake xLP tokens
            const xlpBalAlan = await staxLPToken.balanceOf(await alan.getAddress());
            await staxLPToken.connect(alan).approve(staking.address, xlpBalAlan);
            await staking.connect(alan).stakeFor(await ben.getAddress(), 1000);
            await staking.connect(alan).stake(2000);
            await expect(staking.connect(alan).stakeAll()).to.emit(staking, "Staked").withArgs(await alan.getAddress(), xlpBalAlan.sub(3000));
            expect(await staking.balanceOf(await ben.getAddress())).to.eq(1000);
            const alanXlpStaked = await staking.balanceOf(await alan.getAddress());
            expect(alanXlpStaked).to.eq(xlpBalAlan.sub(1000));

            // fast forward
            await mineForwardSeconds(2 * 86400);

            // liquidity ops claim rewards
            const lockerFXSBalBefore = await fxsToken.balanceOf(liquidityOps.address);
            const lockerTempleBalBefore = await templeToken.balanceOf(liquidityOps.address);
            await liquidityOps.getReward();
            const lockerFXSBalAfter = await fxsToken.balanceOf(liquidityOps.address);
            const lockerTempleBalAfter = await templeToken.balanceOf(liquidityOps.address);
            expect(lockerFXSBalAfter).to.gt(lockerFXSBalBefore);
            expect(lockerTempleBalAfter).to.gt(lockerTempleBalBefore);

            // fast forward again and liquidity ops getRewards
            await mineForwardSeconds(2 * 86400);
            await liquidityOps.getReward();
            const lockerFXSBalAfter2 = await fxsToken.balanceOf(liquidityOps.address);
            const lockerTempleBalAfter2 = await fxsToken.balanceOf(liquidityOps.address);

            expect(lockerFXSBalAfter2).to.gt(lockerFXSBalAfter);
            expect(lockerTempleBalAfter2).to.gt(lockerTempleBalAfter);

            // harvest rewards to rewards manager
            await liquidityOps.harvestRewards();

            // Send even more fxs and temple to rewards manager before distribution
            // so that rewards sent are more than 86400 * 7 (as division for rewardRate is 0 for smaller values)
            await fxsToken.connect(fraxMultisig).transfer(rewardsManager.address, fxsRewards);
            await templeToken.connect(templeMultisig).transfer(rewardsManager.address, templeRewards);
            const rewardsManagerFXSBal = await fxsToken.balanceOf(rewardsManager.address);
            const rewardsManagerTempleBal = await templeToken.balanceOf(rewardsManager.address);
            
            // distribute rewards to stakers, and keep track of the timestamp for checking rewards payments
            await rewardsManager.distribute(fxsToken.address);
            const fxsRewardStartTime = await blockTimestamp();

            await rewardsManager.distribute(templeToken.address);
            const templeRewardStartTime = await blockTimestamp();
            
            expect(await fxsToken.balanceOf(staking.address)).to.eq(rewardsManagerFXSBal);
            expect(await templeToken.balanceOf(staking.address)).to.eq(rewardsManagerTempleBal);

            expect(await fxsToken.balanceOf(rewardsManager.address)).to.eq(0);
            expect(await templeToken.balanceOf(rewardsManager.address)).to.eq(0);
            
            // fast forward 2 days
            await mineForwardSeconds(2 * 86400);

            // Keep track of the amount staked for future calcs
            const totalSupplyBeforeMoreStaking = await staking.totalSupply();

            // Ben stakes some more to make things even more interesting.
            const lockAndStakeAmount2 = 20000000;
            await v2pair.connect(lpBigHolder).transfer(await ben.getAddress(), lockAndStakeAmount2);
            await v2pair.connect(ben).approve(locker.address, lockAndStakeAmount2);
            await locker.connect(ben).lock(lockAndStakeAmount2, true);

            // Staking above updated the reward data - check it matches expectations
            const fxsRewardData = await staking.rewardData(fxsToken.address);
            const templeRewardData = await staking.rewardData(templeToken.address);
            expect(fxsRewardData.rewardRate).eq(rewardsManagerFXSBal.div(await staking.DURATION()));
            expect(templeRewardData.rewardRate).eq(rewardsManagerTempleBal.div(await staking.DURATION()));
            
            // Get current balances and earned amounts. 
            const alanFXSBalBefore = await fxsToken.balanceOf(await alan.getAddress());
            const alanTempleBalBefore = await templeToken.balanceOf(await alan.getAddress());
            const alanFXSEarned = await staking.earned(await alan.getAddress(), fxsToken.address);
            const alanTempleEarned = await staking.earned(await alan.getAddress(), templeToken.address);
            const benFXSEarned = await staking.earned(await ben.getAddress(), fxsToken.address);
            const benTempleEarned = await staking.earned(await ben.getAddress(), templeToken.address);
         
            // Ben's claimableRewards should now equal the earned amounts. Alan's hasn't been updated yet
            expect(await staking.claimableRewards(await alan.getAddress(), fxsToken.address)).eq(0);
            expect(await staking.claimableRewards(await alan.getAddress(), templeToken.address)).eq(0);
            expect(await staking.claimableRewards(await ben.getAddress(), fxsToken.address)).eq(benFXSEarned);
            expect(await staking.claimableRewards(await ben.getAddress(), templeToken.address)).eq(benTempleEarned);

            const currentTimestamp = await blockTimestamp();
            const elapsedFxsRewardDuration = currentTimestamp - fxsRewardStartTime;

            const expectedFxsRewardPerToken = fxsRewardData.rewardRate
                .mul(elapsedFxsRewardDuration)
                .mul(ONE_E_18)
                .div(totalSupplyBeforeMoreStaking);
            const actualFxsRewardPerToken = await staking.rewardPerToken(fxsToken.address);
            expect(actualFxsRewardPerToken).eq(expectedFxsRewardPerToken);
            
            const elapsedTempleRewardDuration = currentTimestamp - templeRewardStartTime;
            const expectedTempleRewardPerToken = templeRewardData.rewardRate
                .mul(elapsedTempleRewardDuration)
                .mul(ONE_E_18)
                .div(totalSupplyBeforeMoreStaking);
            const actualTempleRewardPerToken = await staking.rewardPerToken(templeToken.address);
            expect(actualTempleRewardPerToken).eq(expectedTempleRewardPerToken);

            // fast forward another 2 days
            await mineForwardSeconds(2 * 86400);

            // Alan claims the rewards - check it's the expected amounts/internal state
            await staking.connect(alan).getRewards(await alan.getAddress());

            checkExpectedRewardPaid(
                fxsToken, ben, currentTimestamp, 
                actualFxsRewardPerToken, BigNumber.from("0"),
                BigNumber.from("0"));
            checkExpectedRewardPaid(
                templeToken, ben, currentTimestamp, 
                actualTempleRewardPerToken, BigNumber.from("0"),
                BigNumber.from("0"));

            // Actual rewards received should be greater than when we last checked earned()
            // If the rewards are small then we might not have accrued any more in the
            // last couple of blocks -- so gte
            const alanFXSBal = await fxsToken.balanceOf(await alan.getAddress());
            expect(alanFXSBal).to.gte(alanFXSEarned.add(alanFXSBalBefore));
            const alanTempleBal = await templeToken.balanceOf(await alan.getAddress());
            expect(alanTempleBal).to.gte(alanTempleEarned.add(alanTempleBalBefore));

            // State from the current checkpoint, required as a basis for the next checkpoint
            const checkpointTime = await blockTimestamp();
            const fxsRewardPerToken = await staking.rewardPerToken(fxsToken.address);
            const templeRewardPerToken = await staking.rewardPerToken(templeToken.address);
            const benFxsRewardsPerTokenPaid = await staking.userRewardPerTokenPaid(await ben.getAddress(), fxsToken.address);
            const benTempleRewardsPerTokenPaid = await staking.userRewardPerTokenPaid(await ben.getAddress(), templeToken.address);

            // Ben claims the rewards - check it's the expected amounts/internal state
            await staking.connect(ben).getRewards(await ben.getAddress());
            checkExpectedRewardPaid(
                fxsToken, ben, checkpointTime, 
                fxsRewardPerToken, benFxsRewardsPerTokenPaid,
                benFXSEarned);
            checkExpectedRewardPaid(
                templeToken, ben, checkpointTime, 
                templeRewardPerToken, benTempleRewardsPerTokenPaid,
                benTempleEarned);

            // after some time, Alan's account should have earned rewards but significantly lesser than previously earned
            expect(await staking.earned(await alan.getAddress(), fxsToken.address)).to.lt(alanFXSEarned);
            expect(await staking.earned(await alan.getAddress(), templeToken.address)).to.lt(alanTempleEarned);
       
            // Can't withdraw more than we have staked.
            const alanXlpBalBefore = await staxLPToken.balanceOf(await alan.getAddress());
            await shouldThrow(staking.connect(alan).withdraw(alanXlpStaked.add(1), true), /Not enough staked tokens/);        

            // Alan withdraws xlp
            await staking.connect(alan).withdraw(100, true);
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(alanXlpBalBefore.add(100));
            await staking.connect(alan).withdrawAll(true);
            expect(await staking.balanceOf(await alan.getAddress())).to.eq(0);
            expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(alanXlpBalBefore.add(alanXlpStaked));

            // Alan gets rewards
            await staking.connect(alan).getRewards(await alan.getAddress());
            expect(await staking.claimableRewards(await alan.getAddress(), fxsToken.address)).to.eq(0);
            expect(await staking.claimableRewards(await alan.getAddress(), templeToken.address)).to.eq(0);

            // fast forward, alan should have no rewards remaining
            await mineForwardSeconds(1 * 86400);
            expect(await staking.claimableRewards(await alan.getAddress(), fxsToken.address)).to.eq(0);
            expect(await staking.claimableRewards(await alan.getAddress(), templeToken.address)).to.eq(0);

            // sell xlp tokens for lp tokens
            const alanXlpBal = await staxLPToken.balanceOf(await alan.getAddress());
            const alanLpBal = await v2pair.balanceOf(await alan.getAddress());
            const lpAmount = await curvePool.get_dy(0, 1, alanXlpBal);
            await staxLPToken.connect(alan).approve(curvePool.address, alanXlpBal);
            await curvePool.connect(alan).functions["exchange(int128,int128,uint256,uint256,address)"]
                (0, 1, alanXlpBal, lpAmount, await alan.getAddress());
            expect(await v2pair.balanceOf(await alan.getAddress())).to.eq(lpAmount.add(alanLpBal));
        }

        it("stake, claim rewards, withdraw xlp token. big stake, small rewards", async () => {
            const lockAmount = BigNumber.from("200000000");
            const rewardsAmountScale = 6;

            await testRewardCalcs(
                lockAmount, 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(21), 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(10));
        });
    
        it("stake, claim rewards, withdraw xlp token. big stake, big rewards", async () => {
            const lockAmount = BigNumber.from("200000000");
            const rewardsAmountScale = 16;

            await testRewardCalcs(
                lockAmount, 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(21), 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(10));
        });

        it("stake, claim rewards, withdraw xlp token. small stake, small rewards", async () => {
            const lockAmount = BigNumber.from("10000");
            const rewardsAmountScale = 6;

            await testRewardCalcs(
                lockAmount, 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(21), 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(10));
        });

        it("stake, claim rewards, withdraw xlp token. small stake, big rewards", async () => {
            const lockAmount = BigNumber.from("10000");
            const rewardsAmountScale = 16;

            await testRewardCalcs(
                lockAmount, 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(21), 
                BigNumber.from("10").pow(rewardsAmountScale).mul(86400).mul(10));
        });
    });
});
