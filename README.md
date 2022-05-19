# Stax Contracts v0.1

## Getting Started

### Requirements

* node
* yarn

This repository uses `.nvmrc` to dictate the version of node required to compile and run the project. This will allow you to use `nvm` followed by either `nvm use` or `nvm install` to automatically set the right version of node in that terminal session.

This project uses yarn workspaces to share common dependencies between all the applications. Before attempting to run any of the apps, you'll want to run `yarn install` from the root of the project.

### Contracts

#### Local Deployment

The protocol app uses hardhat for development. The following steps will compile the contracts and deploy to a local hardhat node

```bash
# Compile the contracts
yarn compile

# Generate the typechain.
yarn typechain

# NB: Vyper generated typechain is buggy - see below. Restore any committed versions.
git checkout `git ls-files -m "typechain/factories/*.ts"`

# In one terminal window, run a local node forked off mainnet
yarn local-fork

# In another window, run the deploy script
yarn local-fork:deploy
```

The protocol test suite can be run without deploying to a local-node by running

```bash
# Run tests, no deployment neccessary
yarn test
```

#### Vyper Typechain Bugs

For testing, we depend on Vyper for Curve contracts. The generated typechain for these are buggy (gas field in ABI should be a string), so local a .ts is checked-in.
https://github.com/dethcrypto/TypeChain/issues/677
https://github.com/NomicFoundation/hardhat/issues/1696

Normally gas shouldn't be explicitly added into the typechain ABI. It causes further issues in testing where `contract.fn(..., {gasLimit:50000})` has to be manually added as options to any write functions on the contract.

## VSCode Testing

https://hardhat.org/guides/vscode-tests.html

tl;dr;

  1. Install https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-mocha-test-adapter
  2. Set the VSCode config value `"mochaExplorer.files": "test/**/*.{j,t}s"`
  3. Reload VSCode, click the flask icon, see all tests :)
  