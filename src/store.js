'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'game.json');
const TMP_FILE = path.join(DATA_DIR, 'game.json.tmp');

const SAVE_DEBOUNCE_MS = 400;

let persistTimer = null;
let pendingState = null;

function emptyState() {
  return { rooms: {} };
}

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return emptyState();
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.rooms) {
      return emptyState();
    }
    return parsed;
  } catch (err) {
    console.error('[store] не удалось прочитать game.json, стартуем с пустого состояния:', err.message);
    return emptyState();
  }
}

function writeNow(state) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf8');
  fs.renameSync(TMP_FILE, DATA_FILE);
}

function save(state) {
  pendingState = state;
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = pendingState;
    pendingState = null;
    try {
      writeNow(snapshot);
    } catch (err) {
      console.error('[store] ошибка записи:', err.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

function flush() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (pendingState) {
    try {
      writeNow(pendingState);
    } catch (err) {
      console.error('[store] ошибка flush:', err.message);
    }
    pendingState = null;
  }
}

module.exports = { load, save, flush, DATA_FILE };
