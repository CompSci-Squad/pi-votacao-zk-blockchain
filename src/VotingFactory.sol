// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./VotingContract.sol";

/**
 * @title VotingFactory
 * @notice Deploys per-event {VotingContract} instances that share a single
 *         on-chain PLONK Verifier, and emits cross-event audit anchors.
 *
 * Lifecycle:
 *   1. Deployer fixes the verifier address (immutable).
 *   2. Anyone calls {createEvent}; the factory deploys a new VotingContract,
 *      seeds its election metadata via {VotingContract.createElection}, then
 *      transfers admin to `msg.sender` in the same transaction so the caller
 *      walks away with full control of their event.
 *   3. {auditAnchor} lets the auditor (initially = factory deployer) commit a
 *      Merkle root or hash digest summarising off-chain audit state for an
 *      epoch — a tamper-evident anchor across every event the factory has
 *      produced.
 *
 * @dev The factory itself never holds funds, votes, or voter data; it is a
 *      pure deployer + bulletin-board for {EventCreated} / {AuditAnchor}
 *      events. Per-event security (CEI ordering, nullifier uniqueness, etc.)
 *      lives entirely inside {VotingContract}.
 */
contract VotingFactory {
    // ───────────────────────── Immutable / storage ──────────────────────────

    /// @notice Verifier shared by every event deployed through this factory.
    address public immutable verifier;

    /// @notice Address authorised to publish audit anchors. Initialised to the
    ///         factory deployer; transferable via {setAuditor}.
    address public auditor;

    /// @notice All events ever created by this factory, in deployment order.
    address[] public events;

    // ─────────────────────────────── Events ─────────────────────────────────

    event EventCreated(
        uint256 indexed eventId,
        address indexed admin,
        address eventAddress,
        string name
    );

    event AuditAnchor(uint256 indexed epoch, bytes32 root);

    event AuditorTransferred(address indexed previousAuditor, address indexed newAuditor);

    // ─────────────────────────────── Errors ─────────────────────────────────

    error ZeroAddress();
    error NotAuditor();

    // ─────────────────────────── Construction ───────────────────────────────

    constructor(address _verifier) {
        if (_verifier == address(0)) revert ZeroAddress();
        verifier = _verifier;
        auditor = msg.sender;
    }

    // ─────────────────────────── Modifiers ──────────────────────────────────

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    // ─────────────────────────── External API ───────────────────────────────

    /**
     * @notice Deploy a new VotingContract, seed its election metadata, and
     *         transfer admin to the caller.
     * @param name        Election display name (non-empty by convention).
     * @param description Short election description.
     * @return evt        Address of the freshly deployed VotingContract.
     */
    function createEvent(string calldata name, string calldata description)
        external
        returns (address evt)
    {
        VotingContract v = new VotingContract(verifier);
        v.createElection(name, description);
        v.transferAdmin(msg.sender);

        evt = address(v);
        events.push(evt);
        emit EventCreated(events.length - 1, msg.sender, evt, name);
    }

    /**
     * @notice Number of events ever deployed by this factory.
     */
    function eventCount() external view returns (uint256) {
        return events.length;
    }

    /**
     * @notice Publish an audit anchor (e.g. a Merkle root or aggregate hash)
     *         for the given epoch. Caller must be the current auditor.
     * @param epoch Caller-defined epoch identifier (block, round, etc.).
     * @param root  Anchor digest (32-byte commitment).
     */
    function auditAnchor(uint256 epoch, bytes32 root) external onlyAuditor {
        emit AuditAnchor(epoch, root);
    }

    /**
     * @notice Transfer auditor rights. Set to address(0) to revoke permanently.
     */
    function setAuditor(address newAuditor) external onlyAuditor {
        emit AuditorTransferred(auditor, newAuditor);
        auditor = newAuditor;
    }
}
