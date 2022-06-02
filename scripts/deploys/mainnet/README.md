# Mainnet Rollout Plan

## 1. DEVS: Deploy Scripts

### 1. Check and update scripts

1. Update `02-curve-pool.ts`:
    1. Confirm the curve pool settings:
        1. `A`=40, `fee`=29400000 (0.294%)
1. Update `99-post-deploy.ts` for
    1. `setLockParams` -- confirm 70/30 split
    1. `setFarmLockTime()` -- to roughly equal `[Sat Dec 17 2022 00:00:00 GMT+0000] - now()`
        1. Such that it's a couple of days before the FXS halvening. This is to work out a strategy of what we want to do with the new year.
1. Update the msig in `./scripts/deploys/helpers.ts`
    1. `DEPLOYED_CONTRACTS[mainnet][MULTISIG]`

### 2. Run Deploy Scripts

```bash
# After each step
#  - Monitor logs for errors
#  - Update the DEPLOYED_CONTRACTS[mainnet] in ./scripts/deploys/helpers.ts
#  - Check the contract is verified on etherscan
npx hardhat run --network mainnet scripts/deploys/mainnet/01-stax.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/02-curve-pool.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/03-staking.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/04-rewards-manager.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/05-liquidity-ops.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/06-locker-proxy.ts
npx hardhat run --network mainnet scripts/deploys/mainnet/99-post-deploy.ts
```

### 3. Verify Deployment

Check through each of the contracts in etherscan and check the read-only params are linked and as expected:

1. `staxStaking.rewardDistributor` (rewards manager addr)
1. `staxStaking.rewardTokens` (fxs + temple)
1. `rewardsManager.operator` (the msig)
1. `liquidityOps.rewardTokens` (fxs + temple)
1. `liquidityOps.lockRate` (70/30 split)
1. `liquidityOps.feeRate` (0% fees)
1. `liquidityOps.farmLockTime` (~Dec 17th 2022 - current_time)
1. `liquidityOps.pegDefender` (the msig)

### 4. Trasfer Contracts' ownership

Double check right `mainnet.MULTISIG` address is in `./scripts/deploys/helpers.ts`

```bash
npx hardhat run --network mainnet scripts/deploys/mainnet/100-transfer-ownership.ts
```

### 5. Verify Curve Pool

Head to etherscan and check the A & fee params match, poke around a bit.

## 2. MASTERS: Seed Curve Pool

Pre-requisites:

1. We have a multisig (the one confirmed above) signatory on hand
1. Decide on the amount of LP & xLP to add
1. The multisig already owns the TEMPLE/FRAX LP (withdraw from FRAX3CRV or whatever)

Actions:

1. Mint the equal amount of xLP:
    1. xLP token: `mint(multisig_address, seedAmount x 10e18)`
1. Approve xLP and LP:
    1. xLP token: `approve(curve_pool_address, seedAmount x 10e18)`
    1. LP token: `approve(curve_pool_address, seedAmount x 10e18)`
1. Add Liquidity:
    1. NB: Note - given it's the first deposit, so we don't check for slippage. 
    1. NB: The msig will receive the resulting curve liquidity token
    1. Curve Pool: `add_liquidity([seedAmount x 10e18, seedAmount x 10e18], minExpected, multisig_address)`
        1. Where `minExpected = 0.99 x 2 x seedAmount x 10e18`, ie 99% of the LP we should get as the first depositor.

Verify:

1. Check the curve pool reserves on etherscan
1. Get a quote from the LockerProxy contract - it should be 1:1 (minus fee) `buyFromAmmQuote(1e18)`

Should all be done now -- get a kind soul to smoke test for real using the STAX UI.

## 3. MASTERS: Operations

Until we have good automation - most things are manual via the msig.

### Apply Liquidity

When users lock LP, it sits in liqudity ops. This needs to be 'applied' (according to policy%) into the gauge and curve pool.

1. Check the liqudity ops contract for the balance of how much LP it holds.
1. `liquidityOps.minCurveLiquidityAmountOut(liquidity x 10e18, modelSlippage)`
    1. Gets the amount of curve liqudity tokens we expect when depositing policy% into the curve pool.
    1. `modelSlippage` This function is an approximation (curve docs), so recommended to add 0.5% model slippage.
        1. 1e10 precision, so 0.5% = 5e7. 1% = 1e8
1. `liquidityOps.applyLiquidity(liquidity x 10e18, minCurveTokenAmount)`
    1. `minCurveTokenAmount` Use the amount calculated above.

### Weekly Rewards Distribution

Automation will be setup using keeper soon after launch...but until then this needs to be done weekly.

TODO: Agree on a time that we commit to distributing each week until that's implemented.

1. Take note of the APR in the UI - it will change when we distribute new rewards.
1. Pull claimable rewards from the gauge: `liquidityOps.getReward()`
1. Send gauge rewards to the rewards manager: `liquidityOps.harvestRewards()`
1. Distribute rewards so users can start claiming: `rewardsManager.notifyRewardAmount()`
1. Compare the APR now - it would have updated (although also updates due to $USD prices & total xLP staked - so just a guide)

### Peg Defense

These functions exist in liquidity ops to help bolster the peg:

1. `liquditityOps.exchange(address _coinIn, uint256 _amount, uint256 _minAmountOut)`
    1. Swap the liquidityOps holdings of LP->xLP, or xLP->LP
    1. NB: Curve fees are applied.
1. `liquditityOps.removeLiquidityImbalance(uint256[2] memory _amounts, uint256 _maxBurnAmount)`
    1. Withdraw coins from the curve pool in an imbalanced amount, using liquidityOps' curve liqudity balance.
    1. NB: Curve fees are applied for any imbalance difference.
1. `liquditityOps.recoverToken(address _token, address _to, uint256 _amount)`
    1. Send any tokens which liquidityOps holds to another contract - eg LP/xLP after swapping, etc.

### Policy Settings

1. `setLockParams(uint128 _numerator, uint128 _denominator)`
    1. The percentage of how much we are locking in the gauge, vs adding to curve liquidity
1. `setFeeParams(uint128 _numerator, uint128 _denominator)`
    1. How much fees we take out of the gauge rewards, before passing the rest onto the user.
    1. NB: If non-zero, also consider setting the fee collector (the msig owner by default)
1. `setFarmLockTime(uint256 _secs)`
    1. Change the duration of the lock in the guage.
