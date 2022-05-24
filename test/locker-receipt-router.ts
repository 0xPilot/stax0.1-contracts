import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    TempleUniswapV2Pair, TempleUniswapV2Pair__factory,
    StaxLockerReceiptRouter, StaxLockerReceiptRouter__factory, CurvePool
} from "../typechain";

import { 
    lpBigHolderAddress, lpTokenAddress, templeMultisigAddress } from "./addresses";
import { createCurveStableSwap } from "./curve-pool-helper";

describe("Locker Receipt Router", async () => {
    let staxLPToken: StaxLP;
    let owner: Signer;
    let alan: Signer;
    let ben: Signer;
    let liquidityOps: Signer;
    let lpBigHolder: Signer;
    let v2pair: TempleUniswapV2Pair;

    let curvePool: CurvePool;
    let templeMultisig: Signer;
    let receiptRouter: StaxLockerReceiptRouter;

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

        v2pair = TempleUniswapV2Pair__factory.connect(lpTokenAddress, owner);
        staxLPToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");

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

            await v2pair.connect(lpBigHolder).transfer(await alan.getAddress(), 3000);
            await v2pair.connect(lpBigHolder).transfer(await ben.getAddress(), 3000);
            await v2pair.connect(lpBigHolder).transfer(await templeMultisig.getAddress(), 1000000);
            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [lpBigHolderAddress],
            });
        }

        curvePool = await createCurveStableSwap(owner, staxLPToken, v2pair, templeMultisig);
        receiptRouter = await new StaxLockerReceiptRouter__factory(owner).deploy(
            v2pair.address, staxLPToken.address, curvePool.address);
    });

    describe("Router", async () => {

        it("admin tests", async () => {
            await shouldThrow(receiptRouter.connect(alan).recoverToken(staxLPToken.address, await owner.getAddress(), 100), /Ownable: caller is not the owner/);
            await shouldThrow(receiptRouter.recoverToken(staxLPToken.address, await owner.getAddress(), 100), /not enough tokens/);
        });

        it("AMM Quote", async() => {
            const lpAmount = 1000;           
            
            {
                const dy = await curvePool.get_dy(1, 0, lpAmount, {gasLimit: 150000});
                const xlp = await receiptRouter.buyStaxLockerReceiptQuote(lpAmount);
                expect(xlp).eq(dy);
            }

            // distort virtual price by adding xLP only.
            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 20000);
            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([20000, 0], 1, await templeMultisig.getAddress(), {gasLimit: 150000});
            
            {
                const dy = await curvePool.get_dy(1, 0, lpAmount, {gasLimit: 150000});
                const xlp = await receiptRouter.buyStaxLockerReceiptQuote(lpAmount);
                expect(xlp).eq(dy);
            }
        });

        it("Buy Over 1:1", async() => {
            // Bought on the AMM
            await staxLPToken.addMinter(receiptRouter.address);

            const alanLpBefore = await v2pair.balanceOf(await alan.getAddress());
            const benXlpBefore = await staxLPToken.balanceOf(await ben.getAddress());
            const alanXlpBefore = await staxLPToken.balanceOf(await alan.getAddress());
            const liquidityOpsLpBefore = await v2pair.balanceOf(await liquidityOps.getAddress());

            // distort virtual price by adding xLP only.
            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 20000);
            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([20000, 0], 1, await templeMultisig.getAddress(), {gasLimit: 150000});

            const balancesBefore = await curvePool.get_balances({gasLimit: 150000});
            
            const lpAmount = 1000;
            const xlpOnAmm = await receiptRouter.buyStaxLockerReceiptQuote(lpAmount);
            expect(xlpOnAmm).gt(lpAmount);

            await v2pair.connect(alan).approve(receiptRouter.address, lpAmount);
            await expect(receiptRouter.buyStaxLockerReceipt(await alan.getAddress(), await liquidityOps.getAddress(), 
                    1000, xlpOnAmm, await ben.getAddress(), {gasLimit: 500000}))
                .to.emit(receiptRouter, "BoughtStaxReceipt")
                .withArgs(await alan.getAddress(), xlpOnAmm, 0, xlpOnAmm);

            // Alan loses his LP
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(lpAmount));

            // Ben gets the xLP > 1:1
            // It's at the quote we got (in practice it would be impacted by execution time based slippage)
            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(alanXlpBefore);
            expect(await staxLPToken.balanceOf(await ben.getAddress())).eq(benXlpBefore.add(xlpOnAmm));

            // Liquidity Ops doesn't get any new LP
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(liquidityOpsLpBefore);

            // The curve pool balances were updated
            const balancesAfter = await curvePool.get_balances({gasLimit: 150000});
            expect(balancesAfter[0]).eq(balancesBefore[0].sub(xlpOnAmm));
            expect(balancesAfter[1]).eq(balancesBefore[1].add(lpAmount));
        });

        it("Buy Over 1:1, but not over slippage", async() => {
            // Minted 1:1
            await staxLPToken.addMinter(receiptRouter.address);

            const alanLpBefore = await v2pair.balanceOf(await alan.getAddress());
            const benXlpBefore = await staxLPToken.balanceOf(await ben.getAddress());
            const alanXlpBefore = await staxLPToken.balanceOf(await alan.getAddress());
            const liquidityOpsLpBefore = await v2pair.balanceOf(await liquidityOps.getAddress());

            // distort virtual price by adding xLP only.
            await staxLPToken.connect(templeMultisig).approve(curvePool.address, 10000);
            const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
            await addLiquidityFn([10000, 0], 1, await templeMultisig.getAddress(), {gasLimit: 150000});

            // Slippage of 3%
            const lpAmount = 1000;
            const xlpOnAmm = (await receiptRouter.buyStaxLockerReceiptQuote(lpAmount)).mul(97).div(100);
            expect(xlpOnAmm).lt(lpAmount);

            await v2pair.connect(alan).approve(receiptRouter.address, lpAmount);
            await expect(receiptRouter.buyStaxLockerReceipt(await alan.getAddress(), await liquidityOps.getAddress(), 
                    1000, xlpOnAmm, await ben.getAddress(), {gasLimit: 500000}))
                .to.emit(receiptRouter, "BoughtStaxReceipt")
                .withArgs(await alan.getAddress(), lpAmount, lpAmount, 0);

            // Alan loses his LP
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(lpAmount));

            // Ben gets the xLP 1:1
            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(alanXlpBefore);
            expect(await staxLPToken.balanceOf(await ben.getAddress())).eq(benXlpBefore.add(lpAmount));

            // Liquidity Ops gets the LP
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(liquidityOpsLpBefore.add(lpAmount));
        });

        it("Buy Under 1:1", async() => {
            // Minted 1:1
            await staxLPToken.addMinter(receiptRouter.address);

            const alanLpBefore = await v2pair.balanceOf(await alan.getAddress());
            const benXlpBefore = await staxLPToken.balanceOf(await ben.getAddress());
            const alanXlpBefore = await staxLPToken.balanceOf(await alan.getAddress());
            const liquidityOpsLpBefore = await v2pair.balanceOf(await liquidityOps.getAddress());

            const lpAmount = 1000;
            const xlpOnAmm = await receiptRouter.buyStaxLockerReceiptQuote(lpAmount);
            expect(xlpOnAmm).lt(lpAmount);

            await v2pair.connect(alan).approve(receiptRouter.address, lpAmount);
            await expect(receiptRouter.buyStaxLockerReceipt(await alan.getAddress(), await liquidityOps.getAddress(), 
                    1000, xlpOnAmm, await ben.getAddress(), {gasLimit: 500000}))
                .to.emit(receiptRouter, "BoughtStaxReceipt")
                .withArgs(await alan.getAddress(), lpAmount, lpAmount, 0);

            // Alan loses his LP
            expect(await v2pair.balanceOf(await alan.getAddress())).eq(alanLpBefore.sub(lpAmount));

            // Ben gets the xLP 1:1
            expect(await staxLPToken.balanceOf(await alan.getAddress())).eq(alanXlpBefore);
            expect(await staxLPToken.balanceOf(await ben.getAddress())).eq(benXlpBefore.add(lpAmount));

            // Liquidity Ops gets the LP
            expect(await v2pair.balanceOf(await liquidityOps.getAddress())).eq(liquidityOpsLpBefore.add(lpAmount));
        });

        it("owner can recover tokens", async () => {
            // Accidentally transfer some coin to the locker
            await v2pair.connect(alan).transfer(receiptRouter.address, 100);
            
            // The owner can claim it back
            await expect(receiptRouter.recoverToken(v2pair.address, await owner.getAddress(), 100))
                .to.emit(receiptRouter, "TokenRecovered")
                .withArgs(await owner.getAddress(), 100);
            
            expect(await v2pair.balanceOf(await owner.getAddress())).eq(100);
        });
    });
});