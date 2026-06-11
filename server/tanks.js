const { state } = require('./state');

// Мини-игра «Танки» — десктоп-авторитетная: вся физика в Phaser на главном экране.
// Сервер только выбирает до 4 водителей, раздаёт им джойстик и МАРШРУТИЗИРУЕТ ввод.

let io = null;
let drivers = []; // игроки за рулём (макс 4)
let active = false;

const MAX_DRIVERS = 4;

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
  drivers = shuffle(state.players).slice(0, MAX_DRIVERS);
  const driverIds = new Set(drivers.map((d) => d.id));

  io.emit('minigame-start', {
    name: 'tanks',
    players: drivers.map(pub),
    rule: (state.current && state.current.penalty) || 'Проигравший — пьёт',
  });

  state.players.forEach((p) => {
    if (driverIds.has(p.id)) {
      io.to(p.socketId).emit('controller-change', { layout: 'joystick' });
    } else {
      io.to(p.socketId).emit('controller-change', {
        layout: 'idle',
        message: 'Играют другие — смотри на экран',
      });
    }
  });

  return drivers;
}

// Ввод от телефона водителя -> десктопу как minigame-input.
function routeInput(socketId, type, data) {
  if (!active) return;
  const p = state.players.find((pp) => pp.socketId === socketId);
  if (!p) return;
  if (!drivers.some((d) => d.id === p.id)) return; // не водитель — игнор
  io.emit('minigame-input', { playerId: p.id, type, data });
}

function stop() {
  active = false;
  drivers = [];
}

function isActive() {
  return active;
}

module.exports = { init, start, stop, routeInput, isActive };
