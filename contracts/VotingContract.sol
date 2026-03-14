// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Verifier.sol";

/**
 * @title VotingContract
 * @notice Electronic voting system with ZK-SNARK proof verification.
 *
 * Proof-of-concept for 15 voters and 2 candidates.
 * Everything is stored on-chain — no database is used.
 *
 * Public-signal layout expected from the ZK circuit:
 *   publicSignals[0] — nullifier hash (prevents double voting)
 *   publicSignals[1] — candidate ID  (0 = blank, type(uint256).max = null/invalid)
 */
contract VotingContract {
    // ─────────────────────────── State variables ────────────────────────────

    string public electionName;
    string public electionDescription;
    address public admin;

    enum ElectionState {
        PENDING,
        OPEN,
        FINISHED
    }
    ElectionState public state;

    IVerifier public verifier;

    uint256 public voterMerkleRoot;
    uint256[] public voterHashes;
    mapping(uint256 => bool) public usedNullifiers;

    struct Candidate {
        uint256 id;
        string name;
        string party;
        uint256 number;
        uint256 voteCount;
    }

    Candidate[] public candidates;
    uint256 public blankVotes;
    uint256 public nullVotes;

    // Special sentinel values for blank / null votes (must match the ZK circuit)
    uint256 public constant BLANK_VOTE_ID = 0;
    uint256 public constant NULL_VOTE_ID = type(uint256).max;

    // ──────────────────────────────── Events ────────────────────────────────

    event ElectionCreated(string name);
    event CandidateAdded(uint256 indexed id, string name, uint256 number);
    event VoterHashesRegistered(uint256[] hashes);
    event MerkleRootSet(uint256 root);
    event ElectionOpened(uint256 timestamp);
    event VoteCast(uint256 indexed nullifier, uint256 indexed candidateId);
    event ElectionClosed(uint256 timestamp, uint256 totalVotes);

    // ──────────────────────────────── Errors ────────────────────────────────

    error NotAdmin();
    error ElectionAlreadyExists();
    error ElectionNotPending();
    error ElectionNotOpen();
    error ElectionNotFinished();
    error InvalidProof();
    error NullifierAlreadyUsed(uint256 nullifier);
    error CandidateNotFound(uint256 candidateId);

    // ─────────────────────────────── Modifiers ──────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier inState(ElectionState _state) {
        if (state != _state) {
            if (_state == ElectionState.PENDING) revert ElectionNotPending();
            if (_state == ElectionState.OPEN) revert ElectionNotOpen();
            revert ElectionNotFinished();
        }
        _;
    }

    // ────────────────────────────── Constructor ──────────────────────────────

    /**
     * @param _verifier Address of the deployed Verifier (or MockVerifier for tests).
     */
    constructor(address _verifier) {
        admin = msg.sender;
        state = ElectionState.PENDING;
        verifier = IVerifier(_verifier);
    }

    // ─────────────────────────── Admin functions ────────────────────────────

    /**
     * @notice Initialise the election metadata.
     * @dev Can only be called once while the election is in PENDING state.
     */
    function createElection(
        string calldata _name,
        string calldata _description
    ) external onlyAdmin inState(ElectionState.PENDING) {
        if (bytes(electionName).length != 0) revert ElectionAlreadyExists();
        electionName = _name;
        electionDescription = _description;
        emit ElectionCreated(_name);
    }

    /**
     * @notice Add a candidate to the election.
     */
    function addCandidate(
        string calldata _name,
        string calldata _party,
        uint256 _number
    ) external onlyAdmin inState(ElectionState.PENDING) {
        uint256 id = candidates.length + 1; // IDs start at 1
        candidates.push(Candidate(id, _name, _party, _number, 0));
        emit CandidateAdded(id, _name, _number);
    }

    /**
     * @notice Register the voter identity hashes (for public auditability).
     * @dev Replaces any previously stored hashes.
     */
    function registerVoterHashes(
        uint256[] calldata _hashes
    ) external onlyAdmin inState(ElectionState.PENDING) {
        delete voterHashes;
        for (uint256 i = 0; i < _hashes.length; i++) {
            voterHashes.push(_hashes[i]);
        }
        emit VoterHashesRegistered(_hashes);
    }

    /**
     * @notice Set the Merkle root of the voter set (used inside the ZK circuit).
     */
    function setMerkleRoot(
        uint256 _root
    ) external onlyAdmin inState(ElectionState.PENDING) {
        voterMerkleRoot = _root;
        emit MerkleRootSet(_root);
    }

    /**
     * @notice Transition the election from PENDING to OPEN.
     */
    function openElection()
        external
        onlyAdmin
        inState(ElectionState.PENDING)
    {
        state = ElectionState.OPEN;
        emit ElectionOpened(block.timestamp);
    }

    /**
     * @notice Transition the election from OPEN to FINISHED.
     */
    function closeElection() external onlyAdmin inState(ElectionState.OPEN) {
        state = ElectionState.FINISHED;
        uint256 total = _computeTotalVotes();
        emit ElectionClosed(block.timestamp, total);
    }

    // ─────────────────────────── Voting function ────────────────────────────

    /**
     * @notice Cast a vote with a ZK-SNARK proof.
     *
     * @param _pA     Groth16 proof point A
     * @param _pB     Groth16 proof point B
     * @param _pC     Groth16 proof point C
     * @param _pubSignals  [nullifier, candidateId]
     *
     * candidateId semantics:
     *   0                  → blank vote
     *   type(uint256).max  → null / invalid vote
     *   1..N               → valid candidate ID
     */
    function castVote(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[2] calldata _pubSignals
    ) external inState(ElectionState.OPEN) {
        // 1. Verify the ZK proof
        if (!verifier.verifyProof(_pA, _pB, _pC, _pubSignals))
            revert InvalidProof();

        uint256 nullifier = _pubSignals[0];
        uint256 candidateId = _pubSignals[1];

        // 2. Prevent double voting
        if (usedNullifiers[nullifier])
            revert NullifierAlreadyUsed(nullifier);
        usedNullifiers[nullifier] = true;

        // 3. Register the vote
        if (candidateId == BLANK_VOTE_ID) {
            blankVotes++;
        } else if (candidateId == NULL_VOTE_ID) {
            nullVotes++;
        } else {
            bool found = false;
            for (uint256 i = 0; i < candidates.length; i++) {
                if (candidates[i].id == candidateId) {
                    candidates[i].voteCount++;
                    found = true;
                    break;
                }
            }
            if (!found) revert CandidateNotFound(candidateId);
        }

        emit VoteCast(nullifier, candidateId);
    }

    // ──────────────────────────── View functions ─────────────────────────────

    /**
     * @notice Return the current election results.
     * @return _candidates  Array of Candidate structs with updated vote counts.
     * @return _blankVotes  Number of blank votes.
     * @return _nullVotes   Number of null / invalid votes.
     * @return _totalVotes  Total number of votes cast.
     */
    function getResults()
        external
        view
        returns (
            Candidate[] memory _candidates,
            uint256 _blankVotes,
            uint256 _nullVotes,
            uint256 _totalVotes
        )
    {
        _candidates = candidates;
        _blankVotes = blankVotes;
        _nullVotes = nullVotes;
        _totalVotes = _computeTotalVotes();
    }

    /**
     * @notice Return the registered voter hashes for public auditability.
     */
    function getVoterHashes() external view returns (uint256[] memory) {
        return voterHashes;
    }

    /**
     * @notice Return the number of registered candidates.
     */
    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }

    // ─────────────────────────── Internal helpers ───────────────────────────

    function _computeTotalVotes() internal view returns (uint256 total) {
        total = blankVotes + nullVotes;
        for (uint256 i = 0; i < candidates.length; i++) {
            total += candidates[i].voteCount;
        }
    }
}
