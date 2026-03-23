"""
test_zeresima.py — getZeresima() pre-election zero-audit.

The "zerésima" is a mandatory public audit performed in Brazilian elections
before the polls open. It proves that all vote counters start at zero.

getZeresima() is restricted to PENDING state and returns:
  (electionName, Candidate[], voterCount, allZero, blockTimestamp, blockNumber)
"""

import pytest
from conftest import ELECTION_NAME, VOTER_HASHES


class TestZeresima:
    def test_zeresima_returns_election_name(self, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        assert result[0] == ELECTION_NAME

    def test_zeresima_returns_two_candidates(self, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        candidates = result[1]
        assert len(candidates) == 2

    def test_zeresima_candidates_have_zero_vote_count(self, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        candidates = result[1]
        for c in candidates:
            assert c[4] == 0  # Candidate.voteCount

    def test_zeresima_returns_correct_voter_count(self, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        voter_count = result[2]
        assert voter_count == len(VOTER_HASHES)

    def test_zeresima_all_zero_is_true_before_votes(self, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        all_zero = result[3]
        assert all_zero is True

    def test_zeresima_returns_block_timestamp(self, w3, admin, pending_setup):
        """blockTimestamp in the return value must match the current block."""
        result = pending_setup.functions.getZeresima().call()
        block_timestamp = result[4]
        # The call is made against the latest block — timestamp must be > 0
        assert block_timestamp > 0

    def test_zeresima_returns_block_number(self, w3, admin, pending_setup):
        result = pending_setup.functions.getZeresima().call()
        block_number = result[5]
        assert block_number > 0

    def test_zeresima_reverts_when_open(self, admin, election_ready):
        """getZeresima() must revert once the election is OPEN."""
        with pytest.raises(Exception):
            election_ready.functions.getZeresima().call()

    def test_zeresima_reverts_when_finished(self, admin, election_ready):
        """getZeresima() must revert after the election is FINISHED."""
        election_ready.functions.closeElection().transact({"from": admin})
        with pytest.raises(Exception):
            election_ready.functions.getZeresima().call()

    def test_zeresima_candidate_names_match(self, admin, pending_setup):
        """Candidates returned by getZeresima() have the expected names."""
        result = pending_setup.functions.getZeresima().call()
        names = [c[1] for c in result[1]]  # Candidate.name at index 1
        assert "Alice Oliveira" in names
        assert "Bruno Silva" in names
