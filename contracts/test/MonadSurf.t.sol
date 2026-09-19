// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonadSurf} from "../src/MonadSurf.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
    function warp(uint256 timestamp) external;
}

contract MonadSurfTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RELAYER = address(0xA11CE);
    bytes32 private constant PLAYER_A = bytes32(uint256(1));
    bytes32 private constant PLAYER_B = bytes32(uint256(2));
    bytes32 private constant RUN_A = bytes32(uint256(101));
    bytes32 private constant RUN_B = bytes32(uint256(102));
    MonadSurf private game;

    event RunSubmitted(
        bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins, uint32 tickCount, bytes inputs
    );

    function setUp() public {
        game = new MonadSurf(RELAYER);
    }

    function testRejectsZeroRelayer() public {
        vm.expectRevert(MonadSurf.InvalidRelayer.selector);
        new MonadSurf(address(0));
    }

    function testProfileAndSessionAreOnchain() public {
        _save(PLAYER_A, unicode"Noé");
        MonadSurf.Player memory player = game.getPlayer(PLAYER_A);
        require(keccak256(bytes(player.pseudo)) == keccak256(unicode"Noé"), "pseudo");
        require(player.sessionExpiresAt == block.timestamp + 30 days, "expiry");
        _save(PLAYER_A, "Updated");
        require(keccak256(bytes(game.getPlayer(PLAYER_A).pseudo)) == keccak256("Updated"), "rename");
    }

    function testRejectsEmptyAndOversizedPseudo() public {
        vm.expectRevert(MonadSurf.InvalidPseudo.selector);
        _save(PLAYER_A, "");
        vm.expectRevert(MonadSurf.InvalidPseudo.selector);
        _save(PLAYER_A, string(new bytes(81)));
    }

    function testRejectsZeroPlayer() public {
        vm.expectRevert(MonadSurf.InvalidPlayerId.selector);
        _save(bytes32(0), "Player");
    }

    function testRevokedSessionCannotRestartOrBeReactivated() public {
        _save(PLAYER_A, "Player");
        vm.prank(RELAYER);
        game.revokeSession(PLAYER_A);
        vm.expectRevert(MonadSurf.InactiveSession.selector);
        _start(RUN_A, PLAYER_A);
        vm.expectRevert(MonadSurf.InactiveSession.selector);
        _save(PLAYER_A, "Again");
    }

    function testExpiredSessionCannotStart() public {
        _save(PLAYER_A, "Player");
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(MonadSurf.InactiveSession.selector);
        _start(RUN_A, PLAYER_A);
    }

    function testRunKeepsSeedVersionTimeAndPseudo() public {
        _prepare(RUN_A, PLAYER_A);
        _save(PLAYER_A, "Changed");
        MonadSurf.Run memory run = game.getRun(RUN_A);
        require(run.playerId == PLAYER_A && run.createdAt == block.timestamp, "owner/time");
        require(run.seed == keccak256("seed") && run.simulationVersion == keccak256("version"), "simulation");
        require(keccak256(bytes(run.pseudo)) == keccak256("Player"), "snapshot pseudo");
        vm.expectRevert(MonadSurf.RunAlreadyStarted.selector);
        _start(RUN_A, PLAYER_A);
    }

    function testRejectsZeroRun() public {
        _save(PLAYER_A, "Player");
        vm.expectRevert(MonadSurf.InvalidRunId.selector);
        _start(bytes32(0), PLAYER_A);
    }

    function testReplayAndResultAreOnchain() public {
        _prepare(RUN_A, PLAYER_A);
        vm.expectEmit(true, true, false, true, address(game));
        emit RunSubmitted(RUN_A, PLAYER_A, 100, 7, 1, hex"03");
        _finish(RUN_A, 100, 7);
        MonadSurf.Run memory run = game.getRun(RUN_A);
        require(run.replayHash == keccak256(hex"03") && run.tickCount == 1, "replay");
        require(run.score == 100 && run.coins == 7 && run.submittedBlock == block.number, "result");
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testDuplicateCannotCreditTwiceOrChangeResult() public {
        _prepare(RUN_A, PLAYER_A);
        _finish(RUN_A, 100, 7);
        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, RUN_A));
        _finish(RUN_A, 999, 999);
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testRejectsUnknownRun() public {
        vm.expectRevert(MonadSurf.UnknownRun.selector);
        _finish(RUN_A, 100, 7);
    }

    function testRejectsExpiredRun() public {
        _prepare(RUN_A, PLAYER_A);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(MonadSurf.RunExpired.selector);
        _finish(RUN_A, 100, 7);
    }

    function testRejectsInvalidReplayLengthOrDuration() public {
        _prepare(RUN_A, PLAYER_A);
        vm.expectRevert(MonadSurf.InvalidReplay.selector);
        vm.prank(RELAYER);
        game.submitRun(RUN_A, 100, 7, 2, hex"03");
        vm.expectRevert(MonadSurf.InvalidReplay.selector);
        vm.prank(RELAYER);
        game.submitRun(RUN_A, 100, 7, 121, new bytes(121));
        require(!game.processedRuns(RUN_A), "consumed invalid run");
    }

    function testFuzzEveryMutationRequiresRelayer(address sender) public {
        if (sender == RELAYER) return;
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        vm.prank(sender);
        game.savePlayer(PLAYER_A, "Intruder");
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        vm.prank(sender);
        game.revokeSession(PLAYER_A);
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        vm.prank(sender);
        game.startRun(RUN_A, PLAYER_A, bytes32(0), bytes32(0));
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        vm.prank(sender);
        game.submitRun(RUN_A, 100, 7, 1, hex"03");
    }

    function testPlayersRemainIsolated() public {
        _prepare(RUN_A, PLAYER_A);
        _prepare(RUN_B, PLAYER_B);
        _finish(RUN_A, 100, 7);
        _finish(RUN_B, 200, 10);
        _assertPlayer(PLAYER_A, 100, 7, 1);
        _assertPlayer(PLAYER_B, 200, 10, 1);
    }

    function testFuzzAggregation(uint64 a, uint64 b, uint64 ca, uint64 cb) public {
        _prepare(RUN_A, PLAYER_A);
        _prepare(RUN_B, PLAYER_A);
        _finish(RUN_A, a, ca);
        _finish(RUN_B, b, cb);
        _assertPlayer(PLAYER_A, a > b ? a : b, uint128(ca) + uint128(cb), 2);
    }

    function testSharedWriteQuotaResetsNextMinute() public {
        vm.warp(120);
        for (uint256 i; i < 60; ++i) {
            _save(bytes32(i + 1), "Player");
        }
        require(!game.writeAvailable(), "quota not shared");
        vm.expectRevert(MonadSurf.WriteLimit.selector);
        _save(bytes32(uint256(61)), "Player");
        vm.warp(180);
        require(game.writeAvailable(), "quota not reset");
        _save(bytes32(uint256(61)), "Player");
    }

    function testRenameIsReflectedInLeaderboard() public {
        _prepare(RUN_A, PLAYER_A);
        _finish(RUN_A, 100, 7);
        _save(PLAYER_A, "Renamed");
        require(keccak256(bytes(game.getLeaderboard()[0].pseudo)) == keccak256("Renamed"), "stale pseudo");
    }

    function _save(bytes32 playerId, string memory pseudo) private {
        vm.prank(RELAYER);
        game.savePlayer(playerId, pseudo);
    }

    function _start(bytes32 runId, bytes32 playerId) private {
        vm.prank(RELAYER);
        game.startRun(runId, playerId, keccak256("seed"), keccak256("version"));
    }

    function _prepare(bytes32 runId, bytes32 playerId) private {
        if (bytes(game.getPlayer(playerId).pseudo).length == 0) _save(playerId, "Player");
        _start(runId, playerId);
    }

    function _finish(bytes32 runId, uint64 score, uint64 coins) private {
        vm.prank(RELAYER);
        game.submitRun(runId, score, coins, 1, hex"03");
    }

    function _assertPlayer(bytes32 playerId, uint64 best, uint128 coins, uint64 runs) private view {
        MonadSurf.Player memory player = game.getPlayer(playerId);
        require(player.bestScore == best && player.coins == coins && player.runs == runs, "stats");
    }
}
