// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonadSurf} from "./MonadSurf.sol";

/// @notice Journal indépendant : une transaction par changement de commande.
contract MonadMoves {
    struct Movement {
        uint32 tick;
        uint8 input;
        uint64 recordedBlock;
    }

    struct Progress {
        bytes32 historyHash;
        uint32 count;
        uint32 lastTick;
        uint8 lastInput;
    }

    struct Quota {
        uint64 window;
        uint16 count;
    }

    MonadSurf public immutable game;
    address public immutable relayer;
    Quota private _globalQuota;
    mapping(bytes32 => Quota) private _playerQuotas;
    mapping(bytes32 => Progress) private _progress;
    mapping(bytes32 => mapping(uint32 => Movement)) private _movements;

    event MovementRecorded(
        bytes32 indexed runId, uint32 indexed sequence, uint32 tick, uint8 input, bytes32 historyHash
    );

    error InvalidConfiguration();
    error NotRelayer();
    error UnknownRun();
    error InactiveSession();
    error RunExpired();
    error InvalidMovement();
    error UnexpectedSequence();
    error MovementConflict();
    error WriteLimit();

    constructor(address game_, address relayer_) {
        if (game_.code.length == 0 || relayer_ == address(0)) revert InvalidConfiguration();
        game = MonadSurf(game_);
        if (relayer_ == game.relayer()) revert InvalidConfiguration();
        relayer = relayer_;
    }

    function writeAvailable() public view returns (bool) {
        return _available(_globalQuota, 600);
    }

    function movementAvailable(bytes32 playerId) external view returns (bool) {
        return writeAvailable() && _available(_playerQuotas[playerId], 300);
    }

    function recordMovement(bytes32 runId, uint32 sequence, uint32 tick, uint8 input) external {
        if (msg.sender != relayer) revert NotRelayer();
        Progress storage progress = _progress[runId];
        if (sequence < progress.count) {
            Movement memory saved = _movements[runId][sequence];
            if (saved.tick != tick || saved.input != input) revert MovementConflict();
            return;
        }
        if (sequence != progress.count) revert UnexpectedSequence();
        MonadSurf.Run memory run = game.getRun(runId);
        if (run.playerId == bytes32(0)) revert UnknownRun();
        if (game.getPlayer(run.playerId).sessionExpiresAt <= block.timestamp) revert InactiveSession();
        if (block.timestamp > uint256(run.createdAt) + 1 days) revert RunExpired();
        if (
            input > 8 || tick >= 108000 || uint256(tick) + 1 > (block.timestamp - run.createdAt + 2) * 60
                || (run.submittedBlock != 0 && tick >= run.tickCount)
                || (progress.count != 0 && tick <= progress.lastTick)
                || input == (progress.count == 0 ? 3 : progress.lastInput)
        ) revert InvalidMovement();
        _consume(_globalQuota, 600);
        _consume(_playerQuotas[run.playerId], 300);
        _movements[runId][sequence] = Movement(tick, input, uint64(block.number));
        progress.historyHash = keccak256(abi.encodePacked(progress.historyHash, sequence, tick, input));
        progress.count += 1;
        progress.lastTick = tick;
        progress.lastInput = input;
        emit MovementRecorded(runId, sequence, tick, input, progress.historyHash);
    }

    function getProgress(bytes32 runId) external view returns (Progress memory) {
        Progress memory progress = _progress[runId];
        if (progress.count == 0) progress.lastInput = 3;
        return progress;
    }

    function getMovement(bytes32 runId, uint32 sequence) external view returns (Movement memory) {
        return _movements[runId][sequence];
    }

    function _available(Quota storage quota, uint16 limit) private view returns (bool) {
        return quota.window != uint64(block.timestamp / 60) || quota.count < limit;
    }

    function _consume(Quota storage quota, uint16 limit) private {
        uint64 window = uint64(block.timestamp / 60);
        if (quota.window != window) {
            quota.window = window;
            quota.count = 0;
        }
        if (quota.count >= limit) revert WriteLimit();
        quota.count += 1;
    }
}
