import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    LockerProxy, LockerProxy__factory,
    TempleUniswapV2Pair, TempleUniswapV2Pair__factory,
    StaxLPStaking, StaxLPStaking__factory
} from "../typechain";

import { 
    lpBigHolderAddress, lpTokenAddress } from "./addresses";

describe("Locker Proxy", async () => {
    let staxLPToken: StaxLP;
    let owner: Signer;
    let alan: Signer;
    let ben: Signer;
    let liquidityOps: Signer;
    let lpBigHolder: Signer;
    let v2pair: TempleUniswapV2Pair;
    let locker: LockerProxy;
    let staking: StaxLPStaking;

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
        [owner, alan, ben, liquidityOps] = await ethers.getSigners();
        // lp token
        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
        staking = await new StaxLPStaking__factory(owner).deploy(staxLPToken.address, await alan.getAddress());
        locker = await new LockerProxy__factory(owner).deploy(await liquidityOps.getAddress(), v2pair.address, staxLPToken.address, staking.address);

        // impersonate account and transfer lp tokens
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [lpBigHolderAddress],
        });
        lpBigHolder = await ethers.getSigner(lpBigHolderAddress);

        await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 300);
        await v2pair.connect(lpBigHolder).transfer(await ben.getAddress(), 300);
        await network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [lpBigHolderAddress],
        });
    });

    describe("Locking", async () => {

        it("admin tests", async () => {
            await shouldThrow(locker.connect(alan).setLiquidityOps(await liquidityOps.getAddress()), /Ownable: caller is not the owner/);
            await shouldThrow(locker.setLiquidityOps('0x0000000000000000000000000000000000000000'), /invalid address/);

            await shouldThrow(locker.connect(alan).recoverToken(staxLPToken.address, await owner.getAddress(), 100), /Ownable: caller is not the owner/);
            await shouldThrow(locker.recoverToken(staxLPToken.address, await owner.getAddress(), 100), /not enough tokens/);

            // Happy paths
            await expect(locker.setLiquidityOps(await alan.getAddress()))
                .to.emit(locker, "LiquidityOpsSet")
                .withArgs(await alan.getAddress());
        });

        it("should lock rightly", async() => {
            await staxLPToken.addMinter(locker.address);

            // Alan locks 100 
            await v2pair.connect(alan).approve(locker.address, 150);
            const alanLpBefore = await v2pair.balanceOf(await alan.getAddress());
            //const lockAmount = 100;
            await expect(locker.connect(alan).lock(100, false))
                .to.emit(locker, "Locked")
                .withArgs(await alan.getAddress(), 100);

            // lp transferred to the liquidity manager
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(100));
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(100);

            // Get xlp 1:1
            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(100);

            // Alan locks another 50
            await locker.connect(alan).lock(50, false);

            // Ben locks 100
            const benLpBefore = await v2pair.balanceOf(await ben.getAddress());
            await v2pair.connect(ben).approve(locker.address, 100);
            await locker.connect(ben).lock(100, false);

            // Check total balances
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(250);
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(150));
            expect(await v2pair.balanceOf(await ben.getAddress())).eq(benLpBefore.sub(100));

            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(150);
            expect(await staxLPToken.balanceOf(await ben.getAddress())).eq(100);
            expect(await staxLPToken.totalSupply()).eq(250);
        });

        it("should lock and stake", async() => {
            await staxLPToken.addMinter(locker.address);

            // Alan locks and stakes 100 -- only 1 approval required.
            await v2pair.connect(alan).approve(locker.address, 100);

            const alanLpBefore = await v2pair.balanceOf(await alan.getAddress());
            const liquidityOpsLpBefore = await v2pair.balanceOf(await liquidityOps.getAddress());

            await expect(locker.connect(alan).lock(100, true))
                .to.emit(locker, "Locked")
                .withArgs(await alan.getAddress(), 100)
                .to.emit(staking, "Staked")
                .withArgs(await alan.getAddress(), 100);
            
            // lp transferred to the liquidity manager
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(100));
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(liquidityOpsLpBefore.toNumber()+100);

            // Alan's xlp has been staked.
            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(0);
            expect(await staxLPToken.balanceOf(await liquidityOps.getAddress())).eq(0);
            expect(await staking.balanceOf(await alan.getAddress())).eq(100);
            expect(await staking.totalSupply()).eq(100);
        });

        it("owner can recover tokens", async () => {
            // Accidentally transfer some coin to the locker
            await v2pair.connect(alan).transfer(locker.address, 100);
            
            // The owner can claim it back
            await expect(locker.recoverToken(v2pair.address, await owner.getAddress(), 100))
                .to.emit(locker, "TokenRecovered")
                .withArgs(await owner.getAddress(), 100);
            
            expect(await v2pair.balanceOf(await owner.getAddress())).eq(100);
        });
    });
});