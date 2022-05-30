import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { blockTimestamp, mineForwardSeconds, shouldThrow } from "./helpers";
import { 
    ERC20, ERC20__factory,
    VeFXS, VeFXS__factory,
    SmartWalletWhitelist, SmartWalletWhitelist__factory,
    VeFXSProxy, VeFXSProxy__factory,
    FraxUnifiedFarmERC20, FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory,
    GaugeController, GaugeController__factory,
} from "../typechain";
import { 
    fraxMultisigAddress, fxsTokenAddress,
    veFxsAddress, smartWalletWhitelistAddress,
    gaugeControllerAddress, fraxUnifiedFarmAddress
} from "./addresses";

describe("VeFXS Proxy", async () => {
    let owner: Signer;
    let operator: Signer;
    let liquidityOps: Signer;
    let fraxMultisig: Signer;
    let alan: Signer;
    let veFxsProxy: VeFXSProxy;
    let veFXS: VeFXS;
    let fxsToken: ERC20;
    let smartWalletWhitelist: SmartWalletWhitelist;
    let lpFarm: FraxUnifiedFarmERC20;
    let gaugeController: GaugeController;
    const WEEK: number = 7 * 86400;

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
        [owner, operator, liquidityOps, alan] = await ethers.getSigners();
        veFxsProxy = await new VeFXSProxy__factory(owner).deploy(veFxsAddress, gaugeControllerAddress);

        smartWalletWhitelist = SmartWalletWhitelist__factory.connect(smartWalletWhitelistAddress, owner);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, owner);
        veFXS = VeFXS__factory.connect(veFxsAddress, owner);
        lpFarm = FraxUnifiedFarmERC20TempleFRAXTEMPLE__factory.connect(fraxUnifiedFarmAddress, owner);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, owner);
        gaugeController = GaugeController__factory.connect(gaugeControllerAddress, owner);

        // impersonate frax multisig and whitelist VeFxsProxy for veFXS locking
        {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [fraxMultisigAddress]
            });
            fraxMultisig = await ethers.getSigner(fraxMultisigAddress);

            smartWalletWhitelist.connect(fraxMultisig).approveWallet(veFxsProxy.address);
            lpFarm.connect(fraxMultisig).toggleValidVeFXSProxy(veFxsProxy.address);
        }

        // Transfer the operator some FXS.
        await fxsToken.connect(fraxMultisig).transfer(await operator.getAddress(), ethers.utils.parseEther("2000"));
    });

    it("admin tests", async () => {
        // fails
        await shouldThrow(veFxsProxy.connect(operator).approveOpsManager(await operator.getAddress(), true), /Ownable: caller is not the owner/);
        await shouldThrow(veFxsProxy.connect(operator).recoverToken(veFXS.address, await operator.getAddress(), 100), /Ownable: caller is not the owner/);
        await shouldThrow(veFxsProxy.connect(operator).createLock(100, 69420), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).increaseAmount(100), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).increaseUnlockTime(69420), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).voteGaugeWeight(veFXS.address, 300), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).withdrawTo(await operator.getAddress()), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).gaugeProxyToggleStaker(fraxUnifiedFarmAddress, await liquidityOps.getAddress()), /not owner or ops manager/);

        const iface = new ethers.utils.Interface(JSON.stringify(VeFXS__factory.abi));
        const encoded = iface.encodeFunctionData("increase_unlock_time", [365*86400]);
        await shouldThrow(veFxsProxy.connect(operator).execute(fraxUnifiedFarmAddress, 100, encoded), /not owner or ops manager/);

        // happy path
        await veFxsProxy.approveOpsManager(await operator.getAddress(), true);
        await veFxsProxy.gaugeProxyToggleStaker(fraxUnifiedFarmAddress, await liquidityOps.getAddress());
        await shouldThrow(veFxsProxy.connect(operator).voteGaugeWeight(lpFarm.address, 10000), /Your token lock expires too soon/);
        await shouldThrow(veFxsProxy.connect(operator).voteGaugeWeight(lpFarm.address, 10000), /Your token lock expires too soon/);
        await shouldThrow(veFxsProxy.connect(operator).recoverToken(veFXS.address, await operator.getAddress(), 100), /Ownable: caller is not the owner/);
    });

    it("approves ops manager", async () => {
        await expect(veFxsProxy.approveOpsManager(await operator.getAddress(), true))
            .to.emit(veFxsProxy, "ApprovedOpsManager")
            .withArgs(await operator.getAddress(), true);
    });

    it("gauge proxy toggle liqudiity ops", async () => {
        await expect(veFxsProxy.gaugeProxyToggleStaker(fraxUnifiedFarmAddress, await liquidityOps.getAddress()))
            .to.emit(veFxsProxy, "GaugeProxyToggledStaker")
            .withArgs(fraxUnifiedFarmAddress, await liquidityOps.getAddress());
    });

    it("creates lock", async () => {
        const operatorAddr = await operator.getAddress();
        await veFxsProxy.approveOpsManager(operatorAddr, true);
        const fxsBefore = await fxsToken.balanceOf(operatorAddr);
        const veFxsBefore = await veFxsProxy.veFXSBalance();

        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);

        const currentTime = await blockTimestamp();
        const lockDurationSecs = 86400*365; // 1 year
        const idealUnlockTime = currentTime + lockDurationSecs;
        // veFXS rounds down to the nearest week.
        const expectedUnlockTime = Math.floor((idealUnlockTime) / WEEK) * WEEK;

        // Create lock
        await expect(veFxsProxy.connect(operator).createLock(amount, idealUnlockTime))
            .to.emit(veFXS, "Deposit")
            .withArgs(veFxsProxy.address, amount, expectedUnlockTime, 1, currentTime+1);

        // FXS was pulled form operator
        const fxsAfter = await fxsToken.balanceOf(operatorAddr);
        expect(fxsAfter).eq(fxsBefore.sub(amount));

        // The veFxs proxy holds no FXS.
        expect(await fxsToken.balanceOf(veFxsProxy.address)).eq(0);

        // Checked the veFXS locks
        const locked = await veFxsProxy.locked();
        expect(locked.end).eq(expectedUnlockTime);
        expect(locked.amount).eq(amount); // The original FXS locked

        // The veFxs amount is boosted - so something bigger than the locked FXS amount.
        const veFxsAfter = await veFxsProxy.veFXSBalance();
        expect(veFxsAfter.sub(veFxsBefore)).gt(amount);
    });

    it("should increase lock amount", async () => {
        const operatorAddr = await operator.getAddress();
        await veFxsProxy.approveOpsManager(operatorAddr, true);
        const fxsBefore = await fxsToken.balanceOf(operatorAddr);
        const veFxsBefore = await veFxsProxy.veFXSBalance();

        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);

        const currentTime = await blockTimestamp();
        const lockDurationSecs = 86400*365; // 1 year
        const idealUnlockTime = currentTime + lockDurationSecs;
        // veFXS rounds down to the nearest week.
        const expectedUnlockTime = Math.floor((idealUnlockTime) / WEEK) * WEEK;
        
        // Create initial lock        
        await veFxsProxy.connect(operator).createLock(amount, idealUnlockTime);

        // Now lock some more - the same amount again.
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);
        const currentTime2 = await blockTimestamp();
        await expect(veFxsProxy.connect(operator).increaseAmount(amount))
            .to.emit(veFXS, "Deposit")
            .withArgs(veFxsProxy.address, amount, expectedUnlockTime, 2, currentTime2+1);

        // 2xFXS was pulled form operator
        const fxsAfter = await fxsToken.balanceOf(operatorAddr);
        expect(fxsAfter).eq(fxsBefore.sub(amount.mul(2)));

        // The veFxs proxy holds no FXS.
        expect(await fxsToken.balanceOf(veFxsProxy.address)).eq(0);

        // Checked the veFXS locks
        const locked = await veFxsProxy.locked();
        expect(locked.end).eq(expectedUnlockTime);
        expect(locked.amount).eq(amount.mul(2)); // The original FXS locked

        // The veFxs amount is boosted - so something bigger than the locked FXS amount.
        const veFxsAfter = await veFxsProxy.veFXSBalance();
        expect(veFxsAfter.sub(veFxsBefore)).gt(amount.mul(2));
    });

    it("should increase the time to unlock", async () => {
        const operatorAddr = await operator.getAddress();
        await veFxsProxy.approveOpsManager(operatorAddr, true);
        const fxsBefore = await fxsToken.balanceOf(operatorAddr);

        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);

        const currentTime = await blockTimestamp();
        const lockDurationSecs = 86400*365; // 1 year
        const idealUnlockTime = currentTime + lockDurationSecs;

        // Create initial lock
        await veFxsProxy.connect(operator).createLock(amount, idealUnlockTime);
        const veFxsAfter1 = await veFxsProxy.veFXSBalance();

        // Extend the lock time
        const currentTime2 = await blockTimestamp();
        const lockDurationSecs2 = 86400*365*3; // 3 year
        const idealUnlockTime2 = currentTime2 + lockDurationSecs2;
        const expectedUnlockTime2 = Math.floor((idealUnlockTime2) / WEEK) * WEEK;

        await expect(veFxsProxy.connect(operator).increaseUnlockTime(idealUnlockTime2))
            .to.emit(veFXS, "Deposit")
            .withArgs(veFxsProxy.address, 0, expectedUnlockTime2, 3, currentTime2+1);
        
        // FXS was pulled form operator
        const fxsAfter = await fxsToken.balanceOf(operatorAddr);
        expect(fxsAfter).eq(fxsBefore.sub(amount));

        // The veFxs proxy holds no FXS.
        expect(await fxsToken.balanceOf(veFxsProxy.address)).eq(0);

        // Checked the veFXS locks - the extended lock time
        const locked = await veFxsProxy.locked();
        expect(locked.end).eq(expectedUnlockTime2);
        expect(locked.amount).eq(amount); // The original FXS locked

        // The veFxs amount is boosted - so something bigger than the locked FXS amount.
        const veFxsAfter2 = await veFxsProxy.veFXSBalance();
        expect(veFxsAfter2).gt(veFxsAfter1);
    });

    it("should withdraw after lock ends", async () => {
        const operatorAddr = await operator.getAddress();
        await veFxsProxy.approveOpsManager(operatorAddr, true);
        const fxsBefore = await fxsToken.balanceOf(operatorAddr);

        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);

        const currentTime = await blockTimestamp();
        const lockDurationSecs = 86400*2; // 2 days
        const idealUnlockTime = currentTime + lockDurationSecs;

        // Create lock
        await veFxsProxy.connect(operator).createLock(amount, idealUnlockTime);
        const locked = await veFxsProxy.locked();

        // Withdraw fails until we expire
        await shouldThrow(veFxsProxy.connect(operator).withdrawTo(await alan.getAddress()), /The lock didn't expire/);

        // Roll forward 2+ days
        await mineForwardSeconds(2*86400 + 1);

        // Withdraw succeeds now.
        await expect(veFxsProxy.connect(operator).withdrawTo(await alan.getAddress()))
            .to.emit(veFxsProxy, "WithdrawnTo")
            .withArgs(await alan.getAddress(), locked.amount);

        // FXS was pulled form operator
        const fxsAfter = await fxsToken.balanceOf(operatorAddr);
        expect(fxsAfter).eq(fxsBefore.sub(amount));

        // The veFxs proxy holds no FXS.
        expect(await fxsToken.balanceOf(veFxsProxy.address)).eq(0);

        // Checked the veFXS locks - should be nothing left
        const locked2 = await veFxsProxy.locked();
        expect(locked2.end).eq(0);
        expect(locked2.amount).eq(0);

        // The veFxs amount is boosted - so something bigger than the locked FXS amount.
        const veFxsAfter2 = await veFxsProxy.veFXSBalance();
        expect(veFxsAfter2).eq(0);

        // Alan got transferred the withdrawn FXS
        expect(await fxsToken.balanceOf(await alan.getAddress())).eq(amount);
    });

    it("should vote for gauge", async () => {
        const operatorAddr = await operator.getAddress();
        await veFxsProxy.approveOpsManager(operatorAddr, true);

        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).approve(veFxsProxy.address, amount);

        const currentTime = await blockTimestamp();
        const lockDurationSecs = 86400*365; // 365 days
        const idealUnlockTime = currentTime + lockDurationSecs;

        // Create lock
        await veFxsProxy.connect(operator).createLock(amount, idealUnlockTime);
        
        // Vote for the LP Farm at 100%
        const currentTime2 = await blockTimestamp();
        await expect(veFxsProxy.connect(operator).voteGaugeWeight(lpFarm.address, 10000))
            .to.emit(gaugeController, "VoteForGauge")
            .withArgs(currentTime2+1, veFxsProxy.address, lpFarm.address, 10000);

        // Check the full power is used.
        expect(await gaugeController.vote_user_power(veFxsProxy.address)).eq(10000);

        // Can't vote twice
        await shouldThrow(veFxsProxy.connect(operator).voteGaugeWeight(lpFarm.address, 10000), /Cannot vote so often/);
    });

    it("owner can recover tokens", async () => {
        const amount = ethers.utils.parseEther("1000");
        await fxsToken.connect(operator).transfer(veFxsProxy.address, amount);
        const fxsBalBefore = await fxsToken.balanceOf(await owner.getAddress());

        await expect(veFxsProxy.recoverToken(fxsToken.address, await owner.getAddress(), amount))
            .to.emit(veFxsProxy, "TokenRecovered")
            .withArgs(await owner.getAddress(), amount);
        
        expect(await fxsToken.balanceOf(await owner.getAddress())).eq(fxsBalBefore.add(amount));
    });

    it("owner can execute", async () => {
        const amount = ethers.utils.parseEther("1000");

        // Send veFxsProxy some FXS
        await fxsToken.connect(operator).transfer(veFxsProxy.address, amount);

        // NB: If these are working ok, can remove gasLimit overrides.

        // Approve veFXS contract to pull out the FXS
        {
            const abi = ERC20__factory.abi;
            const iface = new ethers.utils.Interface(abi);
            const encoded = iface.encodeFunctionData("approve", [veFXS.address, amount]);
            await veFxsProxy.connect(owner).execute(fxsToken.address, 0, encoded, {gasLimit: 500000});
        }

        // Create the lock
        {
            const abi = VeFXS__factory.abi;
            const iface = new ethers.utils.Interface(abi);
            const encoded = iface.encodeFunctionData("create_lock", [amount, 365*86400]);
            await veFxsProxy.connect(owner).execute(veFXS.address, 0, encoded, {gasLimit: 500000});
        }

        // TODO: verify lock was created
    });

    it("misc wrapper views", async () => {
        expect(await veFxsProxy.totalFXSSupply()).eq(await veFXS.totalFXSSupply());
        expect(await veFxsProxy.totalVeFXSSupply()).eq(await veFXS["totalSupply()"]());
        expect(await veFxsProxy.veFXSBalance()).eq(await veFXS["balanceOf(address)"](veFxsProxy.address));
    });
});