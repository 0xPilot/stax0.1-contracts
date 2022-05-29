import { ethers, network } from "hardhat";
import { Signer, BigNumber, BigNumberish } from "ethers";
import { expect } from "chai";
import { mineForwardSeconds, shouldThrow, ZERO_ADDRESS } from "./helpers";
import { 
    ERC20, ERC20__factory,
    VeFXS, VeFXS__factory, SmartWalletWhitelist, SmartWalletWhitelist__factory, VeFXSProxy, VeFXSProxy__factory
} from "../typechain";
import { 
    fraxMultisigAddress, fxsTokenAddress,
    veFxsAddress, smartWalletWhitelistAddress,
    gaugeControllerAddress
} from "./addresses";


describe("VeFXS Proxy", async () => {
    let owner: Signer;
    let operator: Signer;
    let fraxMultisig: Signer;
    let veFxsProxy: VeFXSProxy;
    let veFXS: VeFXS;
    let fxsToken: ERC20;
    let smartWalletWhitelist: SmartWalletWhitelist;

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
        [owner, operator] = await ethers.getSigners();
        veFxsProxy = await new VeFXSProxy__factory(owner).deploy(veFxsAddress, gaugeControllerAddress);

        smartWalletWhitelist = SmartWalletWhitelist__factory.connect(smartWalletWhitelistAddress, owner);
        fxsToken = ERC20__factory.connect(fxsTokenAddress, owner);
        veFXS = VeFXS__factory.connect(veFxsAddress, owner);

        // impersonate frax multisig and whitelist VeFxsProxy for veFXS locking
        {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [fraxMultisigAddress]
            });
            fraxMultisig = await ethers.getSigner(fraxMultisigAddress);

            smartWalletWhitelist.connect(fraxMultisig).approveWallet(veFxsProxy.address);
        }
    });

    it("admin tests", async () => {
        // fails
        await shouldThrow(veFxsProxy.connect(operator).approveOpsManager(await operator.getAddress(), true), /s/);
        await shouldThrow(veFxsProxy.connect(operator).recoverToken(veFXS.address, await operator.getAddress(), 100), /s/);
        await shouldThrow(veFxsProxy.connect(operator).createLock(100, 69420), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).increaseAmount(100), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).increaseUnlockTime(69420), /not owner or ops manager/);
        await shouldThrow(veFxsProxy.connect(operator).voteGaugeWeight(veFXS.address, 300), /not owner or ops manager/);

        // happy path
        await veFxsProxy.approveOpsManager(await operator.getAddress(), true);
    });

    it("approves ops manager", async () => {
        await expect(veFxsProxy.approveOpsManager(await operator.getAddress(), true))
            .to.emit(veFxsProxy, "ApprovedOpsManager")
            .withArgs(await operator.getAddress(), true);
    });

    it("creates lock", async () => {

    });

});