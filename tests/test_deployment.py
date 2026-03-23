"""
test_deployment.py — verify the contract deploys with the correct initial state.
"""

import pytest
from conftest import load_abi


class TestDeployment:
    def test_admin_is_deployer(self, voting_contract, admin):
        """The deploying account is stored as admin."""
        assert voting_contract.functions.admin().call() == admin

    def test_initial_state_is_pending(self, voting_contract):
        """Contract starts in PENDING state (enum value 0)."""
        assert voting_contract.functions.state().call() == 0  # ElectionState.PENDING

    def test_verifier_address_matches(self, voting_contract, mock_verifier):
        """VotingContract is wired to the MockVerifier deployed alongside it."""
        assert (
            voting_contract.functions.verifier().call()
            == mock_verifier.address
        )

    def test_initial_total_votes_zero(self, voting_contract):
        assert voting_contract.functions.totalVotes().call() == 0

    def test_initial_blank_votes_zero(self, voting_contract):
        assert voting_contract.functions.blankVotes().call() == 0

    def test_initial_null_votes_zero(self, voting_contract):
        assert voting_contract.functions.nullVotes().call() == 0

    def test_blank_vote_constant(self, voting_contract):
        """BLANK_VOTE constant must be 0."""
        assert voting_contract.functions.BLANK_VOTE().call() == 0

    def test_null_vote_constant(self, voting_contract):
        """NULL_VOTE constant must be 999."""
        assert voting_contract.functions.NULL_VOTE().call() == 999

    def test_max_voters_constant(self, voting_contract):
        """MAX_VOTERS constant must be 16 (depth-4 Merkle tree)."""
        assert voting_contract.functions.MAX_VOTERS().call() == 16
