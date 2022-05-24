pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev interface of the curve stable swap.
interface IStableSwap {
    function coins(uint256 j) external view returns (address);
    function get_dy(int128 _from, int128 _to, uint256 _from_amount) external view returns (uint256);
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address receiver) external returns (uint256);
}

/// @dev The stax liquidity token - eg xLP, xFXS.
interface IStaxLockerReceipt is IERC20 {
    function mint(address to, uint256 amount) external;
}

contract StaxLockerReceiptRouter is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public inputToken; // eg TEMPLE/FRAX LP, FXS token
    IStaxLockerReceipt public staxReceiptToken; // eg xLP, xFXS token

    IStableSwap public curveStableSwap; // Curve pool for (xlp, lp) pair.

     // The order of curve pool tokens
    int128 public inputTokenIndex;
    int128 public staxReceiptTokenIndex;

    event BoughtStaxReceipt(address user, uint256 totalBought, uint256 protocolMinted, uint256 boughtOnAmm);
    event TokenRecovered(address user, uint256 amount);

    constructor(
        address _inputToken,
        address _staxReceiptToken,
        address _curveStableSwap
    ) {
        inputToken = IERC20(_inputToken);
        staxReceiptToken = IStaxLockerReceipt(_staxReceiptToken);

        curveStableSwap = IStableSwap(_curveStableSwap);
        (staxReceiptTokenIndex, inputTokenIndex) = curveStableSwap.coins(0) == address(staxReceiptToken)
            ? (int128(0), int128(1))
            : (int128(1), int128(0));
    }

    /** 
      * @notice Get a quote to purchase staxReceiptToken (eg xLP) using inputToken (eg LP) via the AMM.
      * @dev This includes AMM fees + liquidity based slippage.
      * @param _inputAmount The amount of inputToken (eg LP)
      * @return _staxReceiptAmount The expected amount of _staxReceiptAmount from the AMM
      */
    function buyStaxLockerReceiptQuote(uint256 _inputAmount) external view returns (uint256 _staxReceiptAmount) {
        return curveStableSwap.get_dy(inputTokenIndex, staxReceiptTokenIndex, _inputAmount);
    }

    /** 
      * @notice Purchase stax locker receipt tokens (eg xLP), by either minting at 1:1 or buying from the AMM - depending on price.
      * @dev If the AMM is trading above _minAmmAmountOut then buy the stax receipt tokens from the AMM. Otherwise mint at 1:1
      * @param _inputFromAddr The holder of the inputToken (eg LP)
      * @param _inputToAddr Where to send the inputToken (eg liquidity ops)
      * @param _inputAmount The amount of inputToken (eg LP)
      * @param _minAmmAmountOut The minimum amount we would expect to receive if purchased via the AMM
      * @param _receiptToAddr Where to send the purchased/minted staxReceiptToken
      * @return totalAmount The total amount of staxReceiptToken bought
      * @return protocolMintedAmount The amount of staxReceiptToken minted by the protocol (0 if bought off the AMM instead)
      */
    function buyStaxLockerReceipt(address _inputFromAddr, address _inputToAddr, uint256 _inputAmount, uint256 _minAmmAmountOut, address _receiptToAddr) 
            external returns (uint256 totalAmount, uint256 protocolMintedAmount) {
        if (_minAmmAmountOut > _inputAmount) {
            // Buy on the AMM on behalf of the user.
            inputToken.safeTransferFrom(_inputFromAddr, address(this), _inputAmount);
            inputToken.safeIncreaseAllowance(address(curveStableSwap), _inputAmount);
            protocolMintedAmount = 0;
            totalAmount = curveStableSwap.exchange(inputTokenIndex, staxReceiptTokenIndex, _inputAmount, _minAmmAmountOut, _receiptToAddr);
        } else {
            // Mint 1:1 and send the LP to liquidityOps
            inputToken.safeTransferFrom(_inputFromAddr, _inputToAddr, _inputAmount);
            totalAmount = _inputAmount;
            protocolMintedAmount = totalAmount;
            staxReceiptToken.mint(_receiptToAddr, protocolMintedAmount);
        }
        emit BoughtStaxReceipt(_inputFromAddr, totalAmount, protocolMintedAmount, totalAmount-protocolMintedAmount);
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
