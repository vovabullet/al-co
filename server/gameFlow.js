// Поток игры: сборка/перемешивание колоды, выдача следующей карточки и
// подстановка реальных игроков в карточки с плейсхолдерами ({0}, {1}).
const { state } = require('./state');
const { buildDeck } = require('./contentLoader');

// Случайные n различных игроков из текущего списка.
function pickDistinct(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Подставляет реальных игроков в карточку с плейсхолдерами {0}, {1}, ...
// Резолвится в момент показа карточки, а не при сборке колоды — чтобы
// одна и та же игра при повторе досталась другим игрокам.
function resolveCard(card) {
  if (!card) return null;
  if (!card.targets) return card;
  const chosen = pickDistinct(state.players, card.targets);
  const names = chosen.map((p) => p.name);
  const fill = (s) =>
    typeof s === 'string'
      ? s.replace(/\{(\d+)\}/g, (_, i) => names[i] || 'кто-нибудь')
      : s;
  return {
    ...card,
    text: fill(card.text),
    rules: fill(card.rules),
    note: fill(card.note),
    targets: chosen.map((p) => ({ id: p.id, name: p.name, color: p.color })),
  };
}

// Начинает (или перезапускает) игру: свежая колода, первая карточка.
function startGame() {
  state.deck = buildDeck();
  state.currentIndex = 0;
  state.phase = 'playing';
  state.currentAnswers = {};
  state.current = resolveCard(state.deck[0] || null);
  return state.current;
}

// Следующая карточка. Колода НЕ зацикливается: после последней — конец игры.
function nextCard() {
  if (state.currentIndex >= state.deck.length - 1) {
    state.phase = 'ended';
    state.currentAnswers = {};
    state.current = { type: 'end' };
    return state.current;
  }
  state.currentIndex += 1;
  state.currentAnswers = {};
  state.current = resolveCard(state.deck[state.currentIndex]);
  return state.current;
}

function currentCard() {
  return state.current;
}

module.exports = { startGame, nextCard, currentCard };
