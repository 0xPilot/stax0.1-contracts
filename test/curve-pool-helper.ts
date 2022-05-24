import { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { 
    StaxLP, 
    TempleUniswapV2Pair, 
    CurveFactory__factory,
    CurvePool__factory,
    CurvePool,
} from "../typechain";
import { ZERO_ADDRESS } from "./helpers";
import { curveFactoryAddress } from "./addresses";

export const createCurveStableSwap = async (owner: Signer, staxLPToken: StaxLP, v2pair: TempleUniswapV2Pair, templeMultisig: Signer): Promise<CurvePool> => {
    let curvePool: CurvePool;
    
    // Create the curve stable swap
    {
        const curveFactory = CurveFactory__factory.connect(curveFactoryAddress, owner);
        const numPoolsBefore = await curveFactory.pool_count();

        const coins: [string, string, string, string] = [
            staxLPToken.address, v2pair.address,
            ZERO_ADDRESS, ZERO_ADDRESS];
        const A = 50;
        const fee = 4000000; // 0.04% - the minimum
        const assetType = 3; // 'Other'
        // curveFactory.plain_implementations[N_COINS][idx]
        // curveFactory.plain_implementations(2, 3) = 0x4A4d7868390EF5CaC51cDA262888f34bD3025C3F
        const implementationIndex = 3;
        // The deploy_plain_pool doesn't get added to the object correctly from the ABI (perhaps because it's overloaded)
        // We need to call it by name
        await expect(curveFactory.functions['deploy_plain_pool(string,string,address[4],uint256,uint256,uint256,uint256)']
            ("STAX TEMPLE/FRAX xLP + LP", "xTFLP+TFLP", coins, A, fee, assetType, implementationIndex, {gasLimit: 1000000}))
            .to.emit(curveFactory, "PlainPoolDeployed")
            .withArgs(coins, A, fee, await owner.getAddress());
        
        expect(await curveFactory.pool_count()).eq(numPoolsBefore.add(1));
    
        const curvePoolAddresses = await curveFactory.functions['find_pool_for_coins(address,address)'](staxLPToken.address, v2pair.address);
        expect(curvePoolAddresses.length).eq(1);
        const curvePoolAddress = curvePoolAddresses[0];
        expect(curvePoolAddress).not.eq(ZERO_ADDRESS);

        curvePool = CurvePool__factory.connect(curvePoolAddress, owner);
        expect((await curvePool.name())).eq('Curve.fi Factory Plain Pool: STAX TEMPLE/FRAX xLP + LP');
    }

     // Seed the pool 1:1
     const seedBalances: [BigNumberish, BigNumberish] = [9000, 9000];
     {
        // Assume it's seeded manually from some temple msig
        await staxLPToken.addMinter(await templeMultisig.getAddress());
        await staxLPToken.connect(templeMultisig).mint(await templeMultisig.getAddress(), 100000);

        await staxLPToken.connect(templeMultisig).approve(curvePool.address, seedBalances[0]);
        await v2pair.connect(templeMultisig).approve(curvePool.address, seedBalances[1]);

        // Send the msig some eth for the transaction.
        await owner.sendTransaction({
            to: await templeMultisig.getAddress(),
            value: ethers.utils.parseEther("0.5"),
        });
        
        // Make sure there's enough to xfer
        expect(await staxLPToken.balanceOf(await templeMultisig.getAddress())).gte(seedBalances[0]);
        expect(await v2pair.balanceOf(await templeMultisig.getAddress())).gte(seedBalances[1]);

        const addLiquidityFn = curvePool.connect(templeMultisig).functions['add_liquidity(uint256[2],uint256,address)'];
        await addLiquidityFn(seedBalances, 0, await templeMultisig.getAddress(), {gasLimit: 300000});
    }

    return curvePool;
}