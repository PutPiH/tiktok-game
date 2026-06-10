(function () {
  var SIZE = 4;
  var TARGET_TILE = 2048;
  var STORAGE_KEY = "garden_2048_save_v1";
  var BEST_KEY = "garden_2048_best_v1";
  var MOVE_THRESHOLD = 24;

  var platform = createPlatform();
  var canvas = platform.createCanvas();
  var ctx = canvas.getContext("2d");

  var logicalWidth = 375;
  var logicalHeight = 667;
  var pixelRatio = 1;
  var layout = {};
  var buttons = [];
  var touchStart = null;
  var dragState = null;
  var animationState = null;
  var toast = null;

  var tileThemes = {
    0: { bg: "#d8e2df", fg: "#65756f", label: "" },
    2: { bg: "#f4e7c8", fg: "#5f5849", label: "2" },
    4: { bg: "#d7efcb", fg: "#486446", label: "4" },
    8: { bg: "#9bd8c3", fg: "#1f5b52", label: "8" },
    16: { bg: "#7fc0de", fg: "#173f52", label: "16" },
    32: { bg: "#f4b06b", fg: "#5c3210", label: "32" },
    64: { bg: "#ef7d5b", fg: "#ffffff", label: "64" },
    128: { bg: "#f3d05e", fg: "#51400b", label: "128" },
    256: { bg: "#cfa0e8", fg: "#45285c", label: "256" },
    512: { bg: "#8d79d6", fg: "#ffffff", label: "512" },
    1024: { bg: "#5a9b78", fg: "#ffffff", label: "1024" },
    2048: { bg: "#243b53", fg: "#ffffff", label: "2048" }
  };

  var state = {
    board: emptyBoard(),
    score: 0,
    best: 0,
    nextTileValue: 2,
    isOver: false,
    hasWon: false,
    history: []
  };

  installDebugBridge();
  init();

  function init() {
    resize();
    loadGame();
    bindInput();
    render();
  }

  function installDebugBridge() {
    if (platform.isByteDance || typeof window === "undefined") {
      return;
    }

    window.__garden2048Debug = {
      getState: function () {
        return {
          board: cloneBoard(state.board),
          score: state.score,
          best: state.best,
          nextTileValue: state.nextTileValue,
          isOver: state.isOver,
          hasWon: state.hasWon,
          historyLength: state.history.length
        };
      },
      move: move,
      startNewGame: startNewGame,
      undoMove: undoMove
    };
  }

  function createPlatform() {
    var isByteDance = typeof tt !== "undefined" && typeof tt.createCanvas === "function";

    function getBrowserCanvas() {
      var existingCanvas = typeof document !== "undefined" && document.getElementById("game-canvas");
      if (existingCanvas) {
        return existingCanvas;
      }
      var createdCanvas = document.createElement("canvas");
      document.body.appendChild(createdCanvas);
      return createdCanvas;
    }

    return {
      isByteDance: isByteDance,
      createCanvas: function () {
        return isByteDance ? tt.createCanvas() : getBrowserCanvas();
      },
      getSystemInfo: function () {
        if (isByteDance && typeof tt.getSystemInfoSync === "function") {
          return tt.getSystemInfoSync();
        }
        return {
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1
        };
      },
      getStorage: function (key) {
        try {
          if (isByteDance && typeof tt.getStorageSync === "function") {
            return tt.getStorageSync(key);
          }
          return window.localStorage.getItem(key);
        } catch (error) {
          return "";
        }
      },
      setStorage: function (key, value) {
        try {
          if (isByteDance && typeof tt.setStorageSync === "function") {
            tt.setStorageSync(key, value);
            return;
          }
          window.localStorage.setItem(key, value);
        } catch (error) {
          // Storage may be unavailable in private browsing or restricted runtimes.
        }
      },
      onResize: function (handler) {
        if (isByteDance && typeof tt.onWindowResize === "function") {
          tt.onWindowResize(handler);
          return;
        }
        if (typeof window !== "undefined") {
          window.addEventListener("resize", handler);
        }
      },
      requestFrame: function (handler) {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(handler);
          return;
        }
        setTimeout(handler, 16);
      }
    };
  }

  function bindInput() {
    bindTouch();
    bindKeyboard();
    platform.onResize(function () {
      resize();
      render();
    });
  }

  function bindTouch() {
    function onStart(event) {
      if (animationState) {
        return;
      }
      var point = getPoint(event);
      touchStart = point ? { x: point.x, y: point.y, time: Date.now() } : null;
      dragState = touchStart
        ? {
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y,
            direction: null,
            distance: 0,
            plan: null
          }
        : null;
    }

    function onMove(event) {
      if (!dragState || state.isOver) {
        return;
      }

      var point = getPoint(event);
      if (!point) {
        return;
      }

      if (event.preventDefault) {
        event.preventDefault();
      }

      dragState.currentX = point.x;
      dragState.currentY = point.y;
      updateDragState();
      render();
    }

    function onEnd(event) {
      if (!touchStart) {
        return;
      }
      var point = getPoint(event, true) || touchStart;
      var dx = point.x - touchStart.x;
      var dy = point.y - touchStart.y;
      var absX = Math.abs(dx);
      var absY = Math.abs(dy);

      if (Math.max(absX, absY) < MOVE_THRESHOLD) {
        handleTap(point.x, point.y);
      } else {
        dragState.currentX = point.x;
        dragState.currentY = point.y;
        updateDragState();
        finishDrag();
      }

      touchStart = null;
      dragState = null;
    }

    function onCancel() {
      touchStart = null;
      if (dragState && dragState.direction) {
        startSlideAnimation(dragState.direction, dragState.plan, null, dragState.distance, false);
      }
      dragState = null;
    }

    if (canvas.addEventListener) {
      canvas.addEventListener("touchstart", onStart, { passive: false });
      canvas.addEventListener("touchmove", onMove, { passive: false });
      canvas.addEventListener("touchend", onEnd, { passive: false });
      canvas.addEventListener("touchcancel", onCancel, { passive: false });
      canvas.addEventListener("mousedown", onStart);
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseup", onEnd);
      return;
    }

    if (platform.isByteDance) {
      tt.onTouchStart(onStart);
      tt.onTouchMove(onMove);
      tt.onTouchEnd(onEnd);
      tt.onTouchCancel(onCancel);
    }
  }

  function bindKeyboard() {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("keydown", function (event) {
      var keyMap = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
        a: "left",
        d: "right",
        w: "up",
        s: "down"
      };
      var direction = keyMap[event.key];
      if (direction) {
        event.preventDefault();
        move(direction);
      }
    });
  }

  function getPoint(event, preferChangedTouches) {
    var source = null;
    if (preferChangedTouches && event.changedTouches && event.changedTouches.length) {
      source = event.changedTouches[0];
    } else if (event.touches && event.touches.length) {
      source = event.touches[0];
    } else if (event.changedTouches && event.changedTouches.length) {
      source = event.changedTouches[0];
    } else if (typeof event.clientX === "number") {
      source = event;
    }

    if (!source) {
      return null;
    }

    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top
    };
  }

  function handleTap(x, y) {
    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) {
        button.onTap();
        return;
      }
    }
  }

  function updateDragState() {
    var dx = dragState.currentX - dragState.startX;
    var dy = dragState.currentY - dragState.startY;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);

    if (!dragState.direction && Math.max(absX, absY) >= 8) {
      dragState.direction = absX > absY ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      dragState.plan = calculateMove(state.board, dragState.direction);
    }

    if (!dragState.direction) {
      dragState.distance = 0;
      return;
    }

    var projected = getProjectedDistance(dragState.direction, dx, dy);
    dragState.distance = Math.min(tileTravel(), Math.max(0, projected));
  }

  function finishDrag() {
    if (!dragState || !dragState.direction) {
      render();
      return;
    }

    var before = makeSnapshot();
    var plan = dragState.plan || calculateMove(state.board, dragState.direction);
    var shouldCommit = plan.moved && dragState.distance >= commitDistance();

    if (!plan.moved && dragState.distance >= commitDistance()) {
      showToast("这个方向不能动");
    }

    startSlideAnimation(dragState.direction, plan, before, dragState.distance, shouldCommit);
  }

  function getProjectedDistance(direction, dx, dy) {
    if (direction === "left") {
      return -dx;
    }
    if (direction === "right") {
      return dx;
    }
    if (direction === "up") {
      return -dy;
    }
    return dy;
  }

  function tileTravel() {
    return layout.tileSize + layout.gap;
  }

  function commitDistance() {
    return Math.max(28, tileTravel() * 0.38);
  }

  function startSlideAnimation(direction, plan, before, fromDistance, shouldCommit) {
    animationState = {
      direction: direction,
      plan: plan,
      before: before,
      fromDistance: fromDistance || 0,
      toDistance: shouldCommit ? tileTravel() : 0,
      shouldCommit: shouldCommit,
      startedAt: Date.now(),
      duration: shouldCommit ? 130 : 105
    };
    platform.requestFrame(render);
  }

  function resize() {
    var systemInfo = platform.getSystemInfo();
    logicalWidth = systemInfo.windowWidth || 375;
    logicalHeight = systemInfo.windowHeight || 667;
    pixelRatio = systemInfo.pixelRatio || 1;

    canvas.width = Math.floor(logicalWidth * pixelRatio);
    canvas.height = Math.floor(logicalHeight * pixelRatio);

    if (canvas.style) {
      canvas.style.width = logicalWidth + "px";
      canvas.style.height = logicalHeight + "px";
    }

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    updateLayout();
  }

  function updateLayout() {
    var safeTop = Math.max(16, Math.round(logicalHeight * 0.035));
    var sidePadding = Math.max(16, Math.round(Math.min(logicalWidth, 430) * 0.045));
    var contentWidth = Math.min(logicalWidth - sidePadding * 2, 430);
    var contentX = Math.round((logicalWidth - contentWidth) / 2);
    var boardSize = Math.min(contentWidth, Math.round(logicalHeight * 0.54));
    var boardY = Math.min(Math.round(logicalHeight * 0.28), logicalHeight - boardSize - 118);
    boardY = Math.max(176, boardY);

    var gap = Math.max(8, Math.round(boardSize * 0.026));
    var tileSize = (boardSize - gap * (SIZE + 1)) / SIZE;

    layout = {
      safeTop: safeTop,
      sidePadding: sidePadding,
      contentX: contentX,
      contentWidth: contentWidth,
      boardSize: boardSize,
      boardX: Math.round((logicalWidth - boardSize) / 2),
      boardY: boardY,
      gap: gap,
      tileSize: tileSize,
      footerY: boardY + boardSize + 18
    };
  }

  function emptyBoard() {
    var board = [];
    for (var row = 0; row < SIZE; row += 1) {
      board[row] = [];
      for (var col = 0; col < SIZE; col += 1) {
        board[row][col] = 0;
      }
    }
    return board;
  }

  function loadGame() {
    var best = parseInt(platform.getStorage(BEST_KEY), 10);
    state.best = isNaN(best) ? 0 : best;

    var saved = platform.getStorage(STORAGE_KEY);
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        if (isValidBoard(parsed.board)) {
          state.board = parsed.board;
          state.score = Number(parsed.score) || 0;
          state.nextTileValue = isValidTileValue(parsed.nextTileValue)
            ? parsed.nextTileValue
            : generateNextTileValue(parsed.board);
          state.isOver = Boolean(parsed.isOver);
          state.hasWon = Boolean(parsed.hasWon);
          state.history = [];
          return;
        }
      } catch (error) {
        // Fall through to a fresh game when save data is malformed.
      }
    }

    startNewGame();
  }

  function startNewGame() {
    clearMotion();
    state.board = emptyBoard();
    state.score = 0;
    state.nextTileValue = 2;
    state.isOver = false;
    state.hasWon = false;
    state.history = [];
    addInitialTile();
    addInitialTile();
    state.nextTileValue = generateNextTileValue(state.board);
    saveGame();
    showToast("新一局开始");
    render();
  }

  function isValidBoard(board) {
    if (!Array.isArray(board) || board.length !== SIZE) {
      return false;
    }
    for (var row = 0; row < SIZE; row += 1) {
      if (!Array.isArray(board[row]) || board[row].length !== SIZE) {
        return false;
      }
      for (var col = 0; col < SIZE; col += 1) {
        if (typeof board[row][col] !== "number") {
          return false;
        }
      }
    }
    return true;
  }

  function saveGame() {
    var payload = {
      board: state.board,
      score: state.score,
      nextTileValue: state.nextTileValue,
      isOver: state.isOver,
      hasWon: state.hasWon
    };
    platform.setStorage(STORAGE_KEY, JSON.stringify(payload));
    platform.setStorage(BEST_KEY, String(state.best));
  }

  function cloneBoard(board) {
    var clone = [];
    for (var row = 0; row < SIZE; row += 1) {
      clone[row] = board[row].slice();
    }
    return clone;
  }

  function makeSnapshot() {
    return {
      board: cloneBoard(state.board),
      score: state.score,
      nextTileValue: state.nextTileValue,
      isOver: state.isOver,
      hasWon: state.hasWon
    };
  }

  function restoreSnapshot(snapshot) {
    clearMotion();
    state.board = cloneBoard(snapshot.board);
    state.score = snapshot.score;
    state.nextTileValue = snapshot.nextTileValue;
    state.isOver = snapshot.isOver;
    state.hasWon = snapshot.hasWon;
    saveGame();
    render();
  }

  function addInitialTile() {
    addRandomTile(Math.random() < 0.92 ? 2 : 4);
  }

  function addRandomTile(value) {
    var emptyCells = [];
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        if (state.board[row][col] === 0) {
          emptyCells.push({ row: row, col: col });
        }
      }
    }

    if (!emptyCells.length) {
      return false;
    }

    var picked = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    state.board[picked.row][picked.col] = value;
    return true;
  }

  function generateNextTileValue(board) {
    var targetBoard = board || state.board;
    var maxTile = getMaxTile(targetBoard);
    var emptyCount = countEmptyCells(targetBoard);
    var pressure = 1 - emptyCount / (SIZE * SIZE);
    var candidates = [
      { value: 2, weight: 68 - pressure * 26 },
      { value: 4, weight: 24 + pressure * 8 }
    ];

    addCandidate(candidates, 8, maxTile >= 32, 4 + pressure * 12);
    addCandidate(candidates, 16, maxTile >= 128, 2 + pressure * 8);
    addCandidate(candidates, 32, maxTile >= 512, 1 + pressure * 5);
    addCandidate(candidates, 64, maxTile >= 1024, 0.6 + pressure * 3);
    addCandidate(candidates, 128, maxTile >= 2048, 0.35 + pressure * 2);

    return weightedPick(candidates);
  }

  function addCandidate(candidates, value, enabled, weight) {
    if (enabled) {
      candidates.push({ value: value, weight: weight });
    }
  }

  function weightedPick(candidates) {
    var total = 0;
    for (var index = 0; index < candidates.length; index += 1) {
      total += candidates[index].weight;
    }

    var roll = Math.random() * total;
    for (var pickIndex = 0; pickIndex < candidates.length; pickIndex += 1) {
      roll -= candidates[pickIndex].weight;
      if (roll <= 0) {
        return candidates[pickIndex].value;
      }
    }

    return candidates[candidates.length - 1].value;
  }

  function isValidTileValue(value) {
    return typeof value === "number" && value >= 2 && value <= 4096 && Math.log(value) / Math.log(2) % 1 === 0;
  }

  function getMaxTile(board) {
    var maxTile = 0;
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        maxTile = Math.max(maxTile, board[row][col]);
      }
    }
    return maxTile;
  }

  function countEmptyCells(board) {
    var count = 0;
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        if (board[row][col] === 0) {
          count += 1;
        }
      }
    }
    return count;
  }

  function move(direction) {
    if (animationState) {
      return;
    }

    if (state.isOver) {
      showToast("本局已结束");
      render();
      return;
    }

    var before = makeSnapshot();
    var result = calculateMove(state.board, direction);

    if (!result.moved) {
      showToast("这个方向不能动");
      render();
      return;
    }

    applyMoveResult(result, before);
    render();
  }

  function applyMoveResult(result, before) {
    state.history.push(before);
    if (state.history.length > 20) {
      state.history.shift();
    }

    state.board = result.board;
    state.score += result.scoreGained;
    if (state.score > state.best) {
      state.best = state.score;
    }

    addRandomTile(state.nextTileValue);
    state.nextTileValue = generateNextTileValue(state.board);
    if (!state.hasWon && containsTile(TARGET_TILE)) {
      state.hasWon = true;
      showToast("解锁 2048");
    } else if (result.merges >= 2) {
      showToast("连锁合成 x" + result.merges);
    }

    state.isOver = !canMove();
    if (state.isOver) {
      showToast("本局结束");
    }

    saveGame();
  }

  function calculateMove(board, direction) {
    var next = emptyBoard();
    var movingCells = emptyBoard();
    var moved = false;
    var scoreGained = 0;
    var merges = 0;

    for (var index = 0; index < SIZE; index += 1) {
      var line = readLine(board, direction, index);
      var stepped = stepLine(line);
      scoreGained += stepped.scoreGained;
      merges += stepped.merges;
      writeLine(next, direction, index, stepped.line);
      writeLine(movingCells, direction, index, stepped.movingLine);
    }

    moved = !boardsEqual(board, next);
    return {
      board: next,
      moved: moved,
      scoreGained: scoreGained,
      merges: merges,
      movingCells: movingCells
    };
  }

  function readLine(board, direction, index) {
    var line = [];
    for (var step = 0; step < SIZE; step += 1) {
      if (direction === "left") {
        line.push(board[index][step]);
      } else if (direction === "right") {
        line.push(board[index][SIZE - 1 - step]);
      } else if (direction === "up") {
        line.push(board[step][index]);
      } else if (direction === "down") {
        line.push(board[SIZE - 1 - step][index]);
      }
    }
    return line;
  }

  function writeLine(board, direction, index, line) {
    for (var step = 0; step < SIZE; step += 1) {
      if (direction === "left") {
        board[index][step] = line[step];
      } else if (direction === "right") {
        board[index][SIZE - 1 - step] = line[step];
      } else if (direction === "up") {
        board[step][index] = line[step];
      } else if (direction === "down") {
        board[SIZE - 1 - step][index] = line[step];
      }
    }
  }

  function stepLine(line) {
    var result = line.slice();
    var movingLine = [false, false, false, false];
    var mergedCells = [false, false, false, false];
    var scoreGained = 0;
    var merges = 0;

    for (var index = 1; index < SIZE; index += 1) {
      if (result[index] === 0) {
        continue;
      }

      if (result[index - 1] === 0) {
        result[index - 1] = result[index];
        result[index] = 0;
        movingLine[index] = true;
      } else if (result[index - 1] === result[index] && !mergedCells[index - 1]) {
        result[index - 1] *= 2;
        var mergedValue = result[index - 1];
        result[index] = 0;
        mergedCells[index - 1] = true;
        movingLine[index] = true;
        scoreGained += mergedValue;
        merges += 1;
      }
    }

    return {
      line: result,
      movingLine: movingLine,
      scoreGained: scoreGained,
      merges: merges
    };
  }

  function clearMotion() {
    touchStart = null;
    dragState = null;
    animationState = null;
  }

  function boardsEqual(a, b) {
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        if (a[row][col] !== b[row][col]) {
          return false;
        }
      }
    }
    return true;
  }

  function containsTile(value) {
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        if (state.board[row][col] >= value) {
          return true;
        }
      }
    }
    return false;
  }

  function canMove() {
    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        var value = state.board[row][col];
        if (value === 0) {
          return true;
        }
        if (col < SIZE - 1 && state.board[row][col + 1] === value) {
          return true;
        }
        if (row < SIZE - 1 && state.board[row + 1][col] === value) {
          return true;
        }
      }
    }
    return false;
  }

  function undoMove() {
    if (!state.history.length) {
      showToast("没有可撤回的步骤");
      render();
      return;
    }
    var snapshot = state.history.pop();
    restoreSnapshot(snapshot);
    showToast("已撤回一步");
  }

  function showToast(message) {
    toast = {
      message: message,
      createdAt: Date.now(),
      ttl: 1400
    };
  }

  function render() {
    var motion = getActiveMotion();
    buttons = [];
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    drawBackground();
    drawHeader();
    drawBoard(motion);
    drawActions();
    drawFooter();
    drawToast();

    if ((toast && Date.now() - toast.createdAt < toast.ttl) || animationState) {
      platform.requestFrame(render);
    }
  }

  function getActiveMotion() {
    if (animationState) {
      var progress = Math.min(1, (Date.now() - animationState.startedAt) / animationState.duration);
      if (progress >= 1) {
        var finishedAnimation = animationState;
        animationState = null;
        if (finishedAnimation.shouldCommit) {
          applyMoveResult(finishedAnimation.plan, finishedAnimation.before);
        }
        return null;
      }

      return {
        direction: animationState.direction,
        distance:
          animationState.fromDistance +
          (animationState.toDistance - animationState.fromDistance) * easeOutCubic(progress),
        plan: animationState.plan
      };
    }

    if (dragState && dragState.direction) {
      return {
        direction: dragState.direction,
        distance: dragState.distance,
        plan: dragState.plan
      };
    }

    return null;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function drawBackground() {
    var gradient = ctx.createLinearGradient(0, 0, 0, logicalHeight);
    gradient.addColorStop(0, "#f7fbff");
    gradient.addColorStop(0.46, "#edf8f6");
    gradient.addColorStop(1, "#f2f7ec");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    drawLeaf(34, 94, 34, "#7dc6c2", 0.22);
    drawLeaf(logicalWidth - 52, 120, 42, "#8bb8ee", 0.18);
    drawLeaf(logicalWidth - 28, logicalHeight - 86, 50, "#f1a776", 0.16);
  }

  function drawHeader() {
    ctx.fillStyle = "#2d2a24";
    ctx.font = "700 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("2048 合成花园", layout.contentX, layout.safeTop);

    ctx.fillStyle = "#706858";
    ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("滑动合成，解锁 2048", layout.contentX, layout.safeTop + 38);

    var scoreY = layout.safeTop + 76;
    var boxWidth = Math.floor((layout.contentWidth - 20) / 3);
    drawScoreBox(layout.contentX, scoreY, boxWidth, 58, "本局", state.score);
    drawScoreBox(layout.contentX + boxWidth + 10, scoreY, boxWidth, 58, "最高", state.best);
    drawNextBox(layout.contentX + (boxWidth + 10) * 2, scoreY, boxWidth, 58);
  }

  function drawScoreBox(x, y, w, h, label, value) {
    roundRect(x, y, w, h, 8, "#ffffff", true);
    ctx.strokeStyle = "rgba(82, 75, 61, 0.12)";
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, 8, "", false);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#8a8170";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(label, x + w / 2, y + 17);

    ctx.fillStyle = "#2f2b24";
    ctx.font =
      "700 " +
      (String(value).length > 5 ? 17 : String(value).length > 4 ? 19 : 22) +
      "px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(String(value), x + w / 2, y + 39);
  }

  function drawNextBox(x, y, w, h) {
    var value = state.nextTileValue || 2;
    var theme = tileThemes[value] || tileThemes[2048];

    roundRect(x, y, w, h, 8, "#ffffff", true);
    ctx.strokeStyle = "rgba(82, 75, 61, 0.12)";
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, 8, "", false);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#8a8170";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("下一个", x + w / 2, y + 15);

    var tileW = Math.min(58, w - 22);
    var tileH = 28;
    var tileX = x + (w - tileW) / 2;
    var tileY = y + 25;
    roundRect(tileX, tileY, tileW, tileH, 7, theme.bg, true);

    ctx.fillStyle = theme.fg;
    ctx.font = "800 16px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(String(value), x + w / 2, tileY + tileH / 2 + 1);
  }

  function drawBoard(motion) {
    roundRect(layout.boardX, layout.boardY, layout.boardSize, layout.boardSize, 10, "#9fb0a8", true);

    for (var row = 0; row < SIZE; row += 1) {
      for (var col = 0; col < SIZE; col += 1) {
        drawCellSlot(row, col);
      }
    }

    for (var staticRow = 0; staticRow < SIZE; staticRow += 1) {
      for (var staticCol = 0; staticCol < SIZE; staticCol += 1) {
        if (!isMovingCell(motion, staticRow, staticCol)) {
          drawTile(staticRow, staticCol, state.board[staticRow][staticCol], 0, 0);
        }
      }
    }

    if (motion && motion.plan && motion.plan.movingCells) {
      var offset = getMotionOffset(motion.direction, motion.distance);
      for (var movingRow = 0; movingRow < SIZE; movingRow += 1) {
        for (var movingCol = 0; movingCol < SIZE; movingCol += 1) {
          if (isMovingCell(motion, movingRow, movingCol)) {
            drawTile(movingRow, movingCol, state.board[movingRow][movingCol], offset.x, offset.y);
          }
        }
      }
    }

    if (state.isOver) {
      drawGameOver();
    }
  }

  function isMovingCell(motion, row, col) {
    return Boolean(motion && motion.plan && motion.plan.movingCells && motion.plan.movingCells[row][col]);
  }

  function getMotionOffset(direction, distance) {
    if (direction === "left") {
      return { x: -distance, y: 0 };
    }
    if (direction === "right") {
      return { x: distance, y: 0 };
    }
    if (direction === "up") {
      return { x: 0, y: -distance };
    }
    return { x: 0, y: distance };
  }

  function drawCellSlot(row, col) {
    var x = layout.boardX + layout.gap + col * (layout.tileSize + layout.gap);
    var y = layout.boardY + layout.gap + row * (layout.tileSize + layout.gap);
    var radius = Math.min(8, layout.tileSize * 0.12);
    roundRect(x, y, layout.tileSize, layout.tileSize, radius, tileThemes[0].bg, true);
  }

  function drawTile(row, col, value, offsetX, offsetY) {
    if (!value) {
      return;
    }

    var x = layout.boardX + layout.gap + col * (layout.tileSize + layout.gap) + offsetX;
    var y = layout.boardY + layout.gap + row * (layout.tileSize + layout.gap) + offsetY;
    var theme = tileThemes[value] || tileThemes[2048];
    var radius = Math.min(8, layout.tileSize * 0.12);

    roundRect(x, y, layout.tileSize, layout.tileSize, radius, theme.bg, true);

    drawSprout(x + layout.tileSize / 2, y + layout.tileSize * 0.37, layout.tileSize * 0.2, theme.fg);

    var fontSize = value < 100 ? 28 : value < 1000 ? 24 : 20;
    ctx.fillStyle = theme.fg;
    ctx.font = "800 " + fontSize + "px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(value), x + layout.tileSize / 2, y + layout.tileSize * 0.66);
  }

  function drawActions() {
    var y = layout.footerY;
    var w = Math.floor((layout.contentWidth - 10) / 2);
    drawButton(layout.contentX, y, w, 48, "重新开始", startNewGame, "#2f675d", "#ffffff");
    drawButton(layout.contentX + w + 10, y, w, 48, "撤回一步", undoMove, "#ffffff", "#2f2b24");
  }

  function drawButton(x, y, w, h, label, onTap, bg, fg) {
    buttons.push({ x: x, y: y, w: w, h: h, onTap: onTap });
    roundRect(x, y, w, h, 8, bg, true);

    if (bg === "#ffffff") {
      ctx.strokeStyle = "rgba(82, 75, 61, 0.16)";
      ctx.lineWidth = 1;
      roundRect(x, y, w, h, 8, "", false);
    }

    ctx.fillStyle = fg;
    ctx.font = "700 16px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  function drawFooter() {
    var y = layout.footerY + 64;
    ctx.fillStyle = "#706858";
    ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("方向键、WASD 或手势滑动均可操作", logicalWidth / 2, y);
  }

  function drawGameOver() {
    ctx.fillStyle = "rgba(45, 42, 36, 0.62)";
    roundRect(layout.boardX, layout.boardY, layout.boardSize, layout.boardSize, 10, ctx.fillStyle, true);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("本局结束", logicalWidth / 2, layout.boardY + layout.boardSize / 2 - 18);
    ctx.font = "15px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("点重新开始再来一局", logicalWidth / 2, layout.boardY + layout.boardSize / 2 + 22);
  }

  function drawToast() {
    if (!toast) {
      return;
    }

    var elapsed = Date.now() - toast.createdAt;
    if (elapsed >= toast.ttl) {
      toast = null;
      return;
    }

    var alpha = elapsed < 1000 ? 1 : 1 - (elapsed - 1000) / 400;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    var w = Math.min(logicalWidth - 48, 220);
    var h = 42;
    var x = (logicalWidth - w) / 2;
    var y = layout.boardY - 58;
    roundRect(x, y, w, h, 21, "rgba(45, 42, 36, 0.88)", true);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 15px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(toast.message, logicalWidth / 2, y + h / 2);
    ctx.restore();
  }

  function drawLeaf(x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.38, size * 0.7, -0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + size * 0.34, y - size * 0.06, size * 0.26, size * 0.52, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSprout(x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, size * 0.13);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.4);
    ctx.lineTo(x, y - size * 0.15);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x - size * 0.35, y - size * 0.12, size * 0.38, size * 0.22, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + size * 0.35, y - size * 0.18, size * 0.38, size * 0.22, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, radius, color, fill) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
})();
