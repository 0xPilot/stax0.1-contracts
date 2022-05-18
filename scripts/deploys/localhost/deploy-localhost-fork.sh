#!/bin/bash

# When deploying locally as a fork off mainnet
# Firat start local node with:
#    npx hardhat node --fork-block-number 14702622 --fork "https://eth-mainnet.alchemyapi.io/v2/XXX"

npx hardhat run --network localhost scripts/deploys/mainnet/01-stax.ts
npx hardhat run --network localhost scripts/deploys/mainnet/02-curve-pool.ts
npx hardhat run --network localhost scripts/deploys/mainnet/03-staking.ts
npx hardhat run --network localhost scripts/deploys/mainnet/04-rewards-manager.ts
npx hardhat run --network localhost scripts/deploys/mainnet/05-liquidity-ops.ts
npx hardhat run --network localhost scripts/deploys/mainnet/06-locker-proxy.ts
npx hardhat run --network localhost scripts/deploys/mainnet/99-post-deploy.ts
