// Мини-игра «Файтинг» (1 на 1, MK-подобная) — десктоп-авторитетная, как Танки.
// Сервер выбирает РОВНО 2 бойцов, раздаёт им layout 'fight' и маршрутизирует ввод.
// Вся боёвка (физика, удары, урон) — в Phaser-сцене на главном экране.
const { state } = require('./state');

let io = null;
let fighters = []; // ровно 2 игрока за бойцов
let active = false;

function init(ioRef) {
  io = ioRef;
}

function pub(p) {
  return { id: p.id, name: p.name, color: p.color };
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
  active = true;
  fighters = shuffle(state.players).slice(0, 2);
  const ids = new Set(fighters.map((f) => f.id));

  io.emit('minigame-start', {
    name: 'fighting',
    players: fighters.map(pub),
    rule: (state.current && state.current.penalty) || 'Проигравший — пьёт',
  });

  state.players.forEach((p) => {
    if (ids.has(p.id)) {
      io.to(p.socketId).emit('controller-change', { layout: 'fight' });
    } else {
      io.to(p.socketId).emit('controller-change', {
        layout: 'idle',
        message: 'Бой 1 на 1 — смотри на экран',
      });
    }
  });

  return fighters;
}

// Ввод бойца -> десктопу как minigame-input.
function routeInput(socketId, type, data) {
  if (!active) return;
  const p = state.players.find((pp) => pp.socketId === socketId);
  if (!p) return;
  if (!fighters.some((f) => f.id === p.id)) return; // не боец — игнор
  io.emit('minigame-input', { playerId: p.id, type, data });
}

function stop() {
  active = false;
  fighters = [];
}

function isActive() {
  return active;
}

module.exports = { init, start, stop, routeInput, isActive };
