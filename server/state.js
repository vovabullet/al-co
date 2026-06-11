// Единственный источник правды о состоянии игры + операции над списком игроков.
// Одна сессия на весь жизненный цикл приложения (без комнат).
const { randomUUID } = require('crypto');

// Единственный объект состояния игры. Живёт всю сессию приложения.
const state = {
  phase: 'lobby', // 'lobby' | 'playing' | 'ended'
  players: [], // [{ id, name, color, socketId }]
  deck: [], // перемешанная колода карточек
  currentIndex: 0, // индекс текущей карточки в колоде
  current: null, // текущая карточка уже с подставленными игроками (то, что видят клиенты)
  currentAnswers: {}, // ответы на текущий вопрос: playerId -> { text, correct }
};

function addPlayer({ name, color, socketId }) {
  const player = { id: randomUUID(), name, color, socketId };
  state.players.push(player);
  return player;
}

// Удаляет игрока по socketId. Возвращает удалённого игрока или null.
function removePlayer(socketId) {
  const index = state.players.findIndex((p) => p.socketId === socketId);
  if (index === -1) return null;
  const [player] = state.players.splice(index, 1);
  return player;
}

module.exports = { state, addPlayer, removePlayer };
