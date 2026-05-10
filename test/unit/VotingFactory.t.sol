// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {VotingFactory} from "../../src/VotingFactory.sol";
import {VotingContract} from "../../src/VotingContract.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";

/// @notice Unit coverage for VotingFactory: deployment, event creation,
///         admin transfer, audit anchor, and auditor access control.
contract VotingFactoryTest is Test {
    VotingFactory internal factory;
    MockVerifier internal verifier;

    address internal deployer = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    event EventCreated(
        uint256 indexed eventId,
        address indexed admin,
        address eventAddress,
        string name
    );
    event AuditAnchor(uint256 indexed epoch, bytes32 root);
    event AuditorTransferred(address indexed previousAuditor, address indexed newAuditor);

    function setUp() public {
        verifier = new MockVerifier();
        factory = new VotingFactory(address(verifier));
    }

    // ── Constructor ────────────────────────────────────────────────────────

    function test_Constructor_StoresVerifierAndAuditor() public view {
        assertEq(factory.verifier(), address(verifier));
        assertEq(factory.auditor(), deployer);
        assertEq(factory.eventCount(), 0);
    }

    function test_Constructor_RevertsOnZeroVerifier() public {
        vm.expectRevert(VotingFactory.ZeroAddress.selector);
        new VotingFactory(address(0));
    }

    // ── createEvent ────────────────────────────────────────────────────────

    function test_CreateEvent_DeploysAndTransfersAdmin() public {
        vm.prank(alice);
        address evt = factory.createEvent("Pres 2026", "Race for the executive");

        assertEq(factory.eventCount(), 1);
        assertEq(factory.events(0), evt);

        VotingContract v = VotingContract(evt);
        assertEq(v.admin(), alice, "admin must be transferred to caller");
        assertEq(v.electionName(), "Pres 2026");
        assertEq(v.electionDescription(), "Race for the executive");
        assertEq(v.currentElectionId(), 1);
        assertEq(address(v.verifier()), address(verifier));
        assertEq(uint8(v.state()), uint8(VotingContract.ElectionState.PENDING));
    }

    function test_CreateEvent_EmitsEventCreated() public {
        // We don't know evt address ahead; check indexed fields + name.
        vm.expectEmit(true, true, false, false, address(factory));
        emit EventCreated(0, alice, address(0), "Pres 2026");
        vm.prank(alice);
        factory.createEvent("Pres 2026", "x");
    }

    function test_CreateEvent_MultipleEventsHaveDistinctAddresses() public {
        vm.prank(alice);
        address a = factory.createEvent("A", "");
        vm.prank(bob);
        address b = factory.createEvent("B", "");
        assertTrue(a != b);
        assertEq(factory.eventCount(), 2);
        assertEq(VotingContract(a).admin(), alice);
        assertEq(VotingContract(b).admin(), bob);
    }

    // ── auditAnchor ────────────────────────────────────────────────────────

    function test_AuditAnchor_EmitsForAuditor() public {
        bytes32 root = keccak256("epoch-1-root");
        vm.expectEmit(true, false, false, true, address(factory));
        emit AuditAnchor(1, root);
        factory.auditAnchor(1, root);
    }

    function test_AuditAnchor_RevertsForNonAuditor() public {
        vm.prank(alice);
        vm.expectRevert(VotingFactory.NotAuditor.selector);
        factory.auditAnchor(1, bytes32(uint256(1)));
    }

    // ── setAuditor ─────────────────────────────────────────────────────────

    function test_SetAuditor_TransfersAndEmits() public {
        vm.expectEmit(true, true, false, false, address(factory));
        emit AuditorTransferred(deployer, alice);
        factory.setAuditor(alice);
        assertEq(factory.auditor(), alice);

        // Old auditor (deployer) can no longer post anchors.
        vm.expectRevert(VotingFactory.NotAuditor.selector);
        factory.auditAnchor(2, bytes32(uint256(2)));

        // New auditor can.
        vm.prank(alice);
        factory.auditAnchor(2, bytes32(uint256(2)));
    }

    function test_SetAuditor_RevertsForNonAuditor() public {
        vm.prank(alice);
        vm.expectRevert(VotingFactory.NotAuditor.selector);
        factory.setAuditor(bob);
    }
}
