import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, shouldThrow, blockTimestamp } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    LockerProxy, LockerProxy__factory, 
    TempleUniswapV2Pair__factory,
    RewardsManager, RewardsManager__factory, 
    StaxLPStaking, StaxLPStaking__factory, 
    FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory, 
    ERC20, ERC20__factory, 
    LiquidityOps, LiquidityOps__factory,
    CurvePool, CurvePool__factory,
    CurveFactory, CurveFactory__factory
} from "../typechain";
import { curveFactoryAddress, fraxMultisigAddress,
    fraxUnifiedFarmAddress, fxsTokenAddress,
    lpBigHolderAddress, lpTokenAddress,
    templeMultisigAddress, templeTokenAddress 
} from "./addresses";

describe("Staking", async () => {
    let owner: Signer;
    let alan: Signer;
    let ben: Signer;
    let lpBigHolder: Signer;
    let fraxMultisig: Signer;
    let templeMultisig: Signer;
    let v2pair: Contract; //TempleUniswapV2Pair
    let locker: LockerProxy;
    let lpFarm: Contract; //FraxUnifiedFarmERC20;
    let rewardsManager: RewardsManager;
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let templeToken: ERC20;
    let staxLPToken: StaxLP;
    let liquidityOps: LiquidityOps;
    let curvePool: CurvePool;
    let curveFactory: CurveFactory;

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
        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

        // Create the curve stable swap
        {
            curveFactory = CurveFactory__factory.connect(curveFactoryAddress, owner);
            const numPoolsBefore = await curveFactory.pool_count({gasLimit: 300000});

            // weird type bug in this test
            const coins: [string,string,string,string] = [
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
            
            expect(await curveFactory.pool_count({gasLimit: 300000})).to.eq(numPoolsBefore.add(1));
        
            const curvePoolAddresses = await curveFactory.functions['find_pool_for_coins(address,address)']
                (staxLPToken.address, v2pair.address, {gasLimit: 300000});
            expect(curvePoolAddresses.length).eq(1);
            const curvePoolAddress = curvePoolAddresses[0];
            expect(curvePoolAddress).not.eq(ZERO_ADDRESS);

            curvePool = CurvePool__factory.connect(curvePoolAddress, owner);
            expect((await curvePool.name({gasLimit: 300000}))).eq('Curve.fi Factory Plain Pool: STAX TEMPLE/FRAX xLP + LP');
        }
        
        liquidityOps = await new LiquidityOps__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address,
            curvePool.address, rewardsManager.address);

        locker = await new LockerProxy__factory(owner).deploy(liquidityOps.address, v2pair.address, staxLPToken.address, staking.address);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
        templeToken = ERC20__factory.connect(templeTokenAddress, alan);

        // impersonate temple msig
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [templeMultisigAddress]
        });
        templeMultisig = await ethers.getSigner(templeMultisigAddress);
        
        // impersonate account and transfer lp tokens
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [lpBigHolderAddress],
        });
        lpBigHolder = await ethers.getSigner(lpBigHolderAddress);

        await v2pair.connect(lpBigHolder).transfer(await templeMultisig.getAddress(), 10000);
        await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 110000000);

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
            BigNumber.from(86400 * 7), // max lock time: reduce to 7 days
            BigNumber.from(86400 * 1) // min lock time
        ]);

        // Set the gauge temple rewards to a higher rate (same as fxs as of now)
        await lpFarm.connect(fraxMultisig).setRewardVars(
            templeToken.address, await lpFarm.rewardRates(0), 
            ZERO_ADDRESS, ZERO_ADDRESS);
            
        await liquidityOps.setRewardTokens();
        await staking.setRewardDistributor(rewardsManager.address);
        await staking.addReward(fxsToken.address);
        await staking.addReward(templeToken.address);

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
        }

        await liquidityOps.setCurvePool0();

        // send fxs and temple to lp farm to ensure enough reward tokens before fast forwarding
        fxsToken.connect(fraxMultisig).transfer(lpFarm.address, BigNumber.from("10").pow(23)); //await fxsToken.balanceOf(await fraxMultisig.getAddress()));
        templeToken.connect(templeMultisig).transfer(lpFarm.address, BigNumber.from("10").pow(23)); //await templeToken.balanceOf(await templeMultisig.getAddress()));
    });

    it("admin tests", async () => {
        await shouldThrow(staking.connect(ben).setRewardDistributor(await alan.getAddress()), /Ownable: caller is not the owner/)
        await shouldThrow(staking.connect(ben).addReward(fxsToken.address), /Ownable: caller is not the owner/);

        // happy paths
        await staking.setRewardDistributor(await ben.getAddress());
        await staking.addReward(staxLPToken.address);
    });

    it("stake, claim rewards, withdraw xlp token", async () => {
        // stake all. stake for, stake
        // do some locking
        await liquidityOps.setLockParams(80, 100);
        await liquidityOps.setCurvePool0();
        await staxLPToken.addMinter(locker.address);
        await staxLPToken.addMinter(liquidityOps.address);
        await v2pair.connect(alan).approve(locker.address, 10000);

        await locker.connect(alan).lock(10000);
        expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(10000);

        // lock stake and add liquidity
        await liquidityOps.applyLiquidity();

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

        // claim rewards
        const lockerFXSBalBefore = await fxsToken.balanceOf(liquidityOps.address);
        const lockerTempleBalBefore = await templeToken.balanceOf(liquidityOps.address);
        await liquidityOps.getReward();
        const lockerFXSBalAfter = await fxsToken.balanceOf(liquidityOps.address);
        const lockerTempleBalAfter = await templeToken.balanceOf(liquidityOps.address);
        expect(lockerFXSBalAfter).to.gt(lockerFXSBalBefore);
        expect(lockerTempleBalAfter).to.gt(lockerTempleBalBefore);

        // fast forward again and getRewards
        await mineForwardSeconds(2 * 86400);
        await liquidityOps.getReward();
        const lockerFXSBalAfter2 = await fxsToken.balanceOf(liquidityOps.address);
        const lockerTempleBalAfter2 = await fxsToken.balanceOf(liquidityOps.address);

        expect(lockerFXSBalAfter2).to.gt(lockerFXSBalAfter);
        expect(lockerTempleBalAfter2).to.gt(lockerTempleBalAfter);

        // harvest rewards to rewards manager
        await liquidityOps.harvestRewards();

        // also send more fxs and temple to rewards manager before distribution
        // so that rewards sent are more than 86400 * 7 (as division for rewardRate is 0 for smaller values)
        await fxsToken.connect(fraxMultisig).transfer(rewardsManager.address, 86400 * 21 * 1e6);
        await templeToken.connect(templeMultisig).transfer(rewardsManager.address, 86400 * 10 * 1e6);
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

        expect(await staking.rewardPerToken(fxsToken.address)).gt(0);
        expect(await staking.rewardPerToken(templeToken.address)).gt(0);

        const fxsRewardData = await staking.rewardData(fxsToken.address);
        const templeRewardData = await staking.rewardData(templeToken.address);
        expect(fxsRewardData.rewardRate).gt(0);
        expect(templeRewardData.rewardRate).gt(0);

        const alanFXSBalBefore = await fxsToken.balanceOf(await alan.getAddress());
        const alanTempleBalBefore = await templeToken.balanceOf(await alan.getAddress());
        expect(alanFXSBalBefore).eq(0);
        expect(alanTempleBalBefore).eq(0);

        const alanFXSEarned = await staking.earned(await alan.getAddress(), fxsToken.address);
        const alanTempleEarned = await staking.earned(await alan.getAddress(), templeToken.address);

        // Alan claims the rewards
        await staking.connect(alan).getRewards(await alan.getAddress());

        const alanFXSBalAfter = await fxsToken.balanceOf(await alan.getAddress());
        const alanTempleBalAfter = await templeToken.balanceOf(await alan.getAddress());
        
        const currentTimestamp = await blockTimestamp();
        const elapsedFxsRewardDuration = currentTimestamp - fxsRewardStartTime;

        // Note - the order of operations matters because of trunction with the divisions.
        const expectedFxsRewardPerToken = rewardsManagerFXSBal
            .div(await staking.DURATION())
            .mul(elapsedFxsRewardDuration)
            .div(await staking.totalSupply());
        expect(await staking.rewardPerToken(fxsToken.address)).eq(expectedFxsRewardPerToken);
        
        const elapsedTempleRewardDuration = currentTimestamp - templeRewardStartTime;
        const expectedTempleRewardPerToken = rewardsManagerTempleBal
            .div(await staking.DURATION())
            .mul(elapsedTempleRewardDuration)
            .div(await staking.totalSupply());
        expect(await staking.rewardPerToken(templeToken.address)).eq(expectedTempleRewardPerToken);

        // Check the rewards alan was paid matches expectations
        expect(expectedFxsRewardPerToken.mul(alanXlpStaked)).eq(alanFXSBalAfter);
        expect(expectedTempleRewardPerToken.mul(alanXlpStaked)).eq(alanTempleBalAfter);
        
        expect(alanFXSBalAfter).to.gt(alanFXSEarned.add(alanFXSBalBefore));
        expect(alanTempleBalAfter).to.gt(alanTempleEarned.add(alanTempleBalBefore));

        // after some time, account should have earned rewards but significantly lesser than previously earned
        expect(await staking.earned(await alan.getAddress(), fxsToken.address)).to.lt(alanFXSEarned);
        expect(await staking.earned(await alan.getAddress(), templeToken.address)).to.lt(alanTempleEarned);
      
        // withdraw xlp
        const alanXlpBalBefore = await staxLPToken.balanceOf(await alan.getAddress());
        await staking.connect(alan).withdraw(100, true);
        expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(alanXlpBalBefore.add(100));
        await staking.connect(alan).withdrawAll(true);
        expect(await staking.balanceOf(await alan.getAddress())).to.eq(0);
        expect(await staxLPToken.balanceOf(await alan.getAddress())).to.eq(alanXlpBalBefore.add(alanXlpStaked));

        // get rewards
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
            (0, 1, alanXlpBal, lpAmount, await alan.getAddress(), {gasLimit: 1300000});
        expect(await v2pair.balanceOf(await alan.getAddress())).to.eq(lpAmount.add(alanLpBal));
    });
});
