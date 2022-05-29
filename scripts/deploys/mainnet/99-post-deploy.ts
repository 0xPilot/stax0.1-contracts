import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { 
    LiquidityOps__factory,
    LockerProxy__factory,
    StaxLP__factory,
    StaxLPStaking__factory,
    RewardsManager__factory,
} from '../../../typechain';
import {
    ensureExpectedEnvvars,
    getDeployedContracts,
    mine,
} from '../helpers';

async function main() {
    ensureExpectedEnvvars();

    const [owner] = await ethers.getSigners();
    const DEPLOYED = getDeployedContracts();

    const staxLP = StaxLP__factory.connect(DEPLOYED.STAX_TOKEN, owner);
    const staxStaking = StaxLPStaking__factory.connect(DEPLOYED.STAX_STAKING, owner);
    const rewardsManager = RewardsManager__factory.connect(DEPLOYED.REWARDS_MANAGER, owner);
    const lockerProxy = LockerProxy__factory.connect(DEPLOYED.LOCKER_PROXY, owner);
    const liquidityOps = LiquidityOps__factory.connect(DEPLOYED.LIQUIDITY_OPS, owner);

    // Add liquidityOps and lockerProxy as xLP minters
    await mine(staxLP.addMinter(lockerProxy.address));
    await mine(staxLP.addMinter(liquidityOps.address));
    
    // Transfer xLP ownership to the multisig
    // Grant the msig the admin role (so it can then add/remove minters), and remove admin from the old owner.
    const adminRole = await staxLP.getRoleAdmin(await staxLP.CAN_MINT());
    await mine(staxLP.grantRole(adminRole, DEPLOYED.MULTISIG));
    await mine(staxLP.transferOwnership(DEPLOYED.MULTISIG));
    await mine(staxLP.revokeRole(adminRole, await owner.getAddress()));

    // Set the staking rewards distributor, and setup the initial reward tokens.
    await mine(staxStaking.setRewardDistributor(DEPLOYED.REWARDS_MANAGER));
    await mine(staxStaking.addReward(DEPLOYED.FXS));
    await mine(staxStaking.addReward(DEPLOYED.TEMPLE));

    // Set the rewards operator to the multisig for now - this may be a keeper in future.
    await mine(rewardsManager.setOperator(DEPLOYED.MULTISIG));

    // Liquidity Ops initial policy / state
    await mine(liquidityOps.setRewardTokens());
    await mine(liquidityOps.setLockParams(70, 100));      // By default: 70% locked in the gauge, 30% in the curve pool
    await mine(liquidityOps.setFarmLockTime(86400*182));  // By default: Set to 6 month lock time.

    // Transfer ownership to the multisig
    await mine(staxStaking.transferOwnership(DEPLOYED.MULTISIG));
    await mine(rewardsManager.transferOwnership(DEPLOYED.MULTISIG));
    await mine(liquidityOps.transferOwnership(DEPLOYED.MULTISIG));
    await mine(lockerProxy.transferOwnership(DEPLOYED.MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });