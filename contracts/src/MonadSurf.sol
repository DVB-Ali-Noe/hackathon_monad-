// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Le relayer ne soumet que les résultats recalculés par le serveur.
contract MonadSurf {
    struct Player {
        uint64 bestScore;
        uint128 coins;
        uint64 runs;
    }

    struct LeaderboardEntry {
        bytes32 playerId;
        uint64 score;
    }

    uint256 private constant LEADERBOARD_LIMIT = 25;

    address public immutable relayer;

    mapping(bytes32 => Player) private _players;
    mapping(bytes32 => bool) public processedRuns;
    LeaderboardEntry[] private _leaderboard;

    event RunSubmitted(bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins);

    error InvalidRelayer();
    error NotRelayer();
    error InvalidPlayerId();
    error InvalidRunId();
    error RunAlreadySubmitted(bytes32 runId);

    constructor(address relayer_) {
        if (relayer_ == address(0)) revert InvalidRelayer();
        relayer = relayer_;
    }

    function submitRun(bytes32 runId, bytes32 playerId, uint64 score, uint64 coins) external {
        if (msg.sender != relayer) revert NotRelayer();
        if (runId == bytes32(0)) revert InvalidRunId();
        if (playerId == bytes32(0)) revert InvalidPlayerId();
        if (processedRuns[runId]) revert RunAlreadySubmitted(runId);

        processedRuns[runId] = true;
        Player storage player = _players[playerId];
        if (score > player.bestScore) {
            player.bestScore = score;
            _updateLeaderboard(playerId, score);
        }
        player.coins += coins;
        player.runs += 1;

        emit RunSubmitted(runId, playerId, score, coins);
    }

    function getPlayer(bytes32 playerId) external view returns (Player memory) {
        return _players[playerId];
    }

    function getLeaderboard() external view returns (LeaderboardEntry[] memory) {
        return _leaderboard;
    }

    function _updateLeaderboard(bytes32 playerId, uint64 score) private {
        uint256 length = _leaderboard.length;
        uint256 index;
        while (index < length) {
            LeaderboardEntry storage entry = _leaderboard[index];
            if (score > entry.score || (score == entry.score && playerId < entry.playerId)) break;
            ++index;
        }
        if (index == LEADERBOARD_LIMIT) return;

        LeaderboardEntry memory next = LeaderboardEntry(playerId, score);
        for (; index < length; ++index) {
            LeaderboardEntry memory displaced = _leaderboard[index];
            _leaderboard[index] = next;
            // Une amélioration remplace l'ancienne entrée sans décaler les joueurs suivants.
            if (displaced.playerId == playerId) return;
            next = displaced;
        }
        if (length < LEADERBOARD_LIMIT) _leaderboard.push(next);
    }
}
