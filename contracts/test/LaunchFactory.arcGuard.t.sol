// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {LaunchFactoryArc} from "src/LaunchFactoryArc.sol";

/// LaunchFactoryArc refuses a native quote before any state change or external call (unconditionally: it is only ever
/// deployed on Arc). No Uniswap deployment is needed: the guard sits ahead of everything that would touch one.
contract LaunchFactoryArcGuard is Test {
    LaunchFactoryArc factory;

    function setUp() public {
        factory = new LaunchFactoryArc(
            IPoolManager(address(0xA)), IPositionManager(address(0xB)), IAllowanceTransfer(address(0xC))
        );
    }

    function _nativeParams() internal pure returns (LaunchFactoryArc.LaunchParams memory p) {
        p.name = "Guard";
        p.symbol = "GRD";
        p.quote = address(0);
        p.startTick = 184_200;
        p.salt = keccak256("guard");
    }

    function test_refusesNativeQuoteBeforeAnythingElse() public {
        vm.expectRevert(LaunchFactoryArc.NativeQuoteUnsupported.selector);
        factory.launch(_nativeParams());
    }

    function test_acceptsErc20QuotesPastTheGuard() public {
        LaunchFactoryArc.LaunchParams memory p = _nativeParams();
        p.quote = address(0x3600000000000000000000000000000000000000);
        // past the guard the launch reaches the (absent) Uniswap contracts and fails there, never with the guard's error
        try factory.launch(p) {
            fail();
        } catch (bytes memory err) {
            assertTrue(
                err.length < 4 || bytes4(err) != LaunchFactoryArc.NativeQuoteUnsupported.selector,
                "an ERC-20 quote passes the guard"
            );
        }
    }
}
