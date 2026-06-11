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

/* ============================ ФАЙТИНГ (1 на 1) ============================ */
// Десктоп-авторитетная, как Танки: физика и боёвка здесь, сервер шлёт minigame-input
// с type:'fight'. Спрайты бойцов рисуются процедурно (offline-safe), 2 игрока.
const FIGHT_GRAVITY = 900;
const FIGHT_WALK = 175;
const FIGHT_JUMP = 430;
const FIGHT_MAX_HP = 100;
const GROUND_H = 44;
const HITSTUN = 320; // мс оглушения после пропущенного удара
// Параметры ударов: окно попадания, урон, дальность (между центрами), отбрасывание.
const ATTACKS = {
  punch: { dur: 280, hitStart: 70, hitEnd: 170, dmg: 8, range: 78, kb: 140 },
  kick: { dur: 440, hitStart: 150, hitEnd: 290, dmg: 15, range: 86, kb: 220 },
};

class FightScene extends Phaser.Scene {
  constructor() {
    super('Fight');
  }

  init(data) {
    this.roster = (data && data.players) || [];
    this.rule = (data && data.rule) || 'Проигравший — пьёт';
  }

  create() {
    this.over = false;
    // В этой сцене своя гравитация (вид сбоку); на Танки/Реакцию не влияет.
    this.physics.world.gravity.y = FIGHT_GRAVITY;
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);

    this.add.text(GAME_W / 2, 12, 'ФАЙТИНГ', { fontFamily: 'system-ui', fontSize: '22px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(10);

    // Земля
    const ground = this.add.rectangle(GAME_W / 2, GAME_H - GROUND_H / 2, GAME_W, GROUND_H, 0x2b2c34);
    this.physics.add.existing(ground, true);

    this.fighters = new Map();
    const sides = ['left', 'right'];
    this.roster.slice(0, 2).forEach((p, i) => this.spawnFighter(p, sides[i]));

    const arr = [...this.fighters.values()];
    arr.forEach((f) => this.physics.add.collider(f.sprite, ground));
    if (arr.length === 2) this.physics.add.collider(arr[0].sprite, arr[1].sprite);

    this.banner = this.add.text(GAME_W / 2, GAME_H / 2 - 30, '', {
      fontFamily: 'system-ui', fontSize: '30px', color: '#f1c40f', fontStyle: 'bold', align: 'center',
      backgroundColor: '#000000cc', padding: { x: 20, y: 16 }, wordWrap: { width: GAME_W - 120 },
    }).setOrigin(0.5).setDepth(20).setVisible(false);
  }

  // Текстуры бойца по позе (одинаковый размер канваса, чтобы при смене не дёргалось).
  fighterTexture(color, pose) {
    const key = `ftr-${color}-${pose}`;
    if (this.textures.exists(key)) return key;
    const W = 84, H = 104, cx = 42;
    const col = hexToInt(color);
    const skin = 0xf2d2b6;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0x222831, 1); // ноги
    g.fillRect(cx - 12, 70, 9, 32);
    g.fillRect(cx + 3, 70, 9, 32);
    g.fillStyle(col, 1); // торс
    g.fillRoundedRect(cx - 14, 30, 28, 42, 6);
    g.fillStyle(skin, 1); // голова
    g.fillCircle(cx, 20, 12);
    g.fillStyle(col, 1); // руки по позе (базовая поза смотрит вправо)
    if (pose === 'attack') {
      g.fillRect(cx - 20, 36, 8, 22);
      g.fillRect(cx + 8, 40, 24, 8);
      g.fillStyle(skin, 1);
      g.fillCircle(cx + 34, 44, 6);
    } else if (pose === 'block') {
      g.fillRect(cx - 20, 36, 8, 22);
      g.fillRect(cx + 8, 26, 10, 36);
    } else {
      g.fillRect(cx - 20, 36, 8, 26);
      g.fillRect(cx + 12, 36, 8, 26);
    }
    g.generateTexture(key, W, H);
    g.destroy();
    return key;
  }

  spawnFighter(p, side) {
    const x = side === 'left' ? 180 : GAME_W - 180;
    const sprite = this.physics.add.sprite(x, 200, this.fighterTexture(p.color, 'idle'));
    sprite.body.setSize(34, 92);
    sprite.body.setOffset((84 - 34) / 2, 10);
    sprite.setCollideWorldBounds(true);

    const f = {
      id: p.id, name: p.name, color: p.color, sprite,
      hp: FIGHT_MAX_HP, walkDir: 0, blocking: false,
      attacking: false, attackType: null, attackStart: 0, attackEnd: 0, hitDone: false,
      cooldownUntil: 0, hitstunUntil: 0, dead: false, curPose: 'idle',
      facing: side === 'left' ? 1 : -1,
    };
    this.createFighterUI(f, side);
    this.fighters.set(p.id, f);
  }

  createFighterUI(f, side) {
    const maxW = 300, h = 24, y = 34;
    const x = side === 'left' ? 30 : GAME_W - 30;
    const ox = side === 'left' ? 0 : 1;
    f.hpMaxW = maxW;
    this.add.rectangle(x, y, maxW, h, 0x000000, 0.45).setOrigin(ox, 0.5).setStrokeStyle(2, 0x666666).setDepth(8);
    f.hpFill = this.add.rectangle(x, y, maxW, h, 0x2ecc71).setOrigin(ox, 0.5).setDepth(9);
    this.add.text(x, y + 16, f.name, { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold' }).setOrigin(ox, 0).setColor(f.color).setDepth(9);
  }

  opponent(f) {
    for (const o of this.fighters.values()) if (o.id !== f.id) return o;
    return null;
  }

  canAct(f) {
    return !this.over && !f.dead && this.time.now >= f.hitstunUntil && !f.attacking;
  }

  onGround(f) {
    return f.sprite.body.blocked.down || f.sprite.body.touching.down;
  }

  applyInput(e) {
    if (this.over) return;
    const f = this.fighters.get(e.playerId);
    if (!f || f.dead) return;
    const d = e.data || {};
    switch (d.action) {
      case 'move':
        f.walkDir = d.dir | 0;
        break;
      case 'jump':
        if (this.canAct(f) && !f.blocking && this.onGround(f)) f.sprite.body.setVelocityY(-FIGHT_JUMP);
        break;
      case 'punch':
        this.startAttack(f, 'punch');
        break;
      case 'kick':
        this.startAttack(f, 'kick');
        break;
      case 'block':
        f.blocking = !!d.pressed;
        break;
    }
  }

  startAttack(f, type) {
    if (!this.canAct(f) || f.blocking) return;
    const now = this.time.now;
    if (now < f.cooldownUntil) return;
    const A = ATTACKS[type];
    f.attacking = true;
    f.attackType = type;
    f.attackStart = now;
    f.attackEnd = now + A.dur;
    f.hitDone = false;
    f.cooldownUntil = now + A.dur + 90;
  }

  updatePose(f) {
    let pose = 'idle';
    if (!f.dead) {
      if (f.attacking) pose = 'attack';
      else if (f.blocking) pose = 'block';
    }
    if (pose !== f.curPose) {
      f.sprite.setTexture(this.fighterTexture(f.color, pose));
      f.sprite.body.setSize(34, 92);
      f.sprite.body.setOffset((84 - 34) / 2, 10);
      f.curPose = pose;
    }
  }

  updateBar(f) {
    const ratio = Math.max(0, f.hp) / FIGHT_MAX_HP;
    f.hpFill.displayWidth = f.hpMaxW * ratio;
    f.hpFill.setFillStyle(ratio > 0.5 ? 0x2ecc71 : ratio > 0.25 ? 0xf1c40f : 0xe74c3c);
  }

  flash(f, color) {
    f.sprite.setTint(color);
    this.time.delayedCall(150, () => {
      if (!f.dead) f.sprite.clearTint();
    });
  }

  resolveHit(attacker, opp, A) {
    const dir = opp.sprite.x < attacker.sprite.x ? -1 : 1;
    if (opp.blocking) {
      opp.hp = Math.max(0, opp.hp - 1); // чип-урон сквозь блок
      opp.sprite.body.setVelocityX(dir * 90);
      this.flash(opp, 0x66ccff);
    } else {
      opp.hp = Math.max(0, opp.hp - A.dmg);
      opp.hitstunUntil = this.time.now + HITSTUN;
      opp.sprite.body.setVelocityX(dir * A.kb);
      opp.sprite.body.setVelocityY(-130);
      this.flash(opp, 0xff5555);
    }
    if (opp.hp <= 0) this.ko(attacker, opp);
  }

  ko(winner, loser) {
    if (this.over) return;
    this.over = true;
    loser.dead = true;
    loser.sprite.setVelocity(0, 0);
    loser.sprite.setTint(0x555555);
    this.updateBar(loser);
    this.banner.setText(`🏆 Победитель: ${winner.name}\n${this.rule}`).setVisible(true);
  }

  // Боец вышел (закрыл телефон) — другой побеждает, раунд завершается.
  removePlayer(id) {
    const f = this.fighters.get(id);
    if (!f || f.dead || this.over) return;
    const opp = this.opponent(f);
    f.dead = true;
    f.sprite.setVisible(false);
    f.sprite.setVelocity(0, 0);
    this.updateBar(f);
    if (opp && !opp.dead) this.ko(opp, f);
    else {
      this.over = true;
      this.banner.setText('Бой прерван').setVisible(true);
    }
  }

  update() {
    if (!this.fighters) return;
    const now = this.time.now;
    const arr = [...this.fighters.values()];

    arr.forEach((f) => {
      if (f.dead) {
        f.sprite.body.setVelocityX(0);
        this.updatePose(f);
        this.updateBar(f);
        return;
      }
      // Всегда смотрим на соперника (флип спрайта).
      const opp = this.opponent(f);
      if (opp && !opp.dead) f.facing = opp.sprite.x < f.sprite.x ? -1 : 1;
      f.sprite.flipX = f.facing < 0;

      if (f.attacking && now >= f.attackEnd) {
        f.attacking = false;
        f.attackType = null;
      }

      // Горизонтальная скорость: стоим при over/атаке/блоке; в оглушении — инерция отбрасывания.
      const inStun = now < f.hitstunUntil;
      if (this.over) f.sprite.body.setVelocityX(0);
      else if (inStun) { /* несёт отбрасыванием */ }
      else if (f.attacking || f.blocking) f.sprite.body.setVelocityX(0);
      else f.sprite.body.setVelocityX(f.walkDir * FIGHT_WALK);

      this.updatePose(f);
      this.updateBar(f);
    });

    // Разрешение попаданий в активном окне удара.
    if (!this.over) {
      arr.forEach((f) => {
        if (f.dead || !f.attacking || f.hitDone) return;
        const A = ATTACKS[f.attackType];
        const t = now - f.attackStart;
        if (t < A.hitStart || t > A.hitEnd) return;
        const opp = this.opponent(f);
        if (!opp || opp.dead) return;
        const dx = Math.abs(opp.sprite.x - f.sprite.x);
        const dy = Math.abs(opp.sprite.y - f.sprite.y);
        if (dx <= A.range && dy < 72) {
          f.hitDone = true;
          this.resolveHit(f, opp, A);
        }
      });
    }
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
  scene: [ReactionScene, TanksScene, FightScene],
});

const MINIGAME_SCENES = ['Reaction', 'Tanks', 'Fight'];

window.stopMinigames = function () {
  const g = window.alcoGame;
  MINIGAME_SCENES.forEach((k) => g.scene.stop(k));
};

(function dispatch() {
  const g = window.alcoGame;
  const sceneIfActive = (key) => {
    const s = g.scene.getScene(key);
    return s && g.scene.isActive(key) ? s : null;
  };
  // Запускаем нужную сцену, останавливая все остальные мини-игры.
  const startScene = (key, e) => {
    MINIGAME_SCENES.forEach((k) => {
      if (k !== key) g.scene.stop(k);
    });
    g.scene.start(key, e);
  };

  socket.on('minigame-start', (e) => {
    if (!e) return;
    if (e.name === 'reaction') startScene('Reaction', e);
    else if (e.name === 'tanks') startScene('Tanks', e);
    else if (e.name === 'fighting') startScene('Fight', e);
  });

  socket.on('reaction-state', (e) => {
    const s = sceneIfActive('Reaction');
    if (s) s.onState(e);
  });

  // Ввод мини-игры — активной сцене (у Танков и Файтинга единый канал minigame-input).
  socket.on('minigame-input', (e) => {
    const t = sceneIfActive('Tanks');
    if (t) return t.applyInput(e);
    const f = sceneIfActive('Fight');
    if (f) return f.applyInput(e);
  });

  // Игрок отключился во время мини-игры — убираем его, чтобы раунд завершился.
  socket.on('player-left', ({ id }) => {
    const t = sceneIfActive('Tanks');
    if (t) t.removeTank(id);
    const f = sceneIfActive('Fight');
    if (f) f.removePlayer(id);
  });
})();
