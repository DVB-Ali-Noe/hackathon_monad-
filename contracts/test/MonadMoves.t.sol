// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonadSurf} from "../src/MonadSurf.sol";
import {MonadMoves} from "../src/MonadMoves.sol";

interface MovesVm {
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function warp(uint256 timestamp) external;
}

contract MonadMovesTest {
    MovesVm private constant vm = MovesVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RELAYER = address(1);
    address private constant MOVES_RELAYER = address(2);
    bytes32 private constant PLAYER = bytes32(uint256(10));
    bytes32 private constant RUN = bytes32(uint256(100));
    MonadSurf private game;
    MonadMoves private moves;

    function setUp() public {
        vm.warp(120);
        game = new MonadSurf(RELAYER);
        moves = new MonadMoves(address(game), MOVES_RELAYER);
        _prepare(PLAYER, RUN);
    }

    function testRequiresSeparateRelayerAndExistingGame() public {
        vm.expectRevert(MonadMoves.InvalidConfiguration.selector);
        new MonadMoves(address(game), RELAYER);
        vm.expectRevert(MonadMoves.InvalidConfiguration.selector);
        new MonadMoves(address(game), address(0));
        vm.expectRevert(MonadMoves.InvalidConfiguration.selector);
        new MonadMoves(address(42), MOVES_RELAYER);
    }

    function testFuzzOnlyRelayerCanRecord(address caller) public {
        if (caller == MOVES_RELAYER) return;
        vm.prank(caller);
        vm.expectRevert(MonadMoves.NotRelayer.selector);
        moves.recordMovement(RUN, 0, 0, 0);
    }

    function testStoresOrderedMovementsAndHash() public {
        require(moves.getProgress(RUN).lastInput == 3, "neutral initial state");
        _record(RUN, 0, 0, 0);
        _record(RUN, 1, 10, 1);
        bytes32 first = keccak256(abi.encodePacked(bytes32(0), uint32(0), uint32(0), uint8(0)));
        bytes32 second = keccak256(abi.encodePacked(first, uint32(1), uint32(10), uint8(1)));
        MonadMoves.Progress memory progress = moves.getProgress(RUN);
        require(progress.count == 2 && progress.lastTick == 10 && progress.lastInput == 1, "progress");
        require(progress.historyHash == second, "history hash");
        MonadMoves.Movement memory movement = moves.getMovement(RUN, 1);
        require(movement.tick == 10 && movement.input == 1 && movement.recordedBlock == block.number, "movement");
    }

    function testRetriesAreIdempotentButCannotRewrite() public {
        _record(RUN, 0, 0, 0);
        _record(RUN, 0, 0, 0);
        require(moves.getProgress(RUN).count == 1, "duplicate");
        vm.expectRevert(MonadMoves.MovementConflict.selector);
        _record(RUN, 0, 1, 0);
        vm.expectRevert(MonadMoves.MovementConflict.selector);
        _record(RUN, 0, 0, 1);
    }

    function testRejectsGapsAndReorderedTicks() public {
        vm.expectRevert(MonadMoves.UnexpectedSequence.selector);
        _record(RUN, 1, 0, 0);
        _record(RUN, 0, 10, 0);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 1, 10, 1);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 1, 9, 1);
    }

    function testRejectsUnchangedInputsAndInvalidTicks() public {
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 0, 0, 3);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 0, 0, 9);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 0, 120, 0);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 0, 108000, 0);
        _record(RUN, 0, 0, 0);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 1, 1, 0);
    }

    function testRejectsUnknownExpiredAndRevokedRuns() public {
        vm.expectRevert(MonadMoves.UnknownRun.selector);
        _record(bytes32(uint256(999)), 0, 0, 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(MonadMoves.RunExpired.selector);
        _record(RUN, 0, 0, 0);
        vm.prank(RELAYER);
        game.revokeSession(PLAYER);
        vm.expectRevert(MonadMoves.InactiveSession.selector);
        _record(RUN, 0, 0, 0);
    }

    function testScoreDoesNotWaitForJournalAndLateMovesRemainPossible() public {
        vm.prank(RELAYER);
        game.submitRun(RUN, 12, 1, 2, hex"0001");
        _record(RUN, 0, 0, 0);
        _record(RUN, 1, 1, 1);
        vm.expectRevert(MonadMoves.InvalidMovement.selector);
        _record(RUN, 2, 2, 0);
        require(game.getPlayer(PLAYER).runs == 1, "score changed");
    }

    function testQuotaIsSharedBetweenRunsOfSamePlayerAndResets() public {
        bytes32 otherRun = bytes32(uint256(101));
        vm.prank(RELAYER);
        game.startRun(otherRun, PLAYER, bytes32(0), bytes32(0));
        vm.warp(130);
        for (uint32 i; i < 300; ++i) {
            _record(RUN, i, i, uint8(i % 2));
        }
        require(!moves.movementAvailable(PLAYER), "player quota");
        vm.expectRevert(MonadMoves.WriteLimit.selector);
        _record(otherRun, 0, 0, 0);
        _record(RUN, 0, 0, 0);
        require(moves.getProgress(RUN).count == 300, "retry consumed quota");
        vm.warp(180);
        _record(otherRun, 0, 0, 0);
    }

    function testMovementQuotaCannotExhaustScoreQuota() public {
        vm.warp(130);
        for (uint32 i; i < 100; ++i) {
            _record(RUN, i, i, uint8(i % 2));
        }
        require(game.writeAvailable(), "score quota exhausted");
        vm.prank(RELAYER);
        game.submitRun(RUN, 12, 1, 1, hex"00");
        require(game.getPlayer(PLAYER).runs == 1, "score blocked");
    }

    function testGlobalQuotaCapsAllPlayers() public {
        _prepare(bytes32(uint256(11)), bytes32(uint256(101)));
        _prepare(bytes32(uint256(12)), bytes32(uint256(102)));
        vm.warp(130);
        for (uint32 i; i < 300; ++i) {
            _record(RUN, i, i, uint8(i % 2));
            _record(bytes32(uint256(101)), i, i, uint8(i % 2));
        }
        require(!moves.writeAvailable(), "global quota");
        vm.expectRevert(MonadMoves.WriteLimit.selector);
        _record(bytes32(uint256(102)), 0, 0, 0);
        vm.warp(180);
        _record(bytes32(uint256(102)), 0, 0, 0);
    }

    function _prepare(bytes32 player, bytes32 run) private {
        vm.prank(RELAYER);
        game.savePlayer(player, "Player");
        vm.prank(RELAYER);
        game.startRun(run, player, bytes32(0), bytes32(0));
    }

    function _record(bytes32 run, uint32 sequence, uint32 tick, uint8 input) private {
        vm.prank(MOVES_RELAYER);
        moves.recordMovement(run, sequence, tick, input);
    }
}
