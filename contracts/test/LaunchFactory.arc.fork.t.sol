// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {LaunchFactory} from "src/LaunchFactory.sol";
import {LaunchFactoryArc} from "src/LaunchFactoryArc.sol";
import {LaunchLocker, IERC721Owner} from "src/LaunchLocker.sol";
import {LaunchToken} from "src/LaunchToken.sol";

interface IERC20Meta {
    function blacklist(address) external;
    function blacklister() external view returns (address);
    function isBlacklisted(address) external view returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IERC721Full {
    function ownerOf(uint256) external view returns (address);
    function getApproved(uint256) external view returns (address);
    function transferFrom(address, address, uint256) external;
    function approve(address, uint256) external;
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// Arc (Circle's L1, chain 5042), deploying LaunchFactoryArc (src/LaunchFactoryArc.sol): gas is USDC. The native asset is USDC at 18 decimals and the SAME balance is the
/// 6-decimal ERC-20 at 0x3600…0000, which is the only quote the launchpad offers there. Against the LIVE Uniswap v4
/// deployment on Arc this proves, before our factory is deployed there:
///   1. a USDC-quoted launch → buy → collect works on the real PoolManager / PositionManager / Permit2;
///   2. the live Universal Router (v2.1.1) decodes the "v2" ExactInputSingleParams layout (with minHopPriceX36) that
///      the app encodes for Arc (app/src/lib/launchpad/config.ts swapLayout), and rejects the older "v1" layout.
/// Native USDC quirks (system Transfer logs, the blocklist) are not exercised: nothing here sends native value.
///
/// Runs only under Circle's arc-foundry with the `arc` profile (foundry.toml): USDC's ERC-20 face moves native balance
/// through an Arc-only opcode, so upstream forge reverts every USDC transfer with OpcodeNotFound (the launch itself
/// passes there, the buys do not). Verified 2026-09-16 against the public RPC, all four green:
///   FOUNDRY_PROFILE=arc FORK_TESTS=true ARC_RPC_URL=… arc-forge test --match-contract LaunchFactoryArcFork -vv
contract LaunchFactoryArcFork is Test {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSM = 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ROUTER = 0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1;
    address constant QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    address constant USDC = 0x3600000000000000000000000000000000000000;
    int24 constant USD_START_TICK = 391_400; // ≈ $10k FDV for 1B supply against a 6-dec dollar quote

    IPoolManager manager = IPoolManager(PM);
    IPositionManager posm = IPositionManager(POSM);
    PoolSwapTest swapRouter;
    LaunchFactoryArc factory;
    LaunchLocker locker;
    bool forked;

    address alice = makeAddr("launchpad-arc-alice");
    address bob = makeAddr("launchpad-arc-bob");
    address buyer = makeAddr("launchpad-arc-buyer");

    /// The pre-minHopPriceX36 layout (Base's Universal Router 2.0): must NOT be what Arc's router decodes.
    struct ExactInputSingleParamsV1 {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork(vm.envOr("ARC_RPC_URL", string("https://rpc.mainnet.arc.io")));
        forked = true;
        assertEq(block.chainid, 5042, "rpc points at Arc mainnet");
        swapRouter = new PoolSwapTest(manager);
        factory = new LaunchFactoryArc(manager, posm, IAllowanceTransfer(PERMIT2));
        locker = factory.locker();
        // native USDC (18 dec) IS the ERC-20 balance (6 dec): fund the buyer once, in native units
        vm.deal(buyer, 1_000 ether);
        assertEq(alice.code.length + bob.code.length + buyer.code.length, 0, "test accounts are empty EOAs");
    }

    function _params() internal view returns (LaunchFactoryArc.LaunchParams memory p) {
        LaunchLocker.Recipient[] memory r = new LaunchLocker.Recipient[](2);
        r[0] = LaunchLocker.Recipient(alice, 6_000);
        r[1] = LaunchLocker.Recipient(bob, 4_000);
        p.name = "Arc Coin";
        p.symbol = "ARCC";
        p.metadataURI = "ipfs://arc";
        p.quote = USDC;
        p.startTick = USD_START_TICK;
        p.lpFee = 10_000;
        p.recipients = r;
        (bytes32 salt,) =
            factory.findSalt(address(this), keccak256("arc"), p.name, p.symbol, 0, p.metadataURI, USDC, 64);
        p.salt = salt;
    }

    function test_fork_arc_liveContractsPresent() public {
        vm.skip(!forked);
        assertGt(PM.code.length, 0, "PoolManager deployed");
        assertGt(POSM.code.length, 0, "PositionManager deployed");
        assertGt(PERMIT2.code.length, 0, "Permit2 deployed");
        assertGt(ROUTER.code.length, 0, "Universal Router deployed");
        assertGt(QUOTER.code.length, 0, "V4Quoter deployed");
        assertGt(posm.nextTokenId(), 0, "PositionManager is live");
        assertEq(IERC20Meta(USDC).decimals(), 6, "ERC-20 USDC has 6 decimals");
        assertEq(IERC20Meta(USDC).symbol(), "USDC");
    }

    function test_fork_arc_nativeAndErc20UsdcAreOneBalance() public {
        vm.skip(!forked);
        // 1000 USDC of native (18 dec) reads as 1000e6 through the ERC-20 face: the app's gas reserve maths relies on this
        assertEq(IERC20Meta(USDC).balanceOf(buyer), 1_000e6, "ERC-20 balanceOf mirrors the native balance at 1e12");
    }

    function test_fork_arc_launchWithUsdcQuoteBuyCollect() public {
        vm.skip(!forked);
        LaunchFactoryArc.LaunchParams memory p = _params();
        (address token, uint256 tokenId) = factory.launch(p);
        LaunchToken t = LaunchToken(token);
        assertEq(IERC721Owner(address(posm)).ownerOf(tokenId), address(locker), "real posm minted to locker");
        assertEq(t.balanceOf(address(manager)) + t.balanceOf(factory.DEAD()), t.totalSupply(), "all supply in pool");
        assertEq(locker.quoteOf(tokenId), USDC);

        uint256 quoteIn = 100e6;
        PoolKey memory key = factory.poolKeyOf(token);
        vm.startPrank(buyer);
        IERC20Meta(USDC).approve(address(swapRouter), quoteIn);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(quoteIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        assertGt(t.balanceOf(buyer), 0, "bought with real USDC");
        assertEq(IERC20Meta(USDC).balanceOf(buyer), 900e6, "paid 100 USDC (gas is free under prank)");

        (uint256 quoteOut,) = locker.collect(tokenId);
        assertApproxEqRel(quoteOut, quoteIn / 100, 1e15, "1% fee in USDC");
        assertEq(IERC20Meta(USDC).balanceOf(alice), (quoteOut * 6_000) / 10_000, "alice paid in USDC, directly");
        assertEq(IERC20Meta(USDC).balanceOf(bob), quoteOut - (quoteOut * 6_000) / 10_000, "bob got the rest");
    }

    /// Burn mode (no beneficiary) sends the quote fee to 0x…dEaD with a plain ERC-20 transfer. Circle's USDC keeps a
    /// blocklist and Arc reverts transfers to some special addresses, so this pins that USDC → dEaD works on Arc:
    /// otherwise every burn-mode launch's collect() would revert forever (LaunchLocker._burn).
    function test_fork_arc_burnModeSendsUsdcFeesToDead() public {
        vm.skip(!forked);
        LaunchFactoryArc.LaunchParams memory p = _params();
        p.recipients = new LaunchLocker.Recipient[](0);
        p.symbol = "ARCB";
        (bytes32 salt,) =
            factory.findSalt(address(this), keccak256("arc-burn"), p.name, p.symbol, 0, p.metadataURI, USDC, 64);
        p.salt = salt;
        (address token, uint256 tokenId) = factory.launch(p);
        uint256 quoteIn = 100e6;
        PoolKey memory key = factory.poolKeyOf(token);
        vm.startPrank(buyer);
        IERC20Meta(USDC).approve(address(swapRouter), quoteIn);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(quoteIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        uint256 deadBefore = IERC20Meta(USDC).balanceOf(locker.DEAD());
        (uint256 quoteOut,) = locker.collect(tokenId);
        assertApproxEqRel(quoteOut, quoteIn / 100, 1e15, "1% fee in USDC");
        assertEq(
            IERC20Meta(USDC).balanceOf(locker.DEAD()) - deadBefore, quoteOut, "the whole USDC fee was burned to dEaD"
        );
    }

    /// The app buys through the Universal Router with Permit2 (app/src/lib/launchpad/swap.ts): same commands, same
    /// actions, and for Arc the "v2" params layout. Both layouts are tried against the live router.
    function test_fork_arc_universalRouterDecodesV2Layout() public {
        vm.skip(!forked);
        (address token,) = factory.launch(_params());
        PoolKey memory key = factory.poolKeyOf(token);
        uint128 amountIn = 50e6;

        vm.startPrank(buyer);
        IERC20Meta(USDC).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(USDC, ROUTER, type(uint160).max, uint48(block.timestamp + 30 days));

        // v1 layout (no minHopPriceX36): the router must reject it, or the app would be encoding the wrong struct
        bytes[] memory inputsV1 = new bytes[](1);
        inputsV1[0] = _v4SwapInput(
            abi.encode(
                ExactInputSingleParamsV1({
                    poolKey: key, zeroForOne: true, amountIn: amountIn, amountOutMinimum: 0, hookData: ""
                })
            ),
            key,
            amountIn
        );
        vm.expectRevert();
        IUniversalRouter(ROUTER).execute(abi.encodePacked(uint8(0x10)), inputsV1, block.timestamp + 600);

        // v2 layout: what config.ts encodes for Arc
        bytes[] memory inputsV2 = new bytes[](1);
        inputsV2[0] = _v4SwapInput(
            abi.encode(
                IV4Router.ExactInputSingleParams({
                    poolKey: key,
                    zeroForOne: true,
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    minHopPriceX36: 0,
                    hookData: ""
                })
            ),
            key,
            amountIn
        );
        IUniversalRouter(ROUTER).execute(abi.encodePacked(uint8(0x10)), inputsV2, block.timestamp + 600);
        vm.stopPrank();
        assertGt(LaunchToken(token).balanceOf(buyer), 0, "router swap delivered tokens");
        assertEq(IERC20Meta(USDC).balanceOf(buyer), 950e6, "router pulled exactly amountIn through Permit2");
    }

    // ── rug attempts against Arc's PositionManager (a different build from Base's and Robinhood's) ─────────────────
    // Same assertions as LaunchLockerRugFork / LaunchLockerRugRobinhood, against the locker this suite deployed on the fork.

    function _tryDecrease(address who, uint256 tokenId, address token) internal {
        uint128 liq = posm.getPositionLiquidity(tokenId);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, liq, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(USDC), Currency.wrap(token), who);
        bytes memory data = abi.encode(actions, params);
        uint256 deadline = block.timestamp + 1;
        vm.prank(who);
        vm.expectRevert();
        posm.modifyLiquidities(data, deadline);
    }

    function test_fork_arc_lockerOwnsThePositionAndNobodyCanMoveOrShrinkIt() public {
        vm.skip(!forked);
        (address token, uint256 tokenId) = factory.launch(_params());
        IERC721Full nft = IERC721Full(POSM);
        assertEq(nft.ownerOf(tokenId), address(locker), "position minted to the locker");
        assertEq(nft.getApproved(tokenId), address(0), "no operator approved");
        assertEq(locker.factory(), address(factory));
        address deployer = address(this);
        address stranger = makeAddr("launchpad-arc-stranger");
        vm.prank(deployer);
        vm.expectRevert();
        nft.transferFrom(address(locker), deployer, tokenId);
        vm.prank(stranger);
        vm.expectRevert();
        nft.transferFrom(address(locker), stranger, tokenId);
        vm.prank(stranger);
        vm.expectRevert();
        nft.approve(stranger, tokenId);
        _tryDecrease(deployer, tokenId, token);
        _tryDecrease(stranger, tokenId, token);
        // (the locker itself, as the NFT owner, could decrease: the guarantee is that no code path in it does — see test_fork_arc_noAdminSurface and src/LaunchLocker.sol)
        // collect never touches liquidity
        uint128 before = posm.getPositionLiquidity(tokenId);
        locker.collect(tokenId);
        assertEq(posm.getPositionLiquidity(tokenId), before, "liquidity untouched by collect");
        assertEq(nft.ownerOf(tokenId), address(locker));
    }

    function test_fork_arc_noAdminSurface() public {
        vm.skip(!forked);
        (address token,) = factory.launch(_params());
        (bool ok,) = address(locker).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "locker has no owner");
        (ok,) = address(factory).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "factory has no owner");
        (ok,) = token.call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        assertFalse(ok, "token cannot mint");
        (ok,) = token.call(abi.encodeWithSignature("pause()"));
        assertFalse(ok, "token cannot pause");
    }

    // ── the two-ledger hazard: native and ERC-20 USDC are one balance, the locker accounts them separately ─────────
    /// Circle's blocklist makes a USDC push fail → the share is CREDITED and stays in the locker as ERC-20 USDC. That same
    /// balance is the locker's NATIVE balance, so a native-quoted pool's collect would read it as unreserved surplus.
    function _creditedUsdcViaBlocklistedRecipient() internal virtual returns (uint256 credited) {
        address blocked = makeAddr("launchpad-arc-blocked");
        vm.prank(IERC20Meta(USDC).blacklister());
        IERC20Meta(USDC).blacklist(blocked);
        assertTrue(IERC20Meta(USDC).isBlacklisted(blocked));
        LaunchFactoryArc.LaunchParams memory p = _params();
        LaunchLocker.Recipient[] memory r = new LaunchLocker.Recipient[](1);
        r[0] = LaunchLocker.Recipient(blocked, 10_000);
        p.recipients = r;
        p.symbol = "ARCX";
        (bytes32 salt,) =
            factory.findSalt(address(this), keccak256("arc-blocked"), p.name, p.symbol, 0, p.metadataURI, USDC, 64);
        p.salt = salt;
        (address token, uint256 tokenId) = factory.launch(p);
        PoolKey memory key = factory.poolKeyOf(token);
        vm.startPrank(buyer);
        IERC20Meta(USDC).approve(address(swapRouter), 100e6);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(100e6), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        (credited,) = locker.collect(tokenId);
        assertGt(credited, 0);
        assertEq(locker.claimable(blocked, USDC), credited, "the blocked share was credited, not paid");
        assertEq(locker.reserved(USDC), credited);
        assertEq(IERC20Meta(USDC).balanceOf(address(locker)), credited, "and it sits in the locker as ERC-20 USDC");
        assertEq(address(locker).balance, credited * 1e12, "which IS the locker's native balance");
    }

    function test_fork_arc_nativeQuotedPoolCannotSweepCreditedUsdc() public {
        vm.skip(!forked);
        uint256 credited = _creditedUsdcViaBlocklistedRecipient();
        // a native-quoted pool paying the attacker: on Arc the factory must refuse it (LaunchFactoryArc.NativeQuoteUnsupported)
        address attacker = makeAddr("launchpad-arc-attacker");
        LaunchFactoryArc.LaunchParams memory p = _params();
        LaunchLocker.Recipient[] memory r = new LaunchLocker.Recipient[](1);
        r[0] = LaunchLocker.Recipient(attacker, 10_000);
        p.recipients = r;
        p.quote = address(0);
        p.symbol = "ARCN";
        p.startTick = 184_200;
        p.salt = keccak256("arc-native");
        vm.expectRevert(LaunchFactoryArc.NativeQuoteUnsupported.selector);
        factory.launch(p);
        // the credited USDC is still exactly where the ledger says it is
        assertEq(IERC20Meta(USDC).balanceOf(address(locker)), credited);
        assertEq(locker.reserved(USDC), credited);
        assertEq(attacker.balance, 0, "nothing was swept");
    }

    /// Why the guard exists, demonstrated with the plain LaunchFactory (the Base / Robinhood contract) on Arc: it accepts a
    /// native quote, and that pool's first collect pays the attacker the credited USDC of the other launch on top of its
    /// own fee, leaving a reserved amount the locker no longer holds (every USDC collect below it would then underflow).
    function test_fork_arc_withoutTheGuardCreditedUsdcWouldBeSwept() public {
        vm.skip(!forked);
        // the unguarded contract, with its own locker; credit USDC into THAT locker via a blocklisted payout
        LaunchFactory plain = new LaunchFactory(manager, posm, IAllowanceTransfer(PERMIT2));
        LaunchLocker plainLocker = plain.locker();
        address blocked = makeAddr("launchpad-arc-blocked-2");
        vm.prank(IERC20Meta(USDC).blacklister());
        IERC20Meta(USDC).blacklist(blocked);
        LaunchFactory.LaunchParams memory q;
        q.name = "Arc Coin";
        q.symbol = "ARCX";
        q.metadataURI = "ipfs://arc";
        q.quote = USDC;
        q.startTick = USD_START_TICK;
        q.lpFee = 10_000;
        LaunchLocker.Recipient[] memory br = new LaunchLocker.Recipient[](1);
        br[0] = LaunchLocker.Recipient(blocked, 10_000);
        q.recipients = br;
        (bytes32 qs,) =
            plain.findSalt(address(this), keccak256("arc-blocked-2"), q.name, q.symbol, 0, q.metadataURI, USDC, 64);
        q.salt = qs;
        (address usdcToken, uint256 usdcId) = plain.launch(q);
        vm.startPrank(buyer);
        IERC20Meta(USDC).approve(address(swapRouter), 100e6);
        swapRouter.swap(
            plain.poolKeyOf(usdcToken),
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(100e6), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        (uint256 credited,) = plainLocker.collect(usdcId);
        assertEq(plainLocker.reserved(USDC), credited, "credited USDC sits in the unguarded locker");

        address attacker = makeAddr("launchpad-arc-attacker");
        LaunchFactory.LaunchParams memory p = q;
        LaunchLocker.Recipient[] memory r = new LaunchLocker.Recipient[](1);
        r[0] = LaunchLocker.Recipient(attacker, 10_000);
        p.recipients = r;
        p.quote = address(0);
        p.symbol = "ARCN";
        p.startTick = 184_200;
        p.salt = keccak256("arc-native");
        (address token, uint256 tokenId) = plain.launch(p); // accepted: no guard
        PoolKey memory key = plain.poolKeyOf(token);
        vm.prank(buyer);
        swapRouter.swap{value: 1 ether}(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        (uint256 paid,) = plainLocker.collect(tokenId);
        assertApproxEqRel(paid - credited * 1e12, 0.01 ether, 1e15, "own 1% fee on 1 USDC of volume");
        assertGt(paid, credited * 1e12, "plus the whole credited USDC of the other launch, swept as native");
        assertEq(IERC20Meta(USDC).balanceOf(address(plainLocker)), 0, "the locker's USDC is gone");
        assertEq(plainLocker.reserved(USDC), credited, "but still reserved: every smaller USDC collect now underflows");
    }

    function _v4SwapInput(bytes memory swapParams, PoolKey memory key, uint128 amountIn)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = swapParams;
        params[1] = abi.encode(key.currency0, uint256(amountIn));
        params[2] = abi.encode(key.currency1, uint256(0));
        return abi.encode(actions, params);
    }
}
