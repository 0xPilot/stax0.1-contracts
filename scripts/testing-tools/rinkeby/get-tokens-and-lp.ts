import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { 
    GodModeErc20__factory,
    ERC20__factory,
    TempleFraxAMMRouter__factory,
    TempleUniswapV2Pair__factory } from '../../../typechain';
import {
    ensureExpectedEnvvars,
    getDeployedContracts,
    mine,
} from '../../deploys/helpers';


async function main() {
    ensureExpectedEnvvars();

    const [owner] = await ethers.getSigners();
    const DEPLOYED = getDeployedContracts();

    const dai = GodModeErc20__factory.connect(DEPLOYED.FRAX, owner);
    const ammRouter = TempleFraxAMMRouter__factory.connect(DEPLOYED.TEMPLE_V2_ROUTER, owner);
    const temple = ERC20__factory.connect(DEPLOYED.TEMPLE, owner);
    const v2pair = TempleUniswapV2Pair__factory.connect(DEPLOYED.TEMPLE_V2_PAIR, owner);

    // Deposit this amount of DAI - work out how much Temple that equates to.
    const maxAmountOfDai = ethers.utils.parseEther("50");
    const slippageBps = 100; // 1%
    const durationSecs = 60;

    // 1. Manually use Gnosis msig to send Temple
    // https://gnosis-safe.io/app/rin:0x577BB87962b76e60d3d930c1B9Ddd6DFD64d24A2/transactions/history

    // 2. Mint new DAI (This is a God Contract, so anyone can mint)
    console.log("Minting DAI:", ethers.utils.formatEther(maxAmountOfDai));
    await mine(dai.mint(owner.address, maxAmountOfDai));

    // Calc how much temple that equates to. NB: Temple = reserve0, DAI = reserve1
    const reserves = await v2pair.getReserves();
    console.log("V2 Pair Reserves:", reserves);
    const maxAmountOfTemple = await ammRouter.quote(maxAmountOfDai, reserves._reserve1, reserves._reserve0);

    // Approve the router taking DAI & Temple
    console.log("Approving DAI:", ethers.utils.formatEther(maxAmountOfDai), "Temple:", ethers.utils.formatEther(maxAmountOfTemple));
    await dai.approve(ammRouter.address, maxAmountOfDai);
    await temple.approve(ammRouter.address, maxAmountOfTemple);

    // Add liquidity - giving a 60sec window.
    const lpBefore = await v2pair.balanceOf(owner.address);
    const currentTime = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
    const minTemple = maxAmountOfTemple.mul(10000-slippageBps).div(10000);
    const minDai = maxAmountOfDai.mul(10000-slippageBps).div(10000);
    console.log("Adding Liquidity:", ethers.utils.formatEther(maxAmountOfTemple), ethers.utils.formatEther(maxAmountOfDai),
                ethers.utils.formatEther(minTemple), ethers.utils.formatEther(minDai), owner.address, currentTime+durationSecs);
    await mine(ammRouter.addLiquidity(maxAmountOfTemple, maxAmountOfDai, minTemple, minDai, owner.address, currentTime+durationSecs));
    const lpAfter = await v2pair.balanceOf(owner.address);
    console.log("Done - generated LP:", ethers.utils.formatEther(lpAfter.sub(lpBefore)));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });