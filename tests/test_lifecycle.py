"""
test_lifecycle.py — full end-to-end election lifecycle.

Runs through the complete state machine:
  PENDING → (zerésima) → OPEN → (15 votes) → FINISHED → (verify results)

Uses all 15 registered voter hashes to simulate a realistic PoC election:
  - 12 votes for candidate 1 (Alice)
  -  2 votes for candidate 2 (Bruno)
  -  1 blank vote
  Total: 15 votes

The test also verifies:
  - Every nullifier is unique and accepted exactly once
  - Final tallies match the expected distribution
  - getResults() returns consistent data
"""

import pytest
from conftest import (
    ELECTION_ID,
    ELECTION_NAME,
    EMPTY_PROOF,
    MERKLE_ROOT,
    RACE_ID,
    VOTER_HASHES,
    make_nullifier,
    make_pub_signals,
)

# Vote distribution for the 15 voters:
#   voters 0–11  → candidate 1 (Alice)
#   voters 12–13 → candidate 2 (Bruno)
#   voter  14    → blank
_VOTE_PLAN = (
    [(i, 1) for i in range(12)]     # 12 votes for Alice
    + [(i, 2) for i in range(12, 14)]  # 2 votes for Bruno
    + [(14, 0)]                        # 1 blank vote
)

assert len(_VOTE_PLAN) == len(VOTER_HASHES) == 15


class TestFullLifecycle:
    @pytest.fixture(scope="function")
    def finished_election(self, w3, admin, election_ready):
        """
        Cast all 15 votes, then close the election.
        Returns the VotingContract in FINISHED state.
        """
        for voter_index, candidate_id in _VOTE_PLAN:
            nullifier = make_nullifier(voter_index)
            pub_signals = make_pub_signals(nullifier, candidate_id)
            election_ready.functions.castVote(
                EMPTY_PROOF, pub_signals
            ).transact({"from": admin})

        election_ready.functions.closeElection().transact({"from": admin})
        return election_ready

    # ── State transitions ────────────────────────────────────────────────

    def test_state_is_finished_after_close(self, finished_election):
        assert finished_election.functions.state().call() == 2  # FINISHED

    # ── Vote tallies ─────────────────────────────────────────────────────

    def test_total_votes_equals_15(self, finished_election):
        assert finished_election.functions.totalVotes().call() == 15

    def test_candidate_1_has_12_votes(self, finished_election):
        candidate = finished_election.functions.candidates(0).call()
        assert candidate[4] == 12  # Candidate.voteCount

    def test_candidate_2_has_2_votes(self, finished_election):
        candidate = finished_election.functions.candidates(1).call()
        assert candidate[4] == 2

    def test_blank_votes_equals_1(self, finished_election):
        assert finished_election.functions.blankVotes().call() == 1

    def test_null_votes_equals_0(self, finished_election):
        assert finished_election.functions.nullVotes().call() == 0

    # ── nullifier accounting ─────────────────────────────────────────────

    def test_all_15_nullifiers_marked_used(self, finished_election):
        for i in range(15):
            assert finished_election.functions.usedNullifiers(
                make_nullifier(i)
            ).call() is True

    def test_unused_voter_nullifier_not_marked(self, finished_election):
        """voter index 15 never voted — its nullifier must be unused."""
        assert finished_election.functions.usedNullifiers(
            make_nullifier(15)
        ).call() is False

    # ── getResults() consistency ─────────────────────────────────────────

    def test_get_results_returns_correct_totals(self, finished_election):
        candidates, blank, null, total = (
            finished_election.functions.getResults().call()
        )
        assert total == 15
        assert blank == 1
        assert null == 0
        assert candidates[0][4] == 12  # Alice
        assert candidates[1][4] == 2   # Bruno

    def test_get_race_results_matches_get_results(self, finished_election):
        """getRaceResults(1) must return the same data as getResults()."""
        results_default = finished_election.functions.getResults().call()
        results_race = finished_election.functions.getRaceResults(1).call()
        assert results_default == results_race

    # ── Guards after close ───────────────────────────────────────────────

    def test_cannot_vote_after_close(self, w3, admin, finished_election):
        """castVote must revert once the election is FINISHED."""
        nullifier = make_nullifier(99)
        with pytest.raises(Exception):
            finished_election.functions.castVote(
                EMPTY_PROOF, make_pub_signals(nullifier, candidate_id=1)
            ).transact({"from": admin})

    def test_zeresima_reverts_after_close(self, finished_election):
        with pytest.raises(Exception):
            finished_election.functions.getZeresima().call()

    # ── pre-election zerésima (before opening) ───────────────────────────

    def test_zeresima_all_zero_before_opening(self, admin, pending_setup):
        """
        Before openElection(), getZeresima() returns allZero == True
        for both candidates.
        """
        result = pending_setup.functions.getZeresima().call()
        assert result[3] is True          # allZero
        assert result[0] == ELECTION_NAME  # electionName
        candidates = result[1]
        for c in candidates:
            assert c[4] == 0              # voteCount
