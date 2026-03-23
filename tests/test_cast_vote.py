"""
test_cast_vote.py — castVote() behaviour and public-signal ordering.

Key test:
  test_pubsignals_order_via_getlastpubsignal — after casting a vote, reads
  MockVerifier.getLastPubSignal(i) for i in 0..4 and checks the exact order
  expected by voter_proof.circom and IVerifier.sol.
"""

import pytest
from conftest import (
    ELECTION_ID,
    EMPTY_PROOF,
    MERKLE_ROOT,
    RACE_ID,
    make_nullifier,
    make_pub_signals,
)


class TestCastVote:
    # ── Happy-path votes ──────────────────────────────────────────────────

    def test_valid_candidate_vote_increments_count(
        self, w3, admin, election_ready
    ):
        """Voting for candidate 1 increments its voteCount by 1."""
        nullifier = make_nullifier(0)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})

        candidate = election_ready.functions.candidates(0).call()
        assert candidate[4] == 1  # Candidate.voteCount

    def test_valid_vote_increments_total_votes(self, w3, admin, election_ready):
        nullifier = make_nullifier(0)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})
        assert election_ready.functions.totalVotes().call() == 1

    def test_vote_emits_vote_cast_event(self, w3, admin, election_ready):
        nullifier = make_nullifier(0)
        tx_hash = election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = election_ready.events.VoteCast().process_receipt(receipt)
        assert len(logs) == 1
        assert logs[0]["args"]["nullifier"] == nullifier
        assert logs[0]["args"]["candidateId"] == 1

    def test_blank_vote_increments_blank_votes(self, w3, admin, election_ready):
        """candidateId == 0 (BLANK_VOTE) increments blankVotes."""
        nullifier = make_nullifier(0)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=0)
        ).transact({"from": admin})
        assert election_ready.functions.blankVotes().call() == 1
        assert election_ready.functions.totalVotes().call() == 1

    def test_null_vote_increments_null_votes(self, w3, admin, election_ready):
        """candidateId == 999 (NULL_VOTE) increments nullVotes."""
        nullifier = make_nullifier(0)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=999)
        ).transact({"from": admin})
        assert election_ready.functions.nullVotes().call() == 1
        assert election_ready.functions.totalVotes().call() == 1

    # ── pubSignals ordering (critical) ────────────────────────────────────

    def test_pubsignals_order_via_getlastpubsignal(
        self, w3, admin, election_ready, mock_verifier
    ):
        """
        Verify that castVote() forwards pubSignals to MockVerifier in the
        exact canonical order defined by voter_proof.circom / IVerifier.sol:

          [0] merkle_root
          [1] nullifier_hash
          [2] candidate_id
          [3] election_id
          [4] race_id   ← 5th public signal, prevents cross-race relayer attack
        """
        nullifier = make_nullifier(3)
        candidate_id = 1

        election_ready.functions.castVote(
            EMPTY_PROOF,
            make_pub_signals(nullifier, candidate_id),
        ).transact({"from": admin})

        assert mock_verifier.functions.getLastPubSignal(0).call() == MERKLE_ROOT
        assert mock_verifier.functions.getLastPubSignal(1).call() == nullifier
        assert mock_verifier.functions.getLastPubSignal(2).call() == candidate_id
        assert mock_verifier.functions.getLastPubSignal(3).call() == ELECTION_ID
        assert mock_verifier.functions.getLastPubSignal(4).call() == RACE_ID

    def test_pubsignals_length_is_5(self, w3, admin, election_ready, mock_verifier):
        """MockVerifier must receive exactly 5 elements in pubSignals."""
        nullifier = make_nullifier(5)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})
        # getLastPubSignal(4) would revert if length < 5
        race_id_stored = mock_verifier.functions.getLastPubSignal(4).call()
        assert race_id_stored == RACE_ID

    # ── Double-voting prevention ───────────────────────────────────────────

    def test_double_vote_reverts_nullifier_already_used(
        self, w3, admin, election_ready
    ):
        """Using the same nullifier twice must revert (NullifierAlreadyUsed)."""
        nullifier = make_nullifier(0)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})

        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
            ).transact({"from": admin})

    def test_different_nullifiers_allow_two_votes(self, w3, admin, election_ready):
        """Two different nullifiers (different voters) must both succeed."""
        for i in range(2):
            election_ready.functions.castVote(
                EMPTY_PROOF, make_pub_signals(make_nullifier(i), candidate_id=1)
            ).transact({"from": admin})
        assert election_ready.functions.totalVotes().call() == 2

    # ── Validation failures ────────────────────────────────────────────────

    def test_wrong_merkle_root_reverts(self, w3, admin, election_ready):
        """Wrong Merkle root must revert (InvalidMerkleRoot)."""
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF,
                make_pub_signals(nullifier, candidate_id=1, merkle_root=0xDEAD),
            ).transact({"from": admin})

    def test_wrong_election_id_reverts(self, w3, admin, election_ready):
        """Wrong election ID must revert (InvalidElectionId)."""
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF,
                make_pub_signals(nullifier, candidate_id=1, election_id=99),
            ).transact({"from": admin})

    def test_race_id_zero_reverts(self, w3, admin, election_ready):
        """race_id == 0 must revert (InvalidRaceId)."""
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF,
                make_pub_signals(nullifier, candidate_id=1, race_id=0),
            ).transact({"from": admin})

    def test_invalid_candidate_id_reverts(self, w3, admin, election_ready):
        """candidateId beyond the count of registered candidates must revert."""
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF,
                make_pub_signals(nullifier, candidate_id=999_999),
            ).transact({"from": admin})

    # ── State-gating ──────────────────────────────────────────────────────

    def test_vote_in_pending_state_reverts(
        self, w3, admin, pending_setup
    ):
        """castVote must revert when election is not OPEN."""
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            pending_setup.functions.castVote(
                EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
            ).transact({"from": admin})

    def test_vote_in_finished_state_reverts(self, w3, admin, election_ready):
        """castVote must revert after election is closed (FINISHED)."""
        election_ready.functions.closeElection().transact({"from": admin})
        nullifier = make_nullifier(0)
        with pytest.raises(Exception):
            election_ready.functions.castVote(
                EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
            ).transact({"from": admin})

    def test_nullifier_is_marked_before_verify_call(
        self, w3, admin, election_ready
    ):
        """
        CEI pattern smoke test: after a successful castVote() the nullifier
        must be stored as used — regardless of when verifyProof() is called.
        """
        nullifier = make_nullifier(7)
        election_ready.functions.castVote(
            EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
        ).transact({"from": admin})
        assert election_ready.functions.usedNullifiers(nullifier).call() is True
