// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Verifier.sol";

/**
 * @title VotingContract
 * @notice Electronic voting system with PLONK ZK-SNARK proof verification.
 *
 * Proof-of-concept for 15 voters and 2 candidates.
 * Everything is stored on-chain — no database is used.
 *
 * Public-signal layout expected from voter_proof.circom:
 *   pubSignals[0] — merkle_root    (voter Merkle tree root)
 *   pubSignals[1] — nullifier_hash (anti-double-vote commitment)
 *   pubSignals[2] — candidate_id   (0 = blank, 999 = null, 1..N = sequential candidate ID)
 *   pubSignals[3] — election_id    (unique election identifier)
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

    uint256 public currentElectionId;
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
    uint256 public totalVotes;

    // Special sentinel values for blank / null votes (must match the ZK circuit)
    uint256 public constant BLANK_VOTE_ID = 0;
    uint256 public constant NULL_VOTE_ID = 999;

    // ──────────────────────────────── Events ────────────────────────────────

    event ElectionCreated(string name, uint256 electionId);
    event CandidateAdded(uint256 indexed id, string name, uint256 number);
    event VoterHashesRegistered(uint256[] hashes);
    event MerkleRootSet(uint256 root);
    event ElectionOpened(uint256 timestamp, uint256 electionId);
    event VoteCast(uint256 indexed nullifier, uint256 indexed candidateId);
    event ElectionClosed(uint256 timestamp, uint256 totalVotes);

    // ──────────────────────────────── Errors ────────────────────────────────

    error NotAdmin();
    error ElectionAlreadyExists();
    error ElectionNotPending();
    error ElectionNotOpen();
    error ElectionNotFinished();
    error NoVoterHashesRegistered();
    error InvalidMerkleRoot(uint256 provided, uint256 expected);
    error InvalidElectionId(uint256 provided, uint256 expected);
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
     * @notice Initialise the election metadata and assign a unique election ID.
     * @dev Can only be called once while the election is in PENDING state.
     */
    function createElection(
        string calldata _name,
        string calldata _description
    ) external onlyAdmin inState(ElectionState.PENDING) {
        if (bytes(electionName).length != 0) revert ElectionAlreadyExists();
        electionName = _name;
        electionDescription = _description;
        // Simple sequential ID: always 1 for a single-election contract (PoC).
        currentElectionId = 1;
        emit ElectionCreated(_name, currentElectionId);
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
     * @param _hashes Array of Poseidon(voter_id) hashes
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
     * @dev Voter hashes must be registered before setting the root.
     */
    function setMerkleRoot(
        uint256 _root
    ) external onlyAdmin inState(ElectionState.PENDING) {
        if (voterHashes.length == 0) revert NoVoterHashesRegistered();
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
        emit ElectionOpened(block.timestamp, currentElectionId);
    }

    /**
     * @notice Transition the election from OPEN to FINISHED.
     */
    function closeElection() external onlyAdmin inState(ElectionState.OPEN) {
        state = ElectionState.FINISHED;
        emit ElectionClosed(block.timestamp, totalVotes);
    }

    // ─────────────────────────── Voting function ────────────────────────────

    /**
     * @notice Cast a vote with a PLONK ZK-SNARK proof.
     *
     * @param _proof      PLONK proof bytes (output of snarkjs plonk prove)
     * @param _pubSignals [merkle_root, nullifier_hash, candidate_id, election_id]
     *
     * candidateId semantics:
     *   0    → blank vote (voto branco)
     *   999  → null / invalid vote (voto nulo)
     *   1..N → valid sequential candidate ID
     */
    function castVote(
        bytes calldata _proof,
        uint256[4] calldata _pubSignals
    ) external inState(ElectionState.OPEN) {
        uint256 merkleRoot  = _pubSignals[0];
        uint256 nullifier   = _pubSignals[1];
        uint256 candidateId = _pubSignals[2];
        uint256 electionId  = _pubSignals[3];

        // 1. Validate Merkle root
        if (merkleRoot != voterMerkleRoot)
            revert InvalidMerkleRoot(merkleRoot, voterMerkleRoot);

        // 2. Validate election ID
        if (electionId != currentElectionId)
            revert InvalidElectionId(electionId, currentElectionId);

        // 3. Prevent double voting
        if (usedNullifiers[nullifier])
            revert NullifierAlreadyUsed(nullifier);
        usedNullifiers[nullifier] = true;

        // 4. Verify the PLONK ZK proof
        uint256[] memory pubSignalsArr = new uint256[](4);
        pubSignalsArr[0] = merkleRoot;
        pubSignalsArr[1] = nullifier;
        pubSignalsArr[2] = candidateId;
        pubSignalsArr[3] = electionId;
        if (!verifier.verifyProof(_proof, pubSignalsArr)) revert InvalidProof();

        // 5. Register the vote
        if (candidateId == BLANK_VOTE_ID) {
            blankVotes++;
        } else if (candidateId == NULL_VOTE_ID || candidateId == type(uint256).max) {
            nullVotes++;
        } else {
            if (candidateId > candidates.length)
                revert CandidateNotFound(candidateId);
            candidates[candidateId - 1].voteCount++;
        }

        totalVotes++;
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
        _totalVotes = totalVotes;
    }

    /**
     * @notice Return the registered voter hashes for public auditability.
     */
    function getVoterHashes() external view returns (uint256[] memory) {
        return voterHashes;
    }

    /**
     * @notice Return all candidates.
     */
    function getCandidates() external view returns (Candidate[] memory) {
        return candidates;
    }

    /**
     * @notice Return the number of registered candidates.
     */
    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }

    /**
     * @notice Return zerésima data — confirms zero votes before opening the election.
     * @return _electionName    Name of the election.
     * @return candidateCount   Number of registered candidates.
     * @return voterCount       Number of registered voter hashes.
     * @return totalVotesBefore Total votes cast so far (should be 0 before opening).
     * @return allCandidatesZero True if no candidate has received any votes yet.
     */
    function getZeresima()
        external
        view
        returns (
            string memory _electionName,
            uint256 candidateCount,
            uint256 voterCount,
            uint256 totalVotesBefore,
            bool allCandidatesZero
        )
    {
        _electionName = electionName;
        candidateCount = candidates.length;
        voterCount = voterHashes.length;
        totalVotesBefore = totalVotes;

        allCandidatesZero = true;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i].voteCount > 0) {
                allCandidatesZero = false;
                break;
            }
        }
    }
}
