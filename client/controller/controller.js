const socket = io();

// Дебаг-лог в консоль браузера телефона — п.4.
const DEBUG = true;
const log = (...a) => DEBUG && console.log('[al-co]', ...a);

// Палитра под максимум 8 игроков.
const COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f',
  '#9b59b6', '#e67e22', '#1abc9c', '#e84393',
];

const joinView = document.getElementById('join');
const stageView = document.getElementById('stage');
const nameInput = document.getElementById('name');
const colorsEl = document.getElementById('colors');
const goBtn = document.getElementById('go');
const errEl = document.getElementById('error');
const badge = document.getElementById('badge');
const who = document.getElementById('who');
const layoutEl = document.getElementById('layout');

let selectedColor = COLORS[0];
let answered = false;
let joystick = null; // активный nipplejs-менеджер (чтобы уничтожать при смене layout)

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.id) node.id = opts.id;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

// --- Экран входа ---
COLORS.forEach((color, i) => {
  const swatch = el('button', { class: 'swatch' });
  swatch.style.background = color;
  if (i === 0) swatch.classList.add('selected');
  swatch.addEventListener('click', () => {
    selectedColor = color;
    document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
    swatch.classList.add('selected');
  });
  colorsEl.appendChild(swatch);
});

goBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    errEl.textContent = 'Введи имя';
    errEl.hidden = false;
    return;
  }
  goBtn.disabled = true;
  socket.emit('join', { name, color: selectedColor });
  log('-> join', name, selectedColor);
});

socket.on('connect', () => log('socket connected', socket.id));

socket.on('joined', ({ player }) => {
  joinView.hidden = true;
  stageView.hidden = false;
  badge.style.background = player.color;
  who.textContent = player.name;
  renderIdle({ message: 'Ожидание начала игры…' });
  log('joined as', player.name);
});

// --- Динамическая смена интерфейса контроллера ---
socket.on('controller-change', (opts) => {
  log('controller-change', opts.layout);
  answered = false;
  // Уничтожаем джойстик прошлого layout, если был.
  if (joystick) {
    joystick.destroy();
    joystick = null;
  }
  if (opts.layout === 'input') renderInput(opts);
  else if (opts.layout === 'tap') renderTap(opts);
  else if (opts.layout === 'joystick') renderJoystick(opts);
  else renderIdle(opts);
});

socket.on('answer-ack', ({ correct }) => {
  log('answer-ack', correct);
  const status = layoutEl.querySelector('.status');
  if (status) {
    status.textContent = correct ? 'Верно! ✓' : 'Неверно ✗ — пей';
    status.className = 'status ' + (correct ? 'ok' : 'bad');
  }
});

function renderIdle(opts) {
  layoutEl.innerHTML = '';
  layoutEl.appendChild(el('p', { class: 'status', text: opts.message || 'Смотри на экран' }));
}

// Большая кнопка для мини-игры «Реакция». pointerdown — чтобы не ждать mouseup.
function renderTap(opts) {
  layoutEl.innerHTML = '';
  const btn = el('button', { class: 'tap-btn', text: opts.label || 'ЖМИ' });
  let tapped = false;
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (tapped) return;
    tapped = true;
    socket.emit('controller-input', { type: 'tap' });
    btn.classList.add('pressed');
    btn.textContent = 'Есть!';
    log('-> tap');
  });
  layoutEl.appendChild(btn);
}

// Джойстик (nipplejs) + кнопка огня для мини-игры «Танки».
function renderJoystick() {
  layoutEl.innerHTML = '';
  const zone = el('div', { class: 'joy-zone' });
  const shoot = el('button', { class: 'shoot-btn', text: 'ОГОНЬ' });
  layoutEl.append(zone, shoot);

  joystick = nipplejs.create({
    zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#ffffff',
    size: 130,
  });
  // nipplejs: вектор с осью Y вверх — инвертируем в экранную систему (вниз +).
  joystick.on('move', (evt, data) => {
    if (data && data.vector) {
      socket.emit('controller-input', { type: 'move', data: { x: data.vector.x, y: -data.vector.y } });
    }
  });
  joystick.on('end', () => {
    socket.emit('controller-input', { type: 'move', data: { x: 0, y: 0 } });
  });

  shoot.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    socket.emit('controller-input', { type: 'shoot' });
    shoot.classList.add('firing');
    log('-> shoot');
  });
  const release = () => shoot.classList.remove('firing');
  shoot.addEventListener('pointerup', release);
  shoot.addEventListener('pointerleave', release);
}

function renderInput(opts) {
  layoutEl.innerHTML = '';
  if (opts.question) layoutEl.appendChild(el('p', { class: 'question', text: opts.question }));

  const input = el('input', { id: 'answer-input' });
  input.placeholder = opts.label || 'Твой ответ';
  input.maxLength = 40;
  input.autocomplete = 'off';

  const btn = el('button', { class: 'submit', text: 'Ответить' });
  const status = el('p', { class: 'status' });

  const submit = () => {
    if (answered) return;
    const text = input.value.trim();
    if (!text) {
      status.textContent = 'Введи ответ';
      return;
    }
    answered = true;
    input.disabled = true;
    btn.disabled = true;
    socket.emit('controller-input', { type: 'answer', data: { text } });
    status.textContent = 'Ответ принят, ждём остальных…';
    log('-> answer', text);
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  layoutEl.append(input, btn, status);
}
