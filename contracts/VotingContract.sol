// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Verifier.sol";

/**
 * @title VotingContract
 * @notice Electronic voting system with PLONK ZK-SNARK proof verification.
 *
 * Proof-of-concept for 15 voters and 2 candidates, single race (raceId = 0).
 * Everything is stored on-chain — no database is used.
 *
 * Design notes:
 *   • Storage uses a 2-D nullifier mapping `nullifiers[raceId][nullifier]` for
 *     forward compatibility with a future multi-race extension. In this PoC the
 *     only valid raceId is 0 — both `castVote` and `isNullifierUsed` enforce that.
 *   • `castVote` follows the Checks-Effects-Interactions pattern in the strict
 *     order mandated by the project security invariants:
 *         CHECKS (state, params, nullifier, ZK proof)
 *           → EFFECTS (write nullifier, update tallies)
 *             → INTERACTIONS (emit VoteCast)
 *     The OpenZeppelin `ReentrancyGuard` provides defence-in-depth against any
 *     misbehaving verifier implementation.
 *
 * Public-signal layout expected from voter_proof.circom
 * (canonical definition in IVerifier — see Verifier.sol):
 *   pubSignals[0] — merkle_root    (voter Merkle tree root)
 *   pubSignals[1] — nullifier_hash (Poseidon(voter_id, election_id, race_id))
 *   pubSignals[2] — candidate_id   (0 = blank, 999 = null, 1..N = sequential ID)
 *   pubSignals[3] — election_id    (unique election identifier)
 *   pubSignals[4] — race_id        (cargo identifier — PUBLIC signal, prevents cross-race
 *                                   proof reuse by a malicious relayer)
 */
contract VotingContract is ReentrancyGuard {
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

    /// @notice nullifiers[raceId][nullifier] = used. PoC always uses raceId = 0.
    mapping(uint256 => mapping(uint256 => bool)) public nullifiers;

    /// @dev Tracks which ballot numbers have been assigned to prevent duplicates.
    mapping(uint256 => bool) private candidateNumberUsed;

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

    // ───────────────────────────── Constants ────────────────────────────────

    /// @notice Candidate ID representing a blank vote (voto branco)
    uint256 public constant BLANK_VOTE = 0;
    /// @notice Candidate ID representing a null/invalid vote (voto nulo)
    uint256 public constant NULL_VOTE  = 999;
    /// @notice Maximum number of registered voters (Merkle depth 4 → 2^4 = 16 leaves)
    uint256 public constant MAX_VOTERS = 16;
    /// @notice Canonical raceId for this single-race PoC. Multi-race is a future iteration.
    uint256 public constant POC_RACE_ID = 0;

    // ──────────────────────────────── Events ────────────────────────────────

    event ElectionCreated(string name, uint256 electionId);
    event CandidateAdded(uint256 indexed id, string name, uint256 number);
    event VoterHashesRegistered(uint256[] hashes);
    event MerkleRootSet(uint256 root);
    event ElectionOpened(uint256 timestamp, uint256 electionId);
    event VoteCast(
        uint256 indexed nullifier,
        uint256 indexed raceId,
        uint256 indexed candidateId
    );
    event ElectionClosed(uint256 timestamp, uint256 totalVotes);

    // ──────────────────────────────── Errors ────────────────────────────────

    error NotAdmin();
    error ElectionAlreadyExists();
    error ElectionNotPending();
    error ElectionNotOpen();
    error ElectionNotFinished();
    error NoVoterHashesRegistered();
    error TooManyVoters(uint256 provided, uint256 maximum);
    error InvalidMerkleRoot(uint256 provided, uint256 expected);
    error InvalidElectionId(uint256 provided, uint256 expected);
    error InvalidRaceId(uint256 provided);
    error RaceIdMismatch(uint256 paramRaceId, uint256 signalRaceId);
    error InvalidProof();
    error NullifierAlreadyUsed(uint256 nullifier);
    error CandidateNotFound(uint256 candidateId);
    error VoterHashesAlreadyRegistered();
    error InvalidVoterHash(uint256 index);
    error CandidateNumberAlreadyUsed(uint256 number);

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
     * @notice Deploy the voting contract.
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
     * @param _name        Human-readable election name.
     * @param _description Short description of the election.
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
     * @param _name   Candidate full name.
     * @param _party  Party name or abbreviation.
     * @param _number Official ballot number.
     */
    function addCandidate(
        string calldata _name,
        string calldata _party,
        uint256 _number
    ) external onlyAdmin inState(ElectionState.PENDING) {
        if (candidateNumberUsed[_number]) revert CandidateNumberAlreadyUsed(_number);
        candidateNumberUsed[_number] = true;
        uint256 id = candidates.length + 1; // IDs start at 1
        candidates.push(Candidate(id, _name, _party, _number, 0));
        emit CandidateAdded(id, _name, _number);
    }

    /**
     * @notice Register the voter identity hashes for public auditability.
     * @dev Idempotency: reverts if hashes are already registered to prevent
     *      accidental overwrite. Maximum MAX_VOTERS (16) entries. All hashes
     *      must be non-zero (zero would mean an empty/unconstrained leaf).
     * @param _hashes Array of Poseidon(voter_id) hashes — one per registered voter.
     */
    function registerVoterHashes(
        uint256[] calldata _hashes
    ) external onlyAdmin inState(ElectionState.PENDING) {
        if (_hashes.length > MAX_VOTERS)
            revert TooManyVoters(_hashes.length, MAX_VOTERS);
        if (voterHashes.length != 0) revert VoterHashesAlreadyRegistered();
        uint256 n = _hashes.length;
        for (uint256 i = 0; i < n; i++) {
            if (_hashes[i] == 0) revert InvalidVoterHash(i);
            voterHashes.push(_hashes[i]);
        }
        emit VoterHashesRegistered(_hashes);
    }

    /**
     * @notice Set the Merkle root of the voter set used inside the ZK circuit.
     * @dev Voter hashes must be registered before setting the root.
     * @param _root Poseidon Merkle root of the depth-4 binary tree of voter hashes.
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
     * @dev Strict Checks-Effects-Interactions ordering as mandated by the
     *      project security invariants:
     *
     *        CHECKS:
     *          1. Election is OPEN (modifier).
     *          2. raceId == POC_RACE_ID (single-race PoC).
     *          3. pubSignals[0] (merkle_root) matches on-chain voterMerkleRoot.
     *          4. pubSignals[3] (election_id) matches currentElectionId.
     *          5. pubSignals[4] (race_id)    matches the raceId function param.
     *          6. nullifier has not been used for this race.
     *          7. ZK proof verifies.
     *
     *        EFFECTS (state writes happen AFTER proof verification, so a
     *        malicious or buggy verifier cannot leave inconsistent state):
     *          8. nullifiers[raceId][nullifier] = true.
     *          9. tally counters incremented.
     *
     *        INTERACTIONS:
     *         10. VoteCast event emitted.
     *
     *      `nonReentrant` provides defence-in-depth in case the verifier
     *      address is ever swapped for a non-trusted implementation.
     *
     * @param raceId      Race identifier — must equal POC_RACE_ID (0) in this PoC.
     * @param pubSignals  [merkle_root, nullifier_hash, candidate_id, election_id, race_id]
     * @param proof       PLONK proof bytes (output of snarkjs plonk prove).
     */
    function castVote(
        uint256 raceId,
        uint256[5] calldata pubSignals,
        bytes calldata proof
    ) external nonReentrant inState(ElectionState.OPEN) {
        // ── CHECKS ────────────────────────────────────────────────────────
        if (raceId != POC_RACE_ID) revert InvalidRaceId(raceId);

        uint256 merkleRoot  = pubSignals[0];
        uint256 nullifier   = pubSignals[1];
        uint256 candidateId = pubSignals[2];
        uint256 electionId  = pubSignals[3];
        uint256 sigRaceId   = pubSignals[4];

        if (merkleRoot != voterMerkleRoot)
            revert InvalidMerkleRoot(merkleRoot, voterMerkleRoot);
        if (electionId != currentElectionId)
            revert InvalidElectionId(electionId, currentElectionId);
        if (sigRaceId != raceId)
            revert RaceIdMismatch(raceId, sigRaceId);
        if (nullifiers[raceId][nullifier])
            revert NullifierAlreadyUsed(nullifier);

        // SnarkJS PLONK verifier expects a dynamic uint256[] — convert from
        // the calldata fixed array. Mandatory at the verifier ABI boundary.
        uint256[] memory pubSignalsArr = new uint256[](5);
        pubSignalsArr[0] = merkleRoot;
        pubSignalsArr[1] = nullifier;
        pubSignalsArr[2] = candidateId;
        pubSignalsArr[3] = electionId;
        pubSignalsArr[4] = sigRaceId;
        if (!verifier.verifyProof(proof, pubSignalsArr)) revert InvalidProof();

        // ── EFFECTS ───────────────────────────────────────────────────────
        // 🔒 Nullifier MUST be written before any event emission.
        nullifiers[raceId][nullifier] = true;
        totalVotes++;

        if (candidateId == BLANK_VOTE) {
            blankVotes++;
        } else if (candidateId == NULL_VOTE) {
            nullVotes++;
        } else {
            if (candidateId == 0 || candidateId > candidates.length)
                revert CandidateNotFound(candidateId);
            candidates[candidateId - 1].voteCount++;
        }

        // ── INTERACTIONS ──────────────────────────────────────────────────
        emit VoteCast(nullifier, raceId, candidateId);
    }

    // ──────────────────────────── View functions ─────────────────────────────

    /**
     * @notice Return the pre-election zerésima — confirms zero votes before opening.
     * @dev Restricted to PENDING state. blockTimestamp and blockNumber provide a
     *      tamper-evidence timestamp of the zero-audit.
     * @return _electionName   Name of the election.
     * @return _candidates     All registered candidates (voteCount should be 0).
     * @return voterCount      Number of registered voter hashes.
     * @return allZero         True iff no candidate has any votes yet.
     * @return _blockTimestamp Block timestamp at time of the zerésima call.
     * @return _blockNumber    Block number at time of the zerésima call.
     */
    function getZeresima()
        external
        view
        inState(ElectionState.PENDING)
        returns (
            string memory _electionName,
            Candidate[] memory _candidates,
            uint256 voterCount,
            bool allZero,
            uint256 _blockTimestamp,
            uint256 _blockNumber
        )
    {
        _electionName   = electionName;
        _candidates     = candidates;
        voterCount      = voterHashes.length;
        _blockTimestamp = block.timestamp;
        _blockNumber    = block.number;

        allZero = true;
        uint256 n = candidates.length;
        for (uint256 i = 0; i < n; i++) {
            if (candidates[i].voteCount > 0) {
                allZero = false;
                break;
            }
        }
    }

    /**
     * @notice Return the current election results (single-race PoC accessor).
     * @return _candidates  Array of Candidate structs with updated vote counts.
     * @return _blankVotes  Number of blank votes.
     * @return _nullVotes   Number of null/invalid votes.
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
        _nullVotes  = nullVotes;
        _totalVotes = totalVotes;
    }

    /**
     * @notice Return election results for a specific race.
     * @dev Multi-race-ready API. PoC accepts only raceId = 0.
     * @param raceId Race identifier (must be 0 in this PoC).
     */
    function getRaceResults(uint256 raceId)
        external
        view
        returns (
            Candidate[] memory _candidates,
            uint256 _blankVotes,
            uint256 _nullVotes,
            uint256 _totalVotes
        )
    {
        if (raceId != POC_RACE_ID) revert InvalidRaceId(raceId);
        _candidates = candidates;
        _blankVotes = blankVotes;
        _nullVotes  = nullVotes;
        _totalVotes = totalVotes;
    }

    /**
     * @notice Return the registered voter hashes for public auditability.
     */
    function getVoterHashes() external view returns (uint256[] memory) {
        return voterHashes;
    }

    /**
     * @notice Return all candidates (single-race PoC accessor).
     */
    function getCandidates() external view returns (Candidate[] memory) {
        return candidates;
    }

    /**
     * @notice Return all candidates for a specific race.
     * @dev Multi-race-ready API. PoC accepts only raceId = 0.
     */
    function getCandidatesByRace(uint256 raceId)
        external
        view
        returns (Candidate[] memory)
    {
        if (raceId != POC_RACE_ID) revert InvalidRaceId(raceId);
        return candidates;
    }

    /**
     * @notice Return the number of registered candidates.
     */
    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }

    /**
     * @notice Check whether a nullifier has already been used for a given race.
     * @dev PoC accepts only raceId = 0. The nullifier itself is bound to the
     *      race via the circuit formula Poseidon(voter_id, election_id, race_id),
     *      so a vote for race A cannot replay as a vote for race B.
     * @param raceId    Race identifier (must be 0 in this PoC).
     * @param nullifier Poseidon(voter_id, election_id, race_id) commitment.
     * @return True if the nullifier has already been spent for this race.
     */
    function isNullifierUsed(uint256 raceId, uint256 nullifier)
        external
        view
        returns (bool)
    {
        if (raceId != POC_RACE_ID) revert InvalidRaceId(raceId);
        return nullifiers[raceId][nullifier];
    }
}
