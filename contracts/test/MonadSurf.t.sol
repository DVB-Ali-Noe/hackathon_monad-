// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonadSurf} from "../src/MonadSurf.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
}

contract MonadSurfTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RELAYER = address(0xA11CE);
    bytes32 private constant PLAYER_A = bytes32(uint256(1));
    bytes32 private constant PLAYER_B = bytes32(uint256(2));
    bytes32 private constant RUN_A = bytes32(uint256(101));
    bytes32 private constant RUN_B = bytes32(uint256(102));
    bytes32 private constant RUN_C = bytes32(uint256(103));

    MonadSurf private game;

    event RunSubmitted(bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins);

    function setUp() public {
        game = new MonadSurf(RELAYER);
    }

    function testRejectsZeroRelayer() public {
        vm.expectRevert(MonadSurf.InvalidRelayer.selector);
        new MonadSurf(address(0));
    }

    function testRelayerRecordsResultAndEvent() public {
        require(game.relayer() == RELAYER, "relayer");
        vm.expectEmit(true, true, false, true, address(game));
        emit RunSubmitted(RUN_A, PLAYER_A, 100, 7);
        _submit(RUN_A, PLAYER_A, 100, 7);

        _assertPlayer(PLAYER_A, 100, 7, 1);
        require(game.processedRuns(RUN_A), "run not recorded");
    }

    function testDeployerHasNoWritePrivilege() public {
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        game.submitRun(RUN_A, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 0, 0, 0);
        require(!game.processedRuns(RUN_A), "run consumed");
    }

    function testFuzzRejectsUnauthorizedSender(address sender) public {
        if (sender == RELAYER) return;
        vm.expectRevert(MonadSurf.NotRelayer.selector);
        vm.prank(sender);
        game.submitRun(RUN_A, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 0, 0, 0);
        require(!game.processedRuns(RUN_A), "run consumed");
        _submit(RUN_A, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testRejectsDuplicateRun() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, RUN_A));
        _submit(RUN_A, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testRejectsDuplicateRunWithChangedResult() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, RUN_A));
        _submit(RUN_A, PLAYER_A, 999, 999);
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testRunCannotBeReassignedToAnotherPlayer() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, RUN_A));
        _submit(RUN_A, PLAYER_B, 200, 10);
        _assertPlayer(PLAYER_A, 100, 7, 1);
        _assertPlayer(PLAYER_B, 0, 0, 0);
    }

    function testPlayersAreIsolated() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        _submit(RUN_B, PLAYER_B, 200, 10);
        _submit(RUN_C, PLAYER_A, 50, 3);
        _assertPlayer(PLAYER_A, 100, 10, 2);
        _assertPlayer(PLAYER_B, 200, 10, 1);
    }

    function testBestScoreOnlyIncreasesAndCoinsAccumulate() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        _submit(RUN_B, PLAYER_A, 50, 3);
        _assertPlayer(PLAYER_A, 100, 10, 2);
        _submit(RUN_C, PLAYER_A, 200, 2);
        _assertPlayer(PLAYER_A, 200, 12, 3);
    }

    function testEqualScoreStillCreditsRunAndCoins() public {
        _submit(RUN_A, PLAYER_A, 100, 7);
        _submit(RUN_B, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 100, 14, 2);
    }

    function testZeroResultIsRecordedOnce() public {
        _submit(RUN_A, PLAYER_A, 0, 0);
        _assertPlayer(PLAYER_A, 0, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(MonadSurf.RunAlreadySubmitted.selector, RUN_A));
        _submit(RUN_A, PLAYER_A, 0, 0);
        _assertPlayer(PLAYER_A, 0, 0, 1);
    }

    function testRejectsZeroPlayerWithoutConsumingRun() public {
        vm.expectRevert(MonadSurf.InvalidPlayerId.selector);
        _submit(RUN_A, bytes32(0), 100, 7);
        require(!game.processedRuns(RUN_A), "run consumed");
        _submit(RUN_A, PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 100, 7, 1);
    }

    function testRejectsZeroRunWithoutCreditingPlayer() public {
        vm.expectRevert(MonadSurf.InvalidRunId.selector);
        _submit(bytes32(0), PLAYER_A, 100, 7);
        _assertPlayer(PLAYER_A, 0, 0, 0);
        require(!game.processedRuns(bytes32(0)), "zero run consumed");
    }

    function testUnknownPlayerHasZeroStats() public view {
        _assertPlayer(PLAYER_A, 0, 0, 0);
    }

    function testCoinBalanceCanExceedUint64() public {
        _submit(RUN_A, PLAYER_A, type(uint64).max, type(uint64).max);
        _submit(RUN_B, PLAYER_A, 0, type(uint64).max);
        _assertPlayer(PLAYER_A, type(uint64).max, uint128(type(uint64).max) * 2, 2);
    }

    function testFuzzAggregation(uint64 scoreA, uint64 scoreB, uint64 coinsA, uint64 coinsB) public {
        _submit(RUN_A, PLAYER_A, scoreA, coinsA);
        _submit(RUN_B, PLAYER_A, scoreB, coinsB);
        _assertPlayer(PLAYER_A, scoreA > scoreB ? scoreA : scoreB, uint128(coinsA) + uint128(coinsB), 2);
        require(game.processedRuns(RUN_A) && game.processedRuns(RUN_B), "missing runs");
    }

    function _submit(bytes32 runId, bytes32 playerId, uint64 score, uint64 coins) private {
        vm.prank(RELAYER);
        game.submitRun(runId, playerId, score, coins);
    }

    function _assertPlayer(bytes32 playerId, uint64 bestScore, uint128 coins, uint64 runs) private view {
        MonadSurf.Player memory player = game.getPlayer(playerId);
        require(player.bestScore == bestScore, "best score");
        require(player.coins == coins, "coins");
        require(player.runs == runs, "runs");
    }
}
