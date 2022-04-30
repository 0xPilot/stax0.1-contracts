import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { shouldThrow } from "./helpers";
import { 
    StaxLP, StaxLP__factory,
    LPLockerSingle, LPLockerSingle__factory
} from "../typechain";


describe("Temple ERC20 Token", async () => {
    let staxToken: StaxLP;
    let owner: Signer
    let minter: Signer
    let alan: Signer

    beforeEach(async () => {
        // mock lp token

        // impersonate account and transfer lp tokens
    });

    describe("Locking", async () => {

        it("admin tests", async () => {

        });

        it("should set lp farm", async () => {

        });

        it("should set lock params", async() => {

        });

        it("should set reward tokens", async() => {

        });

        it("should set rewards manager", async() => {

        });

        it("should set lp manager", async() => {

        });

        it("should return right time for max lock", async() => {

        });

        it("should lock rightly", async() => {
            // also getlockamount
        });

        it("should withdraw lock", async() => {

        });

        it("should set lock params", async() => {

        });
    });

    describe("Rewards", async () => {

    });

    describe("LP Manager", async () => {

        it("lp manager withdraws lp tokens", async() => {

        });
    });
});