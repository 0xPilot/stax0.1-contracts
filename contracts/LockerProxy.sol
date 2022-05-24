pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IStaxLockerReceiptRouter {
    function buyStaxLockerReceipt(address _inputFromAddr, address _inputToAddr, uint256 _inputAmount, uint256 _minAmmAmountOut, address _receiptToAddr) external returns (uint256 totalAmount, uint256 protocolMintedAmount);
    function buyStaxLockerReceiptQuote(uint256 _inputAmount) external view returns (uint256 _staxReceiptAmount);
}

interface IStaxLPStaking {
    function stakeFor(address _for, uint256 _amount) external;
}

contract LockerProxy is Ownable {

    using SafeERC20 for IERC20;

    address public liquidityOps;
    IERC20 public inputToken; // eg TEMPLE/FRAX LP, FXS token
    IERC20 public staxReceiptToken; // eg xLP, xFXS token
    IStaxLPStaking public staking; // staking contract for xLP, xFXS

    // Router to buy/mint the Stax Locker Receipt Token (eg xLP, xFXS)
    IStaxLockerReceiptRouter public lockerReceiptRouter;

    event Locked(address user, uint256 totalLocked, uint256 protocolMinted, uint256 boughtOnAmm);
    event LiquidityOpsSet(address liquidityOps);
    event TokenRecovered(address user, uint256 amount);

    constructor(
        address _liquidityOps,
        address _inputToken,
        address _staxReceiptToken,
        address _staking,
        address _lockerReceiptRouter
    ) {
        liquidityOps = _liquidityOps;
        inputToken = IERC20(_inputToken);
        staxReceiptToken = IERC20(_staxReceiptToken);
        staking = IStaxLPStaking(_staking);

        lockerReceiptRouter = IStaxLockerReceiptRouter(_lockerReceiptRouter);
    }

    function setLiquidityOps(address _liquidityOps) external onlyOwner {
        require(_liquidityOps != address(0), "invalid address");
        liquidityOps = _liquidityOps;
        emit LiquidityOpsSet(_liquidityOps);
    }
    
    /** 
      * @notice Get a quote to purchase staxReceiptToken (eg xLP) using inputToken (eg LP) via the AMM.
      * @dev This includes AMM fees + liquidity based slippage.
      * @param _liquidity The amount of inputToken (eg LP)
      * @return _staxReceiptAmount The expected amount of _staxReceiptAmount from the AMM
      */
    function buyStaxLockerReceiptQuote(uint256 _liquidity) external view returns (uint256 _staxReceiptAmount) {
        return lockerReceiptRouter.buyStaxLockerReceiptQuote(_liquidity);
    }

    /** 
      * @notice Lock inputToken (eg LP) and return staxReceiptToken (eg xLP), at least 1:1
      * @dev This will either mint staxReceiptToken (1:1), or purchase staxReceiptToken from the AMM if it's trading at > 1:1
      * @param _liquidity How much of inputToken to lock (eg LP)
      * @param _stake Immediately stake the resulting staxReceiptToken (eg xLP)
      * @param _minAmmAmountOut The minimum amount of staxReceiptToken (eg xLP) to expect if purchased off the AMM. 
               Use buyStaxLockerReceiptQuote() to get an AMM quote.
      */
    function lock(uint256 _liquidity, bool _stake, uint256 _minAmmAmountOut) external {
        require(_liquidity <= inputToken.balanceOf(address(msg.sender)), "not enough liquidity");

        uint256 totalReceiptToken;
        uint256 mintedReceiptToken;
        if (_stake) {
            (totalReceiptToken, mintedReceiptToken) = lockerReceiptRouter.buyStaxLockerReceipt(msg.sender, liquidityOps, _liquidity, _minAmmAmountOut, address(this));
            staxReceiptToken.safeIncreaseAllowance(address(staking), totalReceiptToken);
            staking.stakeFor(msg.sender, totalReceiptToken);
        } else {
            (totalReceiptToken, mintedReceiptToken) = lockerReceiptRouter.buyStaxLockerReceipt(msg.sender, liquidityOps, _liquidity, _minAmmAmountOut, msg.sender);
        }

        emit Locked(msg.sender, totalReceiptToken, mintedReceiptToken, totalReceiptToken-mintedReceiptToken);
    }

    // recover tokens
    function recoverToken(address _token, address _to, uint256 _amount) external onlyOwner {
        _transferToken(IERC20(_token), _to, _amount);
        emit TokenRecovered(_to, _amount);
    }

    function _transferToken(IERC20 _token, address _to, uint256 _amount) internal {
        uint256 balance = _token.balanceOf(address(this));
        require(_amount <= balance, "not enough tokens");
        _token.safeTransfer(_to, _amount);
    }
}