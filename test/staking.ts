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
import { fraxMultisigAddress, fraxUnifiedFarmAddress, fxsTokenAddress, lpBigHolderAddress, lpTokenAddress, templeMultisigAddress, templeTokenAddress } from "./addresses";

describe("LP Locker", async () => {
    let owner: Signer;
    let alan: Signer;
    let ben: Signer;
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
    let staxLPToken: StaxLP;

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
        locker = await new LPLockerSingle__factory(owner).deploy(lpFarm.address, v2pair.address, staxLPToken.address, rewardsManager.address);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
        templeToken = ERC20__factory.connect(templeTokenAddress, alan);

        // 
        await locker.setLPManager(await alan.getAddress(), true);
        await locker.setRewardTokens();
        await staking.setRewardDistributor(rewardsManager.address);
        await staking.addReward(fxsToken.address);
        await staking.addReward(templeToken.address);
        
        // impersonate account and transfer lp tokens
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [lpBigHolderAddress],
        });
        lpBigHolder = await ethers.getSigner(lpBigHolderAddress);

        const lpBal = await v2pair.balanceOf(lpBigHolderAddress);
        console.log("lp bal", lpBal);
        await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), lpBal);

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
            BigNumber.from(86400 * 7), // max lock time: reduce to 7 days
            BigNumber.from(86400 * 1) // min lock time
        ]);
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
        await locker.setLockParams(80, 100);
        const lpBal = await v2pair.balanceOf(await alan.getAddress());
        await v2pair.connect(alan).approve(locker.address, lpBal);
        await staxLPToken.addMinter(locker.address);
        await locker.connect(alan).lock(100000000, ethers.utils.formatBytes32String("0x00"));

        const lockedStakes = await lpFarm.lockedStakesOf(locker.address);
        const lockedStake = lockedStakes[0];
        const kekId = lockedStake.kek_id;
        await locker.connect(alan).lock(5000000, kekId);
        await locker.connect(alan).lock(5000000, kekId);

        // stake xLP tokens
        const xlpBalAlan = await staxLPToken.balanceOf(await alan.getAddress());
        await staxLPToken.connect(alan).approve(staking.address, xlpBalAlan);
        await staking.connect(alan).stakeFor(await ben.getAddress(), 1000);
        await staking.connect(alan).stake(2000);
        await expect(staking.connect(alan).stakeAll()).to.emit(staking, "Staked").withArgs(await alan.getAddress(), xlpBalAlan.sub(3000));
        expect(await staking.balanceOf(await ben.getAddress())).to.eq(1000);
        expect(await staking.balanceOf(await alan.getAddress())).to.eq(xlpBalAlan.sub(1000));

        // fast forward
        await mineForwardSeconds(2 * 86400);

        // claim rewards
        const lockerFXSBalBefore = await fxsToken.balanceOf(locker.address);
        const lockerTempleBalBefore = await templeToken.balanceOf(locker.address);
        await locker.getReward();
        const lockerFXSBalAfter = await fxsToken.balanceOf(locker.address);
        const lockerTempleBalAfter = await templeToken.balanceOf(locker.address);
        console.log(lockerFXSBalBefore, lockerFXSBalAfter);
        console.log(lockerTempleBalBefore, lockerTempleBalAfter);
        expect(lockerFXSBalAfter).to.gt(lockerFXSBalBefore);
        expect(lockerTempleBalAfter).to.gt(lockerTempleBalBefore);

        // fast forward again and getRewards
        await mineForwardSeconds(2 * 86400);
        await locker.getReward();
        const lockerFXSBalAfter2 = await fxsToken.balanceOf(locker.address);
        const lockerTempleBalAfter2 = await templeToken.balanceOf(locker.address);
        expect(lockerFXSBalAfter2).to.gt(lockerFXSBalAfter);
        expect(lockerTempleBalAfter2).to.gt(lockerTempleBalAfter);

        // harvest rewards to rewards manager
        await locker.harvestRewards();

        // distribute rewards to stakers
        // also send more fxs and temple to rewards manager before distribution
        // so that rewards sent are more than 86400 * 7 (as division for rewardRate is 0 for smaller values)
        await fxsToken.connect(fraxMultisig).transfer(rewardsManager.address, 86400 * 21);
        await templeToken.connect(templeMultisig).transfer(rewardsManager.address, 86400 * 10);
        const rewardsManagerFXSBal = await fxsToken.balanceOf(rewardsManager.address);
        const rewardsManagerTempleBal = await templeToken.balanceOf(rewardsManager.address);
        console.log("rewards manager ", rewardsManagerFXSBal, rewardsManagerTempleBal);
        await rewardsManager.distribute(fxsToken.address);
        await rewardsManager.distribute(templeToken.address);
        expect(await fxsToken.balanceOf(staking.address)).to.eq(rewardsManagerFXSBal);
        expect(await templeToken.balanceOf(staking.address)).to.eq(rewardsManagerTempleBal);

        // fast forward??
        await mineForwardSeconds(2 * 86400);
        console.log("reward per token ", await staking.rewardPerToken(fxsToken.address));
        console.log("reward data , reward per token stored ", await staking.rewardData(fxsToken.address));

        // claim rewards
        console.log("alan earned fxs ", await staking.earned(await alan.getAddress(), fxsToken.address));
        console.log("reward tokens ", (await staking.rewardTokens(0)))
        console.log("reward tokens ", (await staking.rewardTokens(1)))
        const alanFXSBalBefore = await fxsToken.balanceOf(await alan.getAddress());
        const alanTempleBalBefore = await templeToken.balanceOf(await alan.getAddress());

        const alanFXSEarned = await staking.earned(await alan.getAddress(), fxsToken.address);
        const alanTempleEarned = await staking.earned(await alan.getAddress(), templeToken.address);
        await staking.connect(alan).getRewards(await alan.getAddress());

        const alanFXSBalAfter = await fxsToken.balanceOf(await alan.getAddress());
        const alanTempleBalAfter = await templeToken.balanceOf(await alan.getAddress());
        console.log("alan rewards before ", alanFXSBalBefore, alanTempleBalBefore);
        console.log("alan rewards after ", alanFXSBalAfter, alanTempleBalAfter);
        expect(alanFXSBalAfter).to.gte(alanFXSEarned.add(alanFXSBalBefore)); // gte because account earns every block/tx mine
        expect(alanTempleBalAfter).to.gte(alanTempleEarned.add(alanTempleBalBefore));
        // after some time, account should have earned rewards but significantly lesser than previously earned
        expect(await staking.earned(await alan.getAddress(), fxsToken.address)).to.lt(alanFXSEarned);
        expect(await staking.earned(await alan.getAddress(), templeToken.address)).to.lt(alanTempleEarned);
        
        // withdraw xlp
        const alanXlpBalBefore = await staxLPToken.balanceOf(await alan.getAddress());
        const alanXlpStaked = await staking.balanceOf(await alan.getAddress());
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

        // TODO: (pb) sell xlp tokens for lp tokens
    });
});
