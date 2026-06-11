// Точка входа: Express раздаёт статику клиентов, Socket.io ведёт всю игру.
// Состояние — только на сервере (state.js); клиенты рисуют и шлют ввод.
// Маршрутизация по событиям: лобби -> колода (gameFlow) -> мини-игры (reaction/tanks).
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { state, addPlayer, removePlayer } = require('./state');
const { startGame, nextCard, currentCard } = require('./gameFlow');
const { loadContent } = require('./contentLoader');
const reaction = require('./reaction');
const tanks = require('./tanks');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

reaction.init(io);
tanks.init(io);

// Дебаг-лог в консоль npm с отметкой времени (п.4 — помогает на вечеринке).
function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('ru-RU')}]`, ...args);
}

const clientDir = path.join(__dirname, '..', 'client');
app.use('/controller', express.static(path.join(clientDir, 'controller')));
app.use(express.static(path.join(clientDir, 'desktop')));

// --- Определение локального IP для QR (телефоны в той же сети) ---
const VIRTUAL_NAME = /(virtualbox|vmware|hyper-v|vethernet|default switch|radmin|hamachi|tailscale|zerotier|loopback|tun|tap|vpn|wsl)/i;

function listIpv4() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push({ name, address: iface.address });
      }
    }
  }
  return out;
}

function scoreIp({ name, address }) {
  let score = 0;
  if (VIRTUAL_NAME.test(name)) score -= 100;
  if (address.startsWith('169.254.')) score -= 80;
  if (address.startsWith('192.168.56.')) score -= 50;
  if (address.startsWith('192.168.')) score += 20;
  else if (address.startsWith('10.')) score += 15;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 5;
  return score;
}

function getLocalIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const candidates = listIpv4();
  if (candidates.length === 0) return 'localhost';
  candidates.sort((a, b) => scoreIp(b) - scoreIp(a));
  return candidates[0].address;
}

const localIp = getLocalIp();
const controllerUrl = `http://${localIp}:${PORT}/controller`;

app.get('/api/lobby-info', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(controllerUrl, { width: 320, margin: 1 });
    res.json({ url: controllerUrl, qr });
  } catch (err) {
    res.status(500).json({ error: 'qr-failed' });
  }
});

// --- Сверка ответов (п.5) ---
function normalize(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/[.!?,]+$/, '');
}

function isCorrect(text, answers) {
  const t = normalize(text);
  return Array.isArray(answers) && answers.some((a) => normalize(a) === t);
}

// --- Управление контроллерами телефонов ---
// Какой интерфейс показать телефону при текущей карточке.
function controllerForCurrent(card) {
  if (card && card.type === 'question') {
    return { layout: 'input', label: 'Твой ответ', question: card.text };
  }
  if (card && card.type === 'end') {
    return { layout: 'idle', message: 'Игра окончена' };
  }
  return { layout: 'idle', message: 'Смотри на экран' };
}

function sendController(socketId, card) {
  io.to(socketId).emit('controller-change', controllerForCurrent(card));
}

// Показ карточки: десктопам — card-update, телефонам — нужный layout.
function broadcastCard(card) {
  // Покидаем мини-игру (если была) — глушим её.
  if (state.currentMiniGame === 'reaction') reaction.stop();
  else if (state.currentMiniGame === 'tanks') tanks.stop();
  state.currentMiniGame = null;

  io.emit('card-update', card);

  // Мини-игры сами управляют телефонами игроков.
  if (card && card.type === 'minigame' && card.name === 'reaction') {
    state.currentMiniGame = 'reaction';
    log(`Мини-игра «Реакция». Игроков: ${state.players.length}`);
    reaction.start();
    return;
  }
  if (card && card.type === 'minigame' && card.name === 'tanks') {
    state.currentMiniGame = 'tanks';
    const drivers = tanks.start();
    log(`Мини-игра «Танки». Водителей: ${drivers.length} из ${state.players.length}`);
    return;
  }

  state.players.forEach((p) => sendController(p.socketId, card));
  if (card && card.type === 'end') {
    log('Игра окончена — колода пройдена');
  } else {
    log(`Карточка ${state.currentIndex + 1}/${state.deck.length}: type=${card && card.type}${card && card.text ? ` — ${card.text}` : ''}`);
  }
}

function handleAnswer(socket, data) {
  const card = currentCard();
  if (!card || card.type !== 'question') return;
  const player = state.players.find((p) => p.socketId === socket.id);
  if (!player) return;
  if (state.currentAnswers[player.id]) return; // один ответ на вопрос
  const text = String((data && data.text) || '').trim();
  if (!text) return;
  const correct = isCorrect(text, card.answers);
  state.currentAnswers[player.id] = { text, correct };
  io.emit('answer-result', {
    playerId: player.id,
    name: player.name,
    color: player.color,
    text,
    correct,
  });
  io.to(socket.id).emit('answer-ack', { correct });
  log(`Ответ ${player.name}: "${text}" -> ${correct ? 'ВЕРНО' : 'неверно'}`);
}

io.on('connection', (socket) => {
  log(`Подключение сокета ${socket.id}`);

  // Пере-синхронизация нового клиента: текущий список игроков (телефоны игнорируют).
  state.players.forEach((p) => socket.emit('player-joined', p));

  // Если игра ИДЁТ (не закончена) — восстанавливаем карточку на перезагруженном десктопе.
  // На стадии 'ended' карточку не шлём: перезагрузка = вернуться в лобби и начать заново.
  // Примечание: живое состояние мини-игры (позиции танков, фаза реакции) не
  // восстанавливается — при перезагрузке десктопа посреди мини-игры проще нажать «Следующее».
  if (state.phase === 'playing') {
    socket.emit('card-update', currentCard());
    Object.entries(state.currentAnswers).forEach(([playerId, r]) => {
      const pl = state.players.find((p) => p.id === playerId);
      if (pl) {
        socket.emit('answer-result', {
          playerId,
          name: pl.name,
          color: pl.color,
          text: r.text,
          correct: r.correct,
        });
      }
    });
  }

  socket.on('join', ({ name, color }) => {
    const player = addPlayer({
      name: String(name || 'Игрок').trim().slice(0, 16) || 'Игрок',
      color: color || '#888888',
      socketId: socket.id,
    });
    socket.emit('joined', { player, players: state.players });
    io.emit('player-joined', player);
    log(`Игрок вошёл: ${player.name} (${player.color}). Всего: ${state.players.length}`);
    // Зашёл в процессе игры — сразу нужный контроллер.
    if (state.phase !== 'lobby') sendController(socket.id, currentCard());
  });

  socket.on('start-game', () => {
    if (state.players.length === 0) return;
    const card = startGame();
    log(`СТАРТ. Игроков: ${state.players.length}, карточек в колоде: ${state.deck.length}`);
    broadcastCard(card);
  });

  socket.on('next-card', () => {
    if (state.phase !== 'playing') return;
    broadcastCard(nextCard());
  });

  socket.on('controller-input', (payload = {}) => {
    const { type, data } = payload;
    if (type === 'answer') {
      handleAnswer(socket, data);
    } else if (type === 'tap') {
      if (reaction.onTap(socket.id)) {
        const p = state.players.find((pp) => pp.socketId === socket.id);
        log(`Реакция: тап от ${p ? p.name : socket.id}`);
      }
    } else if (type === 'move' || type === 'shoot') {
      if (state.currentMiniGame === 'tanks') tanks.routeInput(socket.id, type, data);
    } else {
      log(`controller-input от ${socket.id}: type=${type}`);
    }
  });

  socket.on('disconnect', () => {
    const player = removePlayer(socket.id);
    if (player) {
      io.emit('player-left', { id: player.id });
      log(`Игрок вышел: ${player.name}. Осталось: ${state.players.length}`);
    } else {
      log(`Отключение сокета ${socket.id}`);
    }
  });
});

server.listen(PORT, () => {
  console.log('\n  al-co запущен');
  console.log(`  Главный экран:  http://localhost:${PORT}`);
  console.log(`  Контроллеры:    ${controllerUrl}`);
  try {
    console.log(`  Контента загружено: ${loadContent().length} карточек`);
  } catch (e) {
    console.error(`  ОШИБКА контента: ${e.message}`);
  }
  const others = listIpv4().filter((c) => c.address !== localIp);
  if (others.length) {
    console.log('\n  Если телефоны не подключаются — выбран не тот адрес.');
    console.log('  Другие адреса этой машины:');
    others.forEach((c) => console.log(`    ${c.address}  (${c.name})`));
    console.log('  Запусти с нужным: HOST_IP=192.168.x.x npm start');
  }
  console.log('');
});
