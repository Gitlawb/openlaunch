// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {LaunchLocker} from "./LaunchLocker.sol";

/// @title LaunchFactoryArc
/// @dev The Arc (chain 5042) deployment of LaunchFactory: a verbatim copy of src/LaunchFactory.sol plus ONE guard.
///      On Arc the native asset is USDC, and the same balance is also the ERC-20 at 0x3600…0000. LaunchLocker keeps
///      one ledger per currency (`reserved`, `claimable`), so a native-quoted position there would let a credited
///      ERC-20 share (a payout on Circle's blocklist) be read as native surplus by another launch's `collect` and
///      swept. `launch` therefore refuses `quote = address(0)`, unconditionally: this contract is only ever deployed on
///      Arc. USDC pools use the ERC-20 face. Everything else,
///      and the locker it deploys, is byte-for-byte the Base / Robinhood Chain code. script/check-arc-factory.sh keeps
///      the two files in sync.
///
/// @notice One-call, zero-ETH, zero-platform-fee token launcher on Uniswap v4.
///
/// FREE, by construction: the factory takes no launch fee, the locker takes no
/// cut of trading fees, and neither contract has a treasury, owner, or fee
/// setter. The only cost of a launch is gas. Whatever LP fee the launcher
/// picks (0–3%) accrues 100% to the beneficiaries they name. Beneficiaries are
/// optional: with none, every fee the pool earns is BURNED (sent to 0x…dEaD)
/// at collect time, so a launch can have no one behind it at all.
///
/// `launch()` in a single transaction:
///   1. deploys a fixed-supply LaunchToken (CREATE2, salt scoped to the caller)
///   2. initializes a native-ETH / token v4 pool at `startTick` (no hook)
///   3. mints ONE single-sided position holding 100% of supply, from the
///      lowest usable tick up to `startTick`, owned by the LaunchLocker
///   4. registers the fee recipients on the locker (empty list = burn 100% of fees)
///
/// The quote (what buyers pay with) is native ETH by default, or any ERC20 —
/// a stablecoin, a tokenized stock. The factory requires the launched token to
/// sort ABOVE the quote so the quote is always currency0 and the token always
/// currency1: the position is `[minUsableTick, startTick]` and the price moves
/// DOWN in tick space as people buy. Native ETH (address zero) satisfies this
/// for free; for an ERC20 quote, pick a salt with `findSalt` (one view call).
/// Nobody deposits quote: buyers bring it as they trade in.
///
/// Trust properties:
///   - No owner, no admin, no upgradeability, no pause, no allowlist.
///   - The factory never holds funds after a launch; any rounding dust that
///     cannot fit the position is burned to 0x…dEaD in the same transaction.
///   - The factory is the ONLY address that can `register()` on its locker,
///     and it only does so for positions it just minted.
///   - Anti-snipe (decaying launch tax) is intentionally NOT here — that is a
///     hook, and a hook is a swap-path risk. Add it as a v2 opt-in.
contract LaunchFactoryArc {
    using PoolIdLibrary for PoolKey;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address quote; // address(0) = native ETH; else any ERC20 (USDG, a stock token, WETH…)
        uint256 supply; // 0 → DEFAULT_SUPPLY
        int24 startTick; // multiple of TICK_SPACING; price = 1.0001^tick token per quote unit
        uint24 lpFee; // pips, 0 ≤ lpFee ≤ MAX_LP_FEE (10_000 = 1%); 0 = feeless pool
        bytes32 salt; // scoped to msg.sender; token address must sort above `quote` (see findSalt)
        LaunchLocker.Recipient[] recipients; // bps must sum to 10_000; empty = [DEAD: 100%] (fees burned)
    }

    struct Info {
        uint256 tokenId;
        address launcher;
        address quote;
        int24 startTick;
        uint24 lpFee;
    }

    int24 public constant TICK_SPACING = 200;
    uint24 public constant MAX_LP_FEE = 30_000; // 3%
    uint256 public constant DEFAULT_SUPPLY = 1_000_000_000e18;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    LaunchLocker public immutable locker;

    mapping(address token => Info) public infoOf;
    uint256 public launchCount;

    event Launched(
        address indexed token,
        uint256 indexed tokenId,
        address indexed launcher,
        address quote,
        PoolId poolId,
        int24 startTick,
        uint24 lpFee,
        uint256 supply,
        string metadataURI
    );

    error BadSupply();
    error BadFee();
    error BadTick();
    error NoLiquidity();
    error SaltUsed();
    error QuoteOrdering();
    error NoSaltFound();
    error NativeQuoteUnsupported();

    constructor(IPoolManager poolManager_, IPositionManager positionManager_, IAllowanceTransfer permit2_) {
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        locker = new LaunchLocker(positionManager_);
    }

    /// @notice Deploy a token and lock 100% of it as single-sided liquidity.
    function launch(LaunchParams calldata p) external returns (address token, uint256 tokenId) {
        uint256 supply = p.supply == 0 ? DEFAULT_SUPPLY : p.supply;
        if (supply > type(uint128).max) revert BadSupply();
        if (p.lpFee > MAX_LP_FEE) revert BadFee();
        if (p.quote == address(0)) revert NativeQuoteUnsupported(); // Arc: see the contract note

        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        if (
            p.startTick % TICK_SPACING != 0 || p.startTick <= tickLower
                || p.startTick > TickMath.maxUsableTick(TICK_SPACING)
        ) revert BadTick();

        // 1. token — full supply lands on this contract. A CREATE2 collision
        //    would burn the entire gas limit, so pre-check the address instead.
        bytes32 salt = keccak256(abi.encode(msg.sender, p.salt));
        {
            address predicted = _predict(salt, p.name, p.symbol, supply, msg.sender, p.metadataURI);
            if (predicted.code.length != 0) revert SaltUsed();
            // quote must be currency0: strictly lower address than the token
            if (uint160(predicted) <= uint160(p.quote)) revert QuoteOrdering();
        }
        token = address(new LaunchToken{salt: salt}(p.name, p.symbol, supply, msg.sender, p.metadataURI));

        // 2. pool at the start price
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(p.quote),
            currency1: Currency.wrap(token),
            fee: p.lpFee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(p.startTick);
        poolManager.initialize(key, sqrtUpper);

        // 3. single-sided position [minTick, startTick]; current tick == upper → token-only
        uint128 liquidity =
            LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), sqrtUpper, supply);
        if (liquidity == 0) revert NoLiquidity();

        LaunchToken(token).approve(address(permit2), supply);
        permit2.approve(token, address(positionManager), uint160(supply), uint48(block.timestamp));

        tokenId = positionManager.nextTokenId();
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key, tickLower, p.startTick, uint256(liquidity), uint128(0), uint128(supply), address(locker), bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        // hygiene: drop the allowance, burn whatever rounding left behind
        LaunchToken(token).approve(address(permit2), 0);
        uint256 dust = LaunchToken(token).balanceOf(address(this));
        if (dust > 0) require(LaunchToken(token).transfer(DEAD, dust), "dust burn failed");

        // 4. fee routing — no beneficiary named ⇒ every fee is burned
        if (p.recipients.length == 0) {
            LaunchLocker.Recipient[] memory burn = new LaunchLocker.Recipient[](1);
            burn[0] = LaunchLocker.Recipient({payout: DEAD, bps: uint16(locker.BPS())});
            locker.register(tokenId, token, p.quote, burn);
        } else {
            locker.register(tokenId, token, p.quote, p.recipients);
        }

        infoOf[token] =
            Info({tokenId: tokenId, launcher: msg.sender, quote: p.quote, startTick: p.startTick, lpFee: p.lpFee});
        unchecked {
            ++launchCount;
        }
        emit Launched(token, tokenId, msg.sender, p.quote, key.toId(), p.startTick, p.lpFee, supply, p.metadataURI);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @notice The pool key for a token launched here (reverts if unknown).
    function poolKeyOf(address token) external view returns (PoolKey memory) {
        Info memory i = infoOf[token];
        if (i.tokenId == 0) revert BadTick();
        return PoolKey({
            currency0: Currency.wrap(i.quote),
            currency1: Currency.wrap(token),
            fee: i.lpFee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    /// @notice Pre-compute the token address a `launch()` from `launcher` would produce.
    function predictToken(
        address launcher,
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        uint256 supply,
        string calldata metadataURI
    ) external view returns (address) {
        if (supply == 0) supply = DEFAULT_SUPPLY;
        return _predict(keccak256(abi.encode(launcher, salt)), name, symbol, supply, launcher, metadataURI);
    }

    /// @notice Find a salt (derived from `baseSalt`) whose token address sorts
    /// above `quote`, so the launch passes the currency-ordering check. Pure
    /// hashing, so one `eth_call` is enough; ~50% of candidates qualify, and
    /// `maxTries` bounds the loop. Returns the salt to pass in `LaunchParams`.
    function findSalt(
        address launcher,
        bytes32 baseSalt,
        string calldata name,
        string calldata symbol,
        uint256 supply,
        string calldata metadataURI,
        address quote,
        uint256 maxTries
    ) external view returns (bytes32 salt, address token) {
        if (supply == 0) supply = DEFAULT_SUPPLY;
        for (uint256 i; i < maxTries; ++i) {
            salt = i == 0 ? baseSalt : keccak256(abi.encode(baseSalt, i));
            token = _predict(keccak256(abi.encode(launcher, salt)), name, symbol, supply, launcher, metadataURI);
            if (uint160(token) > uint160(quote) && token.code.length == 0) return (salt, token);
        }
        revert NoSaltFound();
    }

    function _predict(
        bytes32 scopedSalt,
        string memory name,
        string memory symbol,
        uint256 supply,
        address launcher,
        string memory metadataURI
    ) internal view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(type(LaunchToken).creationCode, abi.encode(name, symbol, supply, launcher, metadataURI))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), scopedSalt, initHash)))));
    }
}
