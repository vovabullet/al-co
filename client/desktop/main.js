const socket = io();

// Дебаг-лог в консоль браузера (DevTools) — п.4.
const DEBUG = true;
const log = (...a) => DEBUG && console.log('[al-co]', ...a);

const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const over = document.getElementById('over');
const rail = document.getElementById('player-rail');
const cardEl = document.getElementById('card');
const answersEl = document.getElementById('answers');
const minigameEl = document.getElementById('minigame');
const nextBtn = document.getElementById('next');
const startBtn = document.getElementById('start');
const countEl = document.getElementById('count');

const qrImg = document.getElementById('qr');
const urlEl = document.getElementById('url');
const reconnectBtn = document.getElementById('reconnect');
const reconnectQr = document.getElementById('reconnect-qr');
const modal = document.getElementById('qr-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalQr = document.getElementById('modal-qr');
const modalUrl = document.getElementById('modal-url');
const modalClose = document.getElementById('modal-close');

// id -> player. Сервер — источник правды, тут только зеркало.
const players = new Map();
// playerId -> DOM-строка результата на текущий вопрос.
const answerRows = new Map();

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function dot(color) {
  const d = el('span', { class: 'dot' });
  d.style.background = color;
  return d;
}

// --- QR / подключение ---
fetch('/api/lobby-info')
  .then((r) => r.json())
  .then(({ url, qr }) => {
    qrImg.src = qr;
    urlEl.textContent = url;
    reconnectQr.src = qr;
    modalQr.src = qr;
    modalUrl.textContent = url;
    log('lobby-info', url);
  })
  .catch(() => {
    urlEl.textContent = 'Не удалось получить адрес сервера';
  });

// Модалка переподключения — чисто клиентская, никаких socket.emit.
reconnectBtn.addEventListener('click', () => {
  modal.hidden = false;
  log('открыто окно переподключения');
});
modalClose.addEventListener('click', () => (modal.hidden = true));
modalBackdrop.addEventListener('click', () => (modal.hidden = true));

// --- Игроки (вертикальный список слева) ---
function renderRail() {
  rail.innerHTML = '';
  for (const p of players.values()) {
    rail.appendChild(el('div', { class: 'rail-row' }, dot(p.color), el('span', { text: p.name })));
  }
  countEl.textContent = players.size;
  startBtn.disabled = players.size === 0;
}

socket.on('connect', () => log('socket connected', socket.id));

socket.on('player-joined', (p) => {
  players.set(p.id, p);
  renderRail();
  log('player-joined', p.name);
});

socket.on('player-left', ({ id }) => {
  const p = players.get(id);
  players.delete(id);
  renderRail();
  log('player-left', p && p.name);
});

// --- Управление игрой ---
startBtn.addEventListener('click', () => {
  socket.emit('start-game');
  log('-> start-game');
});
nextBtn.addEventListener('click', () => {
  socket.emit('next-card');
  log('-> next-card');
});

function showView(name) {
  lobby.hidden = name !== 'lobby';
  game.hidden = name !== 'game';
  over.hidden = name !== 'over';
}

socket.on('card-update', (card) => {
  log('card-update', card && card.type, card && card.text);
  if (!card) return;
  if (card.type === 'end') {
    if (window.stopMinigames) window.stopMinigames();
    showView('over');
    return;
  }
  showView('game');

  if (card.type === 'minigame') {
    // Мини-игру рисует Phaser (game.js слушает свои события).
    cardEl.hidden = true;
    answersEl.hidden = true;
    minigameEl.hidden = false;
    return;
  }

  // Обычная карточка — гасим возможную мини-игру.
  if (window.stopMinigames) window.stopMinigames();
  cardEl.hidden = false;
  answersEl.hidden = false;
  minigameEl.hidden = true;
  answersEl.innerHTML = '';
  answerRows.clear();
  renderCard(card);
});

socket.on('answer-result', (r) => {
  log('answer-result', r.name, r.correct ? 'верно' : 'неверно', `"${r.text}"`);
  addAnswerResult(r);
});

// --- Рендер карточек ---
function renderCard(card) {
  cardEl.innerHTML = '';
  const byType = { question: renderQuestion, task: renderTask, external: renderExternal };
  const render = byType[card.type];
  cardEl.appendChild(render ? render(card) : el('p', { class: 'note', text: card.type }));
}

function renderQuestion(card) {
  const wrap = el('div', { class: 'card question' });
  wrap.appendChild(el('span', { class: 'badge badge-q', text: 'Вопрос' }));
  wrap.appendChild(el('p', { class: 'text', text: card.text }));
  wrap.appendChild(el('p', { class: 'subhint', text: 'Игроки вводят ответ на телефоне' }));
  if (card.penalty) wrap.appendChild(el('p', { class: 'penalty', text: card.penalty }));
  return wrap;
}

function renderTask(card) {
  const wrap = el('div', { class: 'card task' });
  wrap.appendChild(el('span', { class: 'badge badge-t', text: 'Задание' }));
  wrap.appendChild(el('p', { class: 'text', text: card.text }));
  if (card.penalty) wrap.appendChild(el('p', { class: 'penalty', text: card.penalty }));
  return wrap;
}

function renderExternal(card) {
  const wrap = el('div', { class: 'card external' });
  wrap.appendChild(el('span', { class: 'badge badge-e', text: 'Внешняя игра' }));
  wrap.appendChild(el('p', { class: 'game', text: card.game }));
  if (card.rules) wrap.appendChild(el('p', { class: 'text', text: card.rules }));
  if (card.note) wrap.appendChild(el('p', { class: 'note', text: card.note }));
  return wrap;
}

// --- Результаты ответов игроков на текущий вопрос ---
function addAnswerResult(r) {
  let row = answerRows.get(r.playerId);
  if (!row) {
    row = el('div', { class: 'answer-row' });
    answerRows.set(r.playerId, row);
    answersEl.appendChild(row);
  }
  row.innerHTML = '';
  row.classList.toggle('correct', r.correct);
  row.classList.toggle('wrong', !r.correct);
  row.appendChild(dot(r.color));
  row.appendChild(el('span', { class: 'ar-name', text: r.name }));
  row.appendChild(el('span', { class: 'ar-text', text: '«' + r.text + '»' }));
  row.appendChild(el('span', { class: 'ar-mark', text: r.correct ? '✓' : '✗' }));
}

renderRail();
