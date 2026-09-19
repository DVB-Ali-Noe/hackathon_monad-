// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Le relayer ne soumet que les résultats recalculés par le serveur.
contract MonadSurf {
    struct Player {
        uint64 bestScore;
        uint128 coins;
        uint64 runs;
        uint64 sessionExpiresAt;
        string pseudo;
    }

    struct LeaderboardEntry {
        bytes32 playerId;
        uint64 score;
        string pseudo;
    }

    struct Rank {
        bytes32 playerId;
        uint64 score;
    }

    struct Run {
        bytes32 playerId;
        bytes32 seed;
        bytes32 simulationVersion;
        bytes32 replayHash;
        uint64 createdAt;
        uint64 submittedBlock;
        uint64 score;
        uint64 coins;
        uint32 tickCount;
        string pseudo;
    }

    uint256 private constant LEADERBOARD_LIMIT = 25;

    address public immutable relayer;
    uint64 private _writeWindow;
    uint16 private _writes;

    mapping(bytes32 => Player) private _players;
    mapping(bytes32 => Run) private _runs;
    Rank[] private _leaderboard;

    event PlayerSaved(bytes32 indexed playerId, string pseudo, uint64 sessionExpiresAt);
    event SessionRevoked(bytes32 indexed playerId);
    event RunStarted(bytes32 indexed runId, bytes32 indexed playerId);
    event RunSubmitted(
        bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins, uint32 tickCount, bytes inputs
    );

    error InvalidRelayer();
    error NotRelayer();
    error InvalidPlayerId();
    error InvalidRunId();
    error RunAlreadySubmitted(bytes32 runId);
    error InvalidPseudo();
    error InactiveSession();
    error RunAlreadyStarted();
    error UnknownRun();
    error RunExpired();
    error InvalidReplay();
    error WriteLimit();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        uint64 window = uint64(block.timestamp / 60);
        if (_writeWindow != window) {
            _writeWindow = window;
            _writes = 0;
        }
        if (_writes >= 60) revert WriteLimit();
        ++_writes;
        _;
    }

    function writeAvailable() external view returns (bool) {
        return _writeWindow != uint64(block.timestamp / 60) || _writes < 60;
    }

    constructor(address relayer_) {
        if (relayer_ == address(0)) revert InvalidRelayer();
        relayer = relayer_;
    }

    function savePlayer(bytes32 playerId, string calldata pseudo) external onlyRelayer {
        if (playerId == bytes32(0)) revert InvalidPlayerId();
        if (bytes(pseudo).length == 0 || bytes(pseudo).length > 80) revert InvalidPseudo();
        Player storage player = _players[playerId];
        if (bytes(player.pseudo).length == 0) player.sessionExpiresAt = uint64(block.timestamp + 30 days);
        else if (player.sessionExpiresAt <= block.timestamp) revert InactiveSession();
        player.pseudo = pseudo;
        emit PlayerSaved(playerId, pseudo, player.sessionExpiresAt);
    }

    function revokeSession(bytes32 playerId) external onlyRelayer {
        _players[playerId].sessionExpiresAt = 0;
        emit SessionRevoked(playerId);
    }

    function startRun(bytes32 runId, bytes32 playerId, bytes32 seed, bytes32 simulationVersion) external onlyRelayer {
        if (runId == bytes32(0)) revert InvalidRunId();
        if (playerId == bytes32(0)) revert InvalidPlayerId();
        if (_players[playerId].sessionExpiresAt <= block.timestamp) revert InactiveSession();
        if (_runs[runId].playerId != bytes32(0)) revert RunAlreadyStarted();
        Run storage run = _runs[runId];
        run.playerId = playerId;
        run.seed = seed;
        run.simulationVersion = simulationVersion;
        run.createdAt = uint64(block.timestamp);
        run.pseudo = _players[playerId].pseudo;
        emit RunStarted(runId, playerId);
    }

    function submitRun(bytes32 runId, uint64 score, uint64 coins, uint32 tickCount, bytes calldata inputs)
        external
        onlyRelayer
    {
        if (runId == bytes32(0)) revert InvalidRunId();
        Run storage run = _runs[runId];
        if (run.playerId == bytes32(0)) revert UnknownRun();
        if (run.submittedBlock != 0) revert RunAlreadySubmitted(runId);
        if (block.timestamp > uint256(run.createdAt) + 1 days) revert RunExpired();
        if (tickCount == 0 || tickCount > 108000 || inputs.length != tickCount) revert InvalidReplay();
        if (uint256(tickCount) > (block.timestamp - run.createdAt + 2) * 60) revert InvalidReplay();
        run.submittedBlock = uint64(block.number);
        run.score = score;
        run.coins = coins;
        run.tickCount = tickCount;
        run.replayHash = keccak256(inputs);
        Player storage player = _players[run.playerId];
        if (score > player.bestScore) {
            player.bestScore = score;
            _updateLeaderboard(run.playerId, score);
        }
        player.coins += coins;
        player.runs += 1;

        emit RunSubmitted(runId, run.playerId, score, coins, tickCount, inputs);
    }

    function processedRuns(bytes32 runId) external view returns (bool) {
        return _runs[runId].submittedBlock != 0;
    }

    function getRun(bytes32 runId) external view returns (Run memory) {
        return _runs[runId];
    }

    function getPlayer(bytes32 playerId) external view returns (Player memory) {
        return _players[playerId];
    }

    function getLeaderboard() external view returns (LeaderboardEntry[] memory) {
        LeaderboardEntry[] memory entries = new LeaderboardEntry[](_leaderboard.length);
        for (uint256 i; i < entries.length; ++i) {
            Rank memory rank = _leaderboard[i];
            entries[i] = LeaderboardEntry(rank.playerId, rank.score, _players[rank.playerId].pseudo);
        }
        return entries;
    }

    function _updateLeaderboard(bytes32 playerId, uint64 score) private {
        uint256 length = _leaderboard.length;
        uint256 index;
        while (index < length) {
            Rank storage entry = _leaderboard[index];
            if (score > entry.score || (score == entry.score && playerId < entry.playerId)) break;
            ++index;
        }
        if (index == LEADERBOARD_LIMIT) return;

        Rank memory next = Rank(playerId, score);
        for (; index < length; ++index) {
            Rank memory displaced = _leaderboard[index];
            _leaderboard[index] = next;
            // Une amélioration remplace l'ancienne entrée sans décaler les joueurs suivants.
            if (displaced.playerId == playerId) return;
            next = displaced;
        }
        if (length < LEADERBOARD_LIMIT) _leaderboard.push(next);
    }
}
