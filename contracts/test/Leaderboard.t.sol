// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonadSurf} from "../src/MonadSurf.sol";
import {Vm} from "./MonadSurf.t.sol";

interface LeaderboardVm is Vm {
    function record() external;
    function accesses(address target) external returns (bytes32[] memory reads, bytes32[] memory writes);
}

contract LeaderboardTest {
    LeaderboardVm private constant vm = LeaderboardVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RELAYER = address(0xA11CE);

    MonadSurf private game;
    uint256 private nextRunId;

    function setUp() public {
        game = new MonadSurf(RELAYER);
    }

    function testEmptyLeaderboard() public view {
        require(game.getLeaderboard().length == 0, "not empty");
    }

    function testPartialLeaderboardIsSortedWithoutEmptyEntries() public {
        _submit(1, 100);
        _submit(2, 300);
        _submit(3, 200);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 3, "length");
        _assertEntry(entries[0], 2, 300);
        _assertEntry(entries[1], 3, 200);
        _assertEntry(entries[2], 1, 100);
    }

    function testZeroScoreDoesNotEnterLeaderboardButCreditsRun() public {
        _assertNoLeaderboardWrites(1, 0);
        require(game.getLeaderboard().length == 0, "zero ranked");
        MonadSurf.Player memory player = game.getPlayer(bytes32(uint256(1)));
        require(player.bestScore == 0 && player.coins == 1 && player.runs == 1, "zero stats");
        require(game.processedRuns(bytes32(nextRunId)), "zero run not consumed");
        _submit(1, 1);
        _assertEntry(game.getLeaderboard()[0], 1, 1);
    }

    function testFullLeaderboardAndTwentySixthEntryEvictsLast() public {
        _fillLeaderboard();
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 25, "full length");
        for (uint256 i; i < 25; ++i) {
            _assertEntry(entries[i], 25 - i, uint64((25 - i) * 10));
        }

        _submit(26, 260);
        entries = game.getLeaderboard();
        require(entries.length == 25, "capacity exceeded");
        for (uint256 i; i < 25; ++i) {
            _assertEntry(entries[i], 26 - i, uint64((26 - i) * 10));
        }
        require(game.getPlayer(bytes32(uint256(1))).bestScore == 10, "evicted stats lost");
    }

    function testUnqualifiedPersonalBestDoesNotWriteLeaderboard() public {
        _fillLeaderboard();
        _assertNoLeaderboardWrites(26, 1);
        _assertNoLeaderboardWrites(26, 2);
        MonadSurf.Player memory player = game.getPlayer(bytes32(uint256(26)));
        require(player.bestScore == 2 && player.coins == 2 && player.runs == 2, "unranked stats");
    }

    function testImprovementReordersWithoutDuplicateOrEviction() public {
        _fillLeaderboard();
        _submit(1, 300);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 25, "improvement length");
        _assertEntry(entries[0], 1, 300);
        for (uint256 i = 1; i < 25; ++i) {
            _assertEntry(entries[i], 26 - i, uint64((26 - i) * 10));
        }
        MonadSurf.Player memory player = game.getPlayer(bytes32(uint256(1)));
        require(player.bestScore == 300 && player.coins == 2 && player.runs == 2, "improved stats");
    }

    function testImprovementWithoutRankChangeUpdatesScoreOnly() public {
        _submit(1, 100);
        _submit(2, 50);
        _submit(1, 101);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 2, "duplicate leader");
        _assertEntry(entries[0], 1, 101);
        _assertEntry(entries[1], 2, 50);
    }

    function testLowerAndEqualScoresDoNotWriteLeaderboard() public {
        _submit(1, 100);
        _submit(2, 50);
        _assertNoLeaderboardWrites(1, 99);
        _assertNoLeaderboardWrites(1, 100);
        MonadSurf.Player memory player = game.getPlayer(bytes32(uint256(1)));
        require(player.bestScore == 100 && player.coins == 3 && player.runs == 3, "repeated stats");
    }

    function testTiesUseAscendingPlayerIdRegardlessOfArrivalOrder() public {
        for (uint256 i = 26; i > 0; --i) {
            _submit(i, 100);
        }
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 25, "tie capacity");
        for (uint256 i; i < 25; ++i) {
            _assertEntry(entries[i], i + 1, 100);
        }
        _assertNoLeaderboardWrites(27, 100);
    }

    function testImprovementToTiedScoreUsesPlayerIdOrder() public {
        _submit(3, 100);
        _submit(1, 50);
        _submit(2, 100);
        _submit(1, 100);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 3, "duplicate tie");
        for (uint256 i; i < 3; ++i) {
            _assertEntry(entries[i], i + 1, 100);
        }
    }

    function testEvictedPlayerCanReturnWithImprovement() public {
        _fillLeaderboard();
        _submit(26, 260);
        _assertNoLeaderboardWrites(1, 10);
        _submit(1, 300);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        require(entries.length == 25, "reentry capacity");
        _assertEntry(entries[0], 1, 300);
        for (uint256 i = 1; i < 25; ++i) {
            _assertEntry(entries[i], 27 - i, uint64((27 - i) * 10));
        }
        require(game.getPlayer(bytes32(uint256(2))).bestScore == 20, "second eviction stats lost");
    }

    function testRejectedSubmissionsLeaveLeaderboardUnchanged() public {
        _fillLeaderboard();
        bytes32 beforeHash = keccak256(abi.encode(game.getLeaderboard()));
        bytes32 playerId = bytes32(uint256(1));

        vm.expectRevert(MonadSurf.NotRelayer.selector);
        game.submitRun(bytes32(uint256(100)), playerId, 999, 99);
        require(!game.processedRuns(bytes32(uint256(100))), "unauthorized run consumed");
        require(keccak256(abi.encode(game.getLeaderboard())) == beforeHash, "unauthorized change");

        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, bytes32(uint256(1))));
        vm.prank(RELAYER);
        game.submitRun(bytes32(uint256(1)), playerId, 999, 99);
        require(keccak256(abi.encode(game.getLeaderboard())) == beforeHash, "duplicate change");

        vm.expectRevert(MonadSurf.InvalidRunId.selector);
        vm.prank(RELAYER);
        game.submitRun(bytes32(0), playerId, 999, 99);
        require(keccak256(abi.encode(game.getLeaderboard())) == beforeHash, "zero run change");

        vm.expectRevert(MonadSurf.InvalidPlayerId.selector);
        vm.prank(RELAYER);
        game.submitRun(bytes32(uint256(100)), bytes32(0), 999, 99);
        require(keccak256(abi.encode(game.getLeaderboard())) == beforeHash, "zero player change");
        require(!game.processedRuns(bytes32(uint256(100))), "invalid run consumed");
        MonadSurf.Player memory player = game.getPlayer(playerId);
        require(player.bestScore == 10 && player.coins == 1 && player.runs == 1, "rejected stats");
    }

    function testFullUint64ScoresAndBytes32IdsArePreserved() public {
        _submit(type(uint256).max, type(uint64).max);
        _submit(1, type(uint64).max);
        _submit(2, type(uint64).max - 1);
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        _assertEntry(entries[0], 1, type(uint64).max);
        _assertEntry(entries[1], type(uint256).max, type(uint64).max);
        _assertEntry(entries[2], 2, type(uint64).max - 1);
    }

    function testFuzzLeaderboardMatchesAllPlayerBests(uint64[64] memory scores, uint8[32] memory players) public {
        uint64[32] memory bestScores;
        for (uint256 i; i < 64; ++i) {
            uint256 player = i < 32 ? i : uint256(players[i - 32]) % 32;
            _submit(player + 1, scores[i]);
            if (scores[i] > bestScores[player]) bestScores[player] = scores[i];
            _assertMatchesReference(bestScores);
        }
    }

    function _assertMatchesReference(uint64[32] memory bestScores) private view {
        MonadSurf.LeaderboardEntry[] memory entries = game.getLeaderboard();
        uint256 count;
        for (uint256 i; i < 32; ++i) {
            if (bestScores[i] == 0) continue;
            ++count;
            uint256 rank;
            for (uint256 j; j < 32; ++j) {
                if (bestScores[j] > bestScores[i] || (bestScores[j] == bestScores[i] && j < i)) ++rank;
            }
            if (rank < 25) {
                require(rank < entries.length, "missing ranked player");
                _assertEntry(entries[rank], i + 1, bestScores[i]);
                require(game.getPlayer(entries[rank].playerId).bestScore == entries[rank].score, "best mismatch");
            }
        }
        require(entries.length == (count > 25 ? 25 : count), "reference capacity");
    }

    function _assertNoLeaderboardWrites(uint256 playerId, uint64 score) private {
        vm.record();
        bytes32 beforeHash = keccak256(abi.encode(game.getLeaderboard()));
        (bytes32[] memory leaderboardSlots,) = vm.accesses(address(game));
        require(leaderboardSlots.length > 0, "no recorded leaderboard slots");

        vm.record();
        _submit(playerId, score);
        (, bytes32[] memory writes) = vm.accesses(address(game));
        for (uint256 i; i < writes.length; ++i) {
            for (uint256 j; j < leaderboardSlots.length; ++j) {
                require(writes[i] != leaderboardSlots[j], "unnecessary leaderboard write");
            }
        }
        require(keccak256(abi.encode(game.getLeaderboard())) == beforeHash, "leaderboard changed");
    }

    function _fillLeaderboard() private {
        for (uint256 i = 1; i <= 25; ++i) {
            _submit(i, uint64(i * 10));
        }
    }

    function _submit(uint256 playerId, uint64 score) private {
        ++nextRunId;
        vm.prank(RELAYER);
        game.submitRun(bytes32(nextRunId), bytes32(playerId), score, 1);
    }

    function _assertEntry(MonadSurf.LeaderboardEntry memory entry, uint256 playerId, uint64 score) private pure {
        require(entry.playerId == bytes32(playerId), "ranked player");
        require(entry.score == score, "ranked score");
    }
}
