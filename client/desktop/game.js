// Phaser: главный экран мини-игр. Все socket-события приходят в диспетчер внизу
// файла и раздаются активной сцене — так нет двойных подписок при рестарте сцены.

const GAME_W = 800;
const GAME_H = 500;

function hexToInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex || '#888888').color;
}

/* ============================ РЕАКЦИЯ ============================ */
// Серверо-авторитетная: сцена только рисует то, что присылает сервер.
class ReactionScene extends Phaser.Scene {
  constructor() {
    super('Reaction');
  }

  create() {
    const cx = GAME_W / 2;
    this.add.text(cx, 32, 'РЕАКЦИЯ', { fontFamily: 'system-ui', fontSize: '34px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.progress = this.add.text(cx, 74, '', { fontFamily: 'system-ui', fontSize: '20px', color: '#99a0aa' }).setOrigin(0.5);
    this.circle = this.add.circle(cx, 250, 95, 0x444444);
    this.nameText = this.add.text(cx, 120, '', { fontFamily: 'system-ui', fontSize: '30px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.status = this.add.text(cx, 250, '', { fontFamily: 'system-ui', fontSize: '40px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.resultsText = this.add.text(cx, 200, '', { fontFamily: 'system-ui', fontSize: '24px', color: '#ffffff', align: 'center', lineSpacing: 8 }).setOrigin(0.5).setVisible(false);
    this.loserText = this.add.text(cx, 430, '', { fontFamily: 'system-ui', fontSize: '28px', color: '#f1c40f', fontStyle: 'bold', align: 'center', wordWrap: { width: GAME_W - 80 } }).setOrigin(0.5).setVisible(false);
    this.status.setText('Приготовьтесь!');
  }

  setRoundVisible(v) {
    this.circle.setVisible(v);
    this.nameText.setVisible(v);
    this.status.setVisible(v);
  }

  onState(e) {
    if (!e) return;
    if (e.phase === 'ready') this.showReady(e);
    else if (e.phase === 'go') this.showGo(e);
    else if (e.phase === 'result') this.showResult(e);
    else if (e.phase === 'done') this.showDone(e);
  }

  showReady(e) {
    this.setRoundVisible(true);
    this.resultsText.setVisible(false);
    this.loserText.setVisible(false);
    this.tweens.killTweensOf(this.circle);
    this.circle.setScale(1).setFillStyle(hexToInt(e.player.color), 0.25);
    this.nameText.setText(e.player.name);
    this.status.setText('Приготовься…');
    this.progress.setText(`Игрок ${e.index + 1} из ${e.total}`);
  }

  showGo(e) {
    this.circle.setFillStyle(hexToInt(e.player.color), 1);
    this.status.setText('ЖМИ!');
    this.tweens.add({ targets: this.circle, scale: 1.18, duration: 120, yoyo: true, repeat: -1 });
  }

  showResult(e) {
    this.tweens.killTweensOf(this.circle);
    this.circle.setScale(1);
    this.status.setText(e.timedOut ? 'Проспал!' : `${e.rt} мс`);
  }

  showDone(e) {
    this.tweens.killTweensOf(this.circle);
    this.setRoundVisible(false);
    this.progress.setText('Результаты');
    const lines = (e.results || []).map((r, i) => `${i + 1}. ${r.name} — ${r.timedOut ? 'проспал' : r.rt + ' мс'}`);
    this.resultsText.setText(lines.join('\n')).setVisible(true);
    if (e.loser) this.loserText.setText(`🍺 Медленнее всех: ${e.loser.name}\n${e.rule || ''}`).setVisible(true);
  }
}

/* ============================ ТАНКИ ============================ */
// Десктоп-авторитетная: вся физика здесь, сервер только шлёт minigame-input.
const TANK_SPEED = 200;
const BULLET_SPEED = 520;
const SHOOT_COOLDOWN = 450;
const FREEZE_MS = 3000;
const BULLET_LIFE = 2000;
const START_LIVES = 3;

class TanksScene extends Phaser.Scene {
  constructor() {
    super('Tanks');
  }

  init(data) {
    this.roster = (data && data.players) || [];
    this.rule = (data && data.rule) || 'Проигравший — пьёт';
  }

  create() {
    this.tanks = new Map();
    this.over = false;

    this.add.text(GAME_W / 2, 22, 'ТАНКИ', { fontFamily: 'system-ui', fontSize: '26px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);

    this.walls = this.physics.add.staticGroup();
    this.buildArena();

    this.tankGroup = this.physics.add.group();
    this.bullets = this.physics.add.group();

    this.makeBulletTexture();
    this.roster.forEach((p, i) => this.spawnTank(p, i));

    this.physics.add.collider(this.tankGroup, this.walls);
    this.physics.add.collider(this.tankGroup, this.tankGroup);
    this.physics.add.collider(this.bullets, this.walls, (b) => b.destroy());
    this.physics.add.overlap(this.bullets, this.tankGroup, (b, t) => this.onBulletHit(b, t));

    this.banner = this.add.text(GAME_W / 2, GAME_H / 2, '', {
      fontFamily: 'system-ui', fontSize: '30px', color: '#f1c40f', fontStyle: 'bold', align: 'center',
      backgroundColor: '#000000cc', padding: { x: 20, y: 16 }, wordWrap: { width: GAME_W - 120 },
    }).setOrigin(0.5).setDepth(20).setVisible(false);
  }

  buildArena() {
    const t = 16;
    const wall = (x, y, w, h) => {
      const r = this.add.rectangle(x, y, w, h, 0x33343d);
      this.physics.add.existing(r, true);
      this.walls.add(r);
    };
    // границы
    wall(GAME_W / 2, t / 2, GAME_W, t);
    wall(GAME_W / 2, GAME_H - t / 2, GAME_W, t);
    wall(t / 2, GAME_H / 2, t, GAME_H);
    wall(GAME_W - t / 2, GAME_H / 2, t, GAME_H);
    // препятствия
    wall(GAME_W / 2, GAME_H / 2, 180, 22);
    wall(250, 150, 22, 130);
    wall(550, 350, 22, 130);
  }

  makeBulletTexture() {
    if (this.textures.exists('bullet')) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1).fillCircle(6, 6, 6);
    g.generateTexture('bullet', 12, 12);
    g.destroy();
  }

  tankTexture(color) {
    const key = 'tank-' + color;
    if (this.textures.exists(key)) return key;
    const g = this.make.graphics({ add: false });
    g.fillStyle(hexToInt(color), 1).fillRoundedRect(2, 8, 32, 24, 6); // корпус
    g.fillStyle(0xffffff, 1).fillRect(32, 16, 14, 8); // ствол вправо
    g.generateTexture(key, 48, 40);
    g.destroy();
    return key;
  }

  spawnTank(p, i) {
    const spots = [
      { x: 90, y: 90 }, { x: GAME_W - 90, y: 90 },
      { x: 90, y: GAME_H - 90 }, { x: GAME_W - 90, y: GAME_H - 90 },
    ];
    const spot = spots[i % spots.length];
    const tank = this.physics.add.sprite(spot.x, spot.y, this.tankTexture(p.color));
    tank.body.setSize(30, 26);
    tank.setCollideWorldBounds(true);
    tank.playerId = p.id;
    tank.lives = START_LIVES;
    tank.frozen = false;
    tank.dead = false;
    tank.lastShot = 0;
    tank.moveVec = { x: 0, y: 0 };

    tank.label = this.add.text(spot.x, spot.y - 30, p.name, { fontFamily: 'system-ui', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    tank.hearts = this.add.text(spot.x, spot.y + 26, this.heartStr(START_LIVES), { fontFamily: 'system-ui', fontSize: '15px', color: p.color }).setOrigin(0.5).setDepth(5);

    this.tankGroup.add(tank);
    this.tanks.set(p.id, tank);
  }

  heartStr(n) {
    return '♥'.repeat(Math.max(0, n));
  }

  applyInput(e) {
    if (this.over) return;
    const tank = this.tanks.get(e.playerId);
    if (!tank || tank.dead) return;
    if (e.type === 'move') tank.moveVec = e.data || { x: 0, y: 0 };
    else if (e.type === 'shoot') this.fire(tank);
  }

  fire(tank) {
    if (this.over || tank.frozen || tank.dead) return;
    const now = this.time.now;
    if (now - tank.lastShot < SHOOT_COOLDOWN) return;
    tank.lastShot = now;
    const a = tank.rotation;
    const bx = tank.x + Math.cos(a) * 30;
    const by = tank.y + Math.sin(a) * 30;
    const b = this.bullets.create(bx, by, 'bullet');
    b.owner = tank.playerId;
    b.born = now;
    b.body.setCircle(6);
    this.physics.velocityFromRotation(a, BULLET_SPEED, b.body.velocity);
  }

  onBulletHit(bullet, tank) {
    if (this.over || !bullet.active || tank.dead) return;
    if (bullet.owner === tank.playerId) return; // не сам себя
    bullet.destroy();
    if (tank.frozen) return;
    tank.lives -= 1;
    tank.hearts.setText(this.heartStr(tank.lives));
    if (tank.lives <= 0) {
      this.killTank(tank);
      return;
    }
    this.freeze(tank);
  }

  freeze(tank) {
    tank.frozen = true;
    tank.setVelocity(0, 0);
    tank.setTint(0x888888);
    const blink = this.tweens.add({ targets: tank, alpha: 0.3, duration: 200, yoyo: true, repeat: -1 });
    this.time.delayedCall(FREEZE_MS, () => {
      blink.stop();
      if (tank.dead) return;
      tank.frozen = false;
      tank.clearTint();
      tank.setAlpha(1);
    });
  }

  killTank(tank) {
    tank.dead = true;
    tank.setVelocity(0, 0);
    tank.disableBody(true, true);
    tank.label.setVisible(false);
    tank.hearts.setText('💀').setVisible(true);
    tank.hearts.setPosition(tank.x, tank.y);
    this.checkWin();
  }

  // Игрок вышел (закрыл телефон/потерял связь) посреди раунда — убираем его танк
  // целиком, иначе он остаётся «призраком» и победитель не определится.
  // Запись в this.tanks остаётся (dead=true), чтобы this.tanks.size = исходное число.
  removeTank(playerId) {
    const tank = this.tanks.get(playerId);
    if (!tank || tank.dead) return;
    tank.dead = true;
    tank.label.destroy();
    tank.hearts.destroy();
    tank.destroy();
    this.checkWin();
  }

  checkWin() {
    if (this.over) return;
    const alive = [...this.tanks.values()].filter((t) => !t.dead);
    if (this.tanks.size > 1 && alive.length <= 1) {
      this.over = true;
      const winner = alive[0];
      const text = winner ? `🏆 Победитель: ${winner.label.text}\n${this.rule}` : 'Ничья';
      this.banner.setText(text).setVisible(true);
    }
  }

  update() {
    if (!this.tanks) return;
    this.tanks.forEach((tank) => {
      if (tank.dead) return;
      // После победы (over) и во время заморозки танк стоит; иначе едет по джойстику.
      if (this.over || tank.frozen) {
        tank.setVelocity(0, 0);
      } else {
        const v = tank.moveVec || { x: 0, y: 0 };
        const mag = Math.hypot(v.x, v.y);
        if (mag > 0.15) {
          // Вектор джойстика -> угол поворота корпуса и скорость по этому углу.
          const a = Math.atan2(v.y, v.x);
          tank.rotation = a;
          this.physics.velocityFromRotation(a, TANK_SPEED * Math.min(mag, 1), tank.body.velocity);
        } else {
          tank.setVelocity(0, 0);
        }
      }
      // Подписи имени и жизней следуют за танком.
      tank.label.setPosition(tank.x, tank.y - 30);
      if (tank.hearts.text !== '💀') tank.hearts.setPosition(tank.x, tank.y + 26);
    });

    // Снаряды живут ограниченное время, чтобы не копились.
    this.bullets.children.each((b) => {
      if (b.active && this.time.now - b.born > BULLET_LIFE) b.destroy();
    });
  }
}

/* ============================ Phaser game + диспетчер ============================ */
window.alcoGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'minigame',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#1a1b22',
  audio: { noAudio: true },
  physics: { default: 'arcade', arcade: { debug: false, gravity: { x: 0, y: 0 } } },
  scene: [ReactionScene, TanksScene],
});

window.stopMinigames = function () {
  const g = window.alcoGame;
  g.scene.stop('Reaction');
  g.scene.stop('Tanks');
};

(function dispatch() {
  const g = window.alcoGame;
  const sceneIfActive = (key) => {
    const s = g.scene.getScene(key);
    return s && g.scene.isActive(key) ? s : null;
  };

  socket.on('minigame-start', (e) => {
    if (!e) return;
    if (e.name === 'reaction') {
      g.scene.stop('Tanks');
      g.scene.start('Reaction', e);
    } else if (e.name === 'tanks') {
      g.scene.stop('Reaction');
      g.scene.start('Tanks', e);
    }
  });

  socket.on('reaction-state', (e) => {
    const s = sceneIfActive('Reaction');
    if (s) s.onState(e);
  });

  socket.on('minigame-input', (e) => {
    const s = sceneIfActive('Tanks');
    if (s) s.applyInput(e);
  });

  // Игрок отключился во время «Танков» — убираем его танк, чтобы раунд завершился.
  socket.on('player-left', ({ id }) => {
    const s = sceneIfActive('Tanks');
    if (s) s.removeTank(id);
  });
})();
