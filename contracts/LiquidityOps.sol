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

interface IV2Pair {
    function getReserves() external view returns (uint112, uint112, uint32);
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
    ) external returns (uint amountA, uint amountB, uint liquidity);
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract LiquidityOps is Ownable {
    using SafeERC20 for IERC20;

    ILPLocker public lpLocker;
    IXLPToken public xlpToken;
    IERC20 public lpToken;
    IERC20 public pair; // univ2 pair
    IUniswapRouterV2 public router;

    address public operator;
    address public token0;
    address public token1;

    event ReservesPulled(uint256 amount);
    event LiquidityAdded(uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(uint256 amountA, uint256 amountB);

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

        (token0, token1) = _lpToken < _xlpToken ? (_lpToken, _xlpToken) : (_xlpToken, _lpToken);
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
        (uint amountA, uint amountB, uint liquidity) = router.addLiquidity(
            address(lpToken),
            address(xlpToken),
            _lpAmountDesired,
            _xlpAmountDesired,
            _lpAmountMin,
            _xlpAmountMin,
            address(this),
            block.timestamp + 10
        );

        emit LiquidityAdded(amountA, amountB, liquidity);
    }

    function removeLiquidity(
        uint256 _liquidity,
        uint256 _lpAmountMin,
        uint256 _xlpAmountMin
    ) external onlyOperator {
        uint256 balance = pair.balanceOf(address(this));
        require(balance >= _liquidity, "not enough tokens");
        pair.safeIncreaseAllowance(address(router), _liquidity);
        (uint256 amountA, uint256 amountB) = router.removeLiquidity(
            address(lpToken),
            address(xlpToken),
            _liquidity,
            _lpAmountMin,
            _xlpAmountMin,
            address(this),
            block.timestamp + 10
        );

        emit LiquidityRemoved(amountA, amountB);
    }

    function swapExactLPForStaxLP(
        uint256 _amount
    ) external onlyOperator {
        uint256 lpBalance = lpToken.balanceOf(address(this));
        require(lpBalance >= _amount, "not enough tokens");
        address[] memory path = new address[](2);
        path[0] = address(lpToken);
        path[1] = address(xlpToken);

        _swap(_amount, path);
    }

    function swapExactStaxLPForLP(
        uint256 _amount
    ) external onlyOperator {
        uint256 xlpBalance = xlpToken.balanceOf(address(this));
        require(xlpBalance >= _amount, "not enough tokens");
        address[] memory path = new address[](2);
        path[0] = address(xlpToken);
        path[1] = address(lpToken);

        _swap(_amount, path);
    }

    function _swap(
        uint256 _amount,
        address[] memory _path
    ) internal {
        (uint112 reserve0, uint112 reserve1,) = IV2Pair(address(pair)).getReserves();
        (uint112 reserveA, uint112 reserveB) = _path[0] == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        uint256 amountOutMin = _getAmountOut(_amount, reserveA, reserveB);
        router.swapExactTokensForTokens(
            _amount,
            amountOutMin,
            _path,
            address(this),
            block.timestamp + 10
        );
    }

     // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function _getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function pullReserveLPTokens(uint256 _amount) external {
        uint256 lockerBalance = lpToken.balanceOf(address(lpLocker));
        if (_amount == 0) {
            _amount = lockerBalance;
        }
        require(_amount <= lockerBalance, "not enough tokens");
        lpLocker.withdrawLPToken(_amount);
        // also mint amount of xlp tokens
        xlpToken.mint(address(this), _amount);

        emit ReservesPulled(_amount);
    }


    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }
}
