// Загрузка контента: читает JSON-файлы из /content и собирает перемешанную колоду.
const fs = require('fs');
const path = require('path');

const contentDir = path.join(__dirname, '..', 'content');

function readJson(file) {
  const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');
  return JSON.parse(raw);
}

// Fisher–Yates: честное перемешивание, не мутирует исходный массив.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Читает все файлы контента и склеивает в один массив (без перемешивания).
function loadContent() {
  return [
    ...readJson('questions.json'),
    ...readJson('tasks.json'),
    ...readJson('external-games.json'),
    ...readJson('minigames.json'),
  ];
}

// Свежая перемешанная колода. Читается заново при каждом вызове —
// можно править JSON и начинать новую игру без перезапуска сервера.
function buildDeck() {
  return shuffle(loadContent());
}

module.exports = { loadContent, buildDeck, shuffle };
