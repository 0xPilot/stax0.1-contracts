import { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { shouldThrow } from "./helpers";
import { StaxLP, StaxLP__factory } from "../typechain";

describe.only("Stax LP Token", async () => {
    let staxToken: StaxLP;
    let owner: Signer
    let minter: Signer
    let alan: Signer

    beforeEach(async () => {
        [owner, minter, alan] = await ethers.getSigners();
        staxToken = await new StaxLP__factory(owner).deploy("Stax LP Token", "xLP");
    });

    it("Only specified roles can mint", async () => {
        const alanAddress: string = await alan.getAddress();
        const minterAddress: string = await minter.getAddress();
    
        // mint should fail when no minter set.
        await shouldThrow(staxToken.mint(alanAddress, 10), /Caller cannot mint/);
    
        // Only admin can add a minter
        await shouldThrow(staxToken.connect(alan).addMinter(alanAddress), /Ownable: caller is not the owner/);
        await staxToken.addMinter(minterAddress);
    
        // Only minter can, well mint
        await staxToken.connect(minter).mint(alanAddress, 10);
        expect(await staxToken.balanceOf(alanAddress)).equals(10);
        await shouldThrow(staxToken.mint(alanAddress, 10), /Caller cannot mint/);
    
        // Only admin can remove a minter
        await shouldThrow(staxToken.connect(alan).removeMinter(minterAddress), /Ownable: caller is not the owner/);
        await staxToken.removeMinter(minterAddress);
    });

    it("only specified roles can burn", async () => {
        const alanAddress: string = await alan.getAddress();
        const minterAddress: string = await minter.getAddress();
    
        // mint should fail when no minter set.
        await shouldThrow(staxToken.burn(alanAddress, 10), /Caller cannot burn/);
    
        await staxToken.addMinter(minterAddress);
    
        // Only minter can burn
        await staxToken.connect(minter).mint(alanAddress, 100);
        await staxToken.connect(minter).burn(alanAddress, 10);
        expect(await staxToken.balanceOf(alanAddress)).equals(90);
        await shouldThrow(staxToken.burn(alanAddress, 10), /Caller cannot burn/);
    });
});