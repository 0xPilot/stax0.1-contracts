import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { shouldThrow } from "./helpers";
import { StaxLP, StaxLP__factory } from "../typechain";



describe("Stax LP Token", async () => {
    let staxToken: StaxLP;
    let owner: Signer
    let minter: Signer
    let alan: Signer

    beforeEach(async () => {
        [owner, minter, alan] = await ethers.getSigners();
        staxToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");

        await staxToken.addMinter(await minter.getAddress());
    });

    it("Only specified roles can mint", async () => {

    });

    it("only specified roles can burn", async () => {

    });
});