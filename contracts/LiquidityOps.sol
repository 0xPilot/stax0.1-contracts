pragma solidity ^0.8.4;
// SPDX-License-Identifier: AGPL-3.0-or-later


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


interface ILPLocker {
    function withdrawLPToken(uint256 _amount) external;
}

interface IXLPToken {
    function mint(address to, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapRouterV2 {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external;
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external; 
}

contract LiquidityOps is Ownable {
    using SafeERC20 for IERC20;

    ILPLocker public lpLocker;
    IXLPToken public xlpToken;
    IERC20 public lpToken;
    IERC20 public pair; // univ2 pair
    IUniswapRouterV2 public router;

    address public operator;

    constructor(
        address _lpLocker,
        address _lpToken,
        address _xlpToken,
        address _pair,
        address _router
    ) {
        lpLocker = ILPLocker(_lpLocker);
        lpToken = IERC20(_lpToken);
        xlpToken = IXLPToken(_xlpToken);
        pair = IERC20(_pair);
        router = IUniswapRouterV2(_router);
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function addLiquidity(
        uint256 _lpAmountDesired,
        uint256 _xlpAmountDesired,
        uint256 _lpAmountMin,
        uint256 _xlpAmountMin
    ) external onlyOperator {
        require(_lpAmountDesired >= _lpAmountMin, "lp desired amount less than min");
        require(_xlpAmountDesired >= _xlpAmountMin, "xlp desired amount less than min");

        uint256 xlpBalance = xlpToken.balanceOf(address(this));
        uint256 lpBalance = lpToken.balanceOf(address(this));
        require(lpBalance >= _lpAmountDesired && xlpBalance >= _xlpAmountDesired, "not enough tokens");

        lpToken.safeIncreaseAllowance(address(router), _lpAmountDesired);
        IERC20(address(xlpToken)).safeIncreaseAllowance(address(router), _xlpAmountDesired);
        router.addLiquidity(
            address(lpToken),
            address(xlpToken),
            _lpAmountDesired,
            _xlpAmountDesired,
            _lpAmountMin,
            _xlpAmountMin,
            address(this),
            block.timestamp + 10
        );
    }

    function removeLiquidity(
        uint256 _liquidity,
        uint256 _lpAmountMin,
        uint256 _xlpAmountMin
    ) external onlyOperator {
        uint256 balance = pair.balanceOf(address(this));
        require(balance >= _liquidity, "not enough tokens");
        pair.safeIncreaseAllowance(address(router), _liquidity);
        router.removeLiquidity(
            address(lpToken),
            address(xlpToken),
            _liquidity,
            _lpAmountMin,
            _xlpAmountMin,
            address(this),
            block.timestamp + 10
        );
    }

    // swap on v2 pair directly
    /*function swap(address _token, address _target, uint256 _amount, bytes memory _data) external onlyOperator {
        // optimistically transfer tokens
        IERC20(_token).safeTransfer(_target, _amount);
        (bool success,) = _target.call{value:0}(_data);
        require(success, "swap failed");
    }*/

    function pullReserveLPTokens(uint256 _amount) external {
        uint256 lockerBalance = lpToken.balanceOf(address(lpLocker));
        if (_amount == 0) {
            _amount = lockerBalance;
        }
        require(_amount <= lockerBalance, "not enough tokens");
        lpLocker.withdrawLPToken(_amount);
        // also mint amount of xlp tokens
        xlpToken.mint(address(this), _amount);
    }


    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }
}
