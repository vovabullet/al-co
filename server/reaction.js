const { state } = require('./state');

// Мини-игра «Реакция» — вся логика и тайминг на сервере (клиенты только рендерят
// и шлют тап). По очереди для каждого игрока: «приготовься» -> через случайную
// задержку «ЖМИ!» -> игрок тапает -> сервер фиксирует время. Самый медленный пьёт.

let io = null;
let timers = [];
let session = null;

const READY_MIN = 1200; // мин. задержка до «ЖМИ!»
const READY_MAX = 4000; // макс. задержка до «ЖМИ!»
const TAP_TIMEOUT = 5000; // не тапнул за это время — «проспал»
const BETWEEN = 1700; // пауза между игроками
const TIMEOUT_RT = 99999; // штрафное «время» проспавшего

function init(ioRef) {
  io = ioRef;
}

function pub(p) {
  return { id: p.id, name: p.name, color: p.color };
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function idleAll(message) {
  state.players.forEach((p) =>
    io.to(p.socketId).emit('controller-change', { layout: 'idle', message })
  );
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function start() {
  clearTimers();
  const queue = shuffle(state.players);
  session = { queue, index: -1, results: [], goAt: 0, awaiting: null };
  io.emit('minigame-start', { name: 'reaction', players: state.players.map(pub) });
  nextPlayer();
}

function nextPlayer() {
  clearTimers();
  if (!session) return;
  session.index += 1;
  if (session.index >= session.queue.length) return finish();

  const p = session.queue[session.index];
  session.awaiting = null;
  io.emit('reaction-state', {
    phase: 'ready',
    player: pub(p),
    index: session.index,
    total: session.queue.length,
  });
  idleAll('Смотри на экран');
  io.to(p.socketId).emit('controller-change', { layout: 'idle', message: 'Приготовься…' });

  const delay = READY_MIN + Math.random() * (READY_MAX - READY_MIN);
  timers.push(setTimeout(() => go(p), delay));
}

function go(p) {
  if (!session) return;
  session.goAt = Date.now();
  session.awaiting = p.id;
  io.emit('reaction-state', { phase: 'go', player: pub(p) });
  io.to(p.socketId).emit('controller-change', { layout: 'tap', label: 'ЖМИ!' });
  timers.push(setTimeout(() => record(p, TIMEOUT_RT, true), TAP_TIMEOUT));
}

// Тап от телефона. Возвращает true, если это был ожидаемый игрок.
function onTap(socketId) {
  if (!session || !session.awaiting) return false;
  const p = session.queue[session.index];
  if (!p || p.socketId !== socketId) return false;
  record(p, Date.now() - session.goAt, false);
  return true;
}

function record(p, rt, timedOut) {
  if (!session || session.awaiting !== p.id) return;
  session.awaiting = null;
  clearTimers();
  session.results.push({ id: p.id, name: p.name, color: p.color, rt, timedOut });
  io.emit('reaction-state', { phase: 'result', player: pub(p), rt, timedOut });
  io.to(p.socketId).emit('controller-change', {
    layout: 'idle',
    message: timedOut ? 'Проспал!' : `${rt} мс`,
  });
  timers.push(setTimeout(nextPlayer, BETWEEN));
}

function finish() {
  clearTimers();
  const results = session.results.slice().sort((a, b) => a.rt - b.rt);
  const loser = results.length ? results[results.length - 1] : null;
  const rule = (state.current && state.current.penalty) || 'Самый медленный — пьёт';
  io.emit('reaction-state', { phase: 'done', results, loser, rule });
  idleAll('Смотри на экран');
  session = null;
}

function stop() {
  clearTimers();
  session = null;
}

function isActive() {
  return session !== null;
}

module.exports = { init, start, stop, onTap, isActive };
