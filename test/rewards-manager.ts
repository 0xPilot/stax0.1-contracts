import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import { shouldThrow, toAtto } from "./helpers";
import { 
    TempleUniswapV2Pair__factory, 
    RewardsManager, RewardsManager__factory,
    StaxLPStaking, StaxLPStaking__factory, 
    ERC20, ERC20__factory
} from "../typechain";

import { lpTokenAddress, fxsTokenAddress, fraxMultisigAddress } from "./addresses";

describe("Rewards Manager", async () => {
    let owner: Signer;
    let alan: Signer;
    let v2pair: Contract; //TempleUniswapV2Pair
    let staking: StaxLPStaking;
    let fxsToken: ERC20;
    let rewardsManager: RewardsManager;

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
        [owner, alan] = await ethers.getSigners();
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staking = await new StaxLPStaking__factory(owner).deploy(v2pair.address, await alan.getAddress());
        rewardsManager = await new RewardsManager__factory(owner).deploy(staking.address);

        fxsToken = ERC20__factory.connect(fxsTokenAddress, alan);
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

    it("admin tests", async () => {
        await shouldThrow(rewardsManager.connect(alan).distribute(fxsToken.address), /Ownable: caller is not the owner/);
        await shouldThrow(rewardsManager.distribute(fxsTokenAddress), /not distributor/);
    });

    it("no rewards set", async () => {
        await staking.setRewardDistributor(rewardsManager.address);

        await shouldThrow(rewardsManager.distribute(fxsTokenAddress), /No reward/);

        // Transfer 100 FXS to the rewards manager, for distribution.
        const fxsRewards = toAtto(100);
        await transferAs(fxsToken, fraxMultisigAddress, rewardsManager.address, fxsRewards);

        // oops haven't whitelisted FXS to the known rewards.
        await shouldThrow(rewardsManager.distribute(fxsTokenAddress), /unknown reward token/);

        // Add the reward token to the whitelist
        await staking.addReward(fxsToken.address);
        // Can't add the same reward token twice
        await shouldThrow(staking.addReward(fxsToken.address), /exists/);

        expect(await staking.rewardTokens(0)).eq(fxsTokenAddress);
    });

    it("can distribute", async () => {
        await staking.setRewardDistributor(rewardsManager.address);
        await staking.addReward(fxsToken.address);

        // Transfer 100 FXS to the rewards manager, for distribution.
        const fxsRewards = toAtto(100);
        await transferAs(fxsToken, fraxMultisigAddress, rewardsManager.address, fxsRewards);

        // staking starts out with 0 FXS
        const balBefore = await fxsToken.balanceOf(staking.address);
        expect(balBefore).eq(0);

        // Success - distributed.
        await expect(rewardsManager.distribute(fxsTokenAddress))
            .to.emit(rewardsManager, "RewardDistributed")
            .withArgs(staking.address, fxsTokenAddress, fxsRewards);

        // staking has been transferred the FXS distribution.
        const balAfter = await fxsToken.balanceOf(staking.address);
        expect(balAfter).eq(fxsRewards);

        // Nothing has been staked yet, so the reward per token stored == 0 since totalSupply() == 0
        const rewardData = await staking.rewardData(fxsTokenAddress);
        expect(rewardData.rewardPerTokenStored).eq(BigNumber.from("0"));
    });
});
