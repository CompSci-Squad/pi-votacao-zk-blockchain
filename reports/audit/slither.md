**THIS CHECKLIST IS NOT COMPLETE**. Use `--show-ignored-findings` to show all the results.
Summary
 - [reentrancy-no-eth](#reentrancy-no-eth) (1 results) (Medium)
 - [reentrancy-benign](#reentrancy-benign) (1 results) (Low)
 - [pragma](#pragma) (1 results) (Informational)
 - [cyclomatic-complexity](#cyclomatic-complexity) (1 results) (Informational)
 - [solc-version](#solc-version) (1 results) (Informational)
 - [naming-convention](#naming-convention) (12 results) (Informational)
 - [immutable-states](#immutable-states) (2 results) (Optimization)
## reentrancy-no-eth
Impact: Medium
Confidence: Medium
 - [ ] ID-0
Reentrancy in [VotingContract.castVote(uint256,uint256[5],uint256[24])](src/VotingContract.sol#L367-L425):
	External calls:
	- [! verifier.verifyProof(proof,pubSignals)](src/VotingContract.sol#L392)
	State variables written after the call(s):
	- [nullifiers[raceId][nullifier] = true](src/VotingContract.sol#L396)
	[VotingContract.nullifiers](src/VotingContract.sol#L56) can be used in cross function reentrancies:
	- [VotingContract.isNullifierUsed(uint256,uint256)](src/VotingContract.sol#L574-L581)
	- [VotingContract.nullifiers](src/VotingContract.sol#L56)

src/VotingContract.sol#L367-L425


## reentrancy-benign
Impact: Low
Confidence: Medium
 - [ ] ID-1
Reentrancy in [VotingContract.castVote(uint256,uint256[5],uint256[24])](src/VotingContract.sol#L367-L425):
	External calls:
	- [! verifier.verifyProof(proof,pubSignals)](src/VotingContract.sol#L392)
	State variables written after the call(s):
	- [blankVotes ++](src/VotingContract.sol#L401)
	- [candidates[candidateId - 1].voteCount ++](src/VotingContract.sol#L407)
	- [r.totalVotes ++](src/VotingContract.sol#L411)
	- [r.blankVotes ++](src/VotingContract.sol#L413)
	- [r.nullVotes ++](src/VotingContract.sol#L415)
	- [r.candidates[candidateId - 1].voteCount ++](src/VotingContract.sol#L419)
	- [nullVotes ++](src/VotingContract.sol#L403)
	- [totalVotes ++](src/VotingContract.sol#L399)

src/VotingContract.sol#L367-L425


## pragma
Impact: Informational
Confidence: High
 - [ ] ID-2
2 different versions of Solidity are used:
	- Version constraint ^0.8.20 is used by:
		-[^0.8.20](lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol#L4)
	- Version constraint 0.8.24 is used by:
		-[0.8.24](src/IVerifier.sol#L2)
		-[0.8.24](src/VotingContract.sol#L2)

lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol#L4


## cyclomatic-complexity
Impact: Informational
Confidence: High
 - [ ] ID-3
[VotingContract.castVote(uint256,uint256[5],uint256[24])](src/VotingContract.sol#L367-L425) has a high cyclomatic complexity (14).

src/VotingContract.sol#L367-L425


## solc-version
Impact: Informational
Confidence: High
 - [ ] ID-4
Version constraint ^0.8.20 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- VerbatimInvalidDeduplication
	- FullInlinerNonExpressionSplitArgumentEvaluationOrder
	- MissingSideEffectsOnSelectorAccess.
It is used by:
	- [^0.8.20](lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol#L4)

lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol#L4


## naming-convention
Impact: Informational
Confidence: High
 - [ ] ID-5
Parameter [VotingContract.addCandidate(string,string,uint256)._number](src/VotingContract.sol#L205) is not in mixedCase

src/VotingContract.sol#L205


 - [ ] ID-6
Parameter [VotingContract.createElection(string,string)._description](src/VotingContract.sol#L186) is not in mixedCase

src/VotingContract.sol#L186


 - [ ] ID-7
Parameter [VotingContract.addCandidateToRace(uint256,string,string,uint256)._name](src/VotingContract.sol#L252) is not in mixedCase

src/VotingContract.sol#L252


 - [ ] ID-8
Parameter [VotingContract.createElection(string,string)._name](src/VotingContract.sol#L185) is not in mixedCase

src/VotingContract.sol#L185


 - [ ] ID-9
Parameter [VotingContract.setRace0Name(string)._name](src/VotingContract.sol#L219) is not in mixedCase

src/VotingContract.sol#L219


 - [ ] ID-10
Parameter [VotingContract.addRace(string)._name](src/VotingContract.sol#L234) is not in mixedCase

src/VotingContract.sol#L234


 - [ ] ID-11
Parameter [VotingContract.registerVoterHashes(uint256[])._hashes](src/VotingContract.sol#L287) is not in mixedCase

src/VotingContract.sol#L287


 - [ ] ID-12
Parameter [VotingContract.addCandidateToRace(uint256,string,string,uint256)._party](src/VotingContract.sol#L253) is not in mixedCase

src/VotingContract.sol#L253


 - [ ] ID-13
Parameter [VotingContract.addCandidateToRace(uint256,string,string,uint256)._number](src/VotingContract.sol#L254) is not in mixedCase

src/VotingContract.sol#L254


 - [ ] ID-14
Parameter [VotingContract.addCandidate(string,string,uint256)._party](src/VotingContract.sol#L204) is not in mixedCase

src/VotingContract.sol#L204


 - [ ] ID-15
Parameter [VotingContract.addCandidate(string,string,uint256)._name](src/VotingContract.sol#L203) is not in mixedCase

src/VotingContract.sol#L203


 - [ ] ID-16
Parameter [VotingContract.setMerkleRoot(uint256)._root](src/VotingContract.sol#L306) is not in mixedCase

src/VotingContract.sol#L306


## immutable-states
Impact: Optimization
Confidence: High
 - [ ] ID-17
[VotingContract.verifier](src/VotingContract.sol#L49) should be immutable 

src/VotingContract.sol#L49


 - [ ] ID-18
[VotingContract.admin](src/VotingContract.sol#L40) should be immutable 

src/VotingContract.sol#L40


