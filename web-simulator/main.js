// Simulador inspirado en las clases de Unity: Enumeraciones, Datos*, Generadores y UI.
// Todo corre en canvas + JS puro para que se pueda servir con Live Server sin backend.

// === Enumeraciones ===
const Salud = { SANA: "Sana", TOCADA: "Tocada", MUERTA: "Muerta" };
const Rol = { OBRERA: "Obrera", EXPLORADORA: "Exploradora", VIGIA: "Vigía" };
const TipoComida = { AZUCAR: "Azúcar", PROTEINA: "Proteína" };
const TipoHormona = { CAMINO: "Camino", ALARMA: "Alarma" };

let nextId = 1;
const randomId = () => nextId++;

// === Escala realista (mm -> px) ===
const MILLIMETERS_PER_PIXEL = 1; // 1 px ~ 1 mm para un área de ~0.9 x 0.6 m
const ANT_LENGTH_MM = 6;
const ANT_WIDTH_MM = 2.5;
const FOOD_DIAMETER_MM = 14;
const PHEROMONE_DIAMETER_MM = 8;
const ANT_SPEED_MM_S = 30; // ~3 cm/s (obrera pequeña) en escala 1x
const CARRY_CAPACITY = 12; // unidades máximas que carga una hormiga en un viaje
const FOOD_CONSUMPTION_PER_SEC = 8; // unidades abstractas por segundo al entrar en contacto
const ANT_SENSE_RADIUS_PX = 60; // rango de atracción hacia comida cercana y hormonas
const ANT_LIFESPAN_SECONDS = 30 * 24 * 60 * 60; // 30 días de vida
const MAX_TIME_SCALE = 24 * 60; // 1 día por minuto
const FOOD_TRAIL_DURATION = 12; // segundos que una hormiga mantiene rastro de comida
const HARVEST_DURATION = 3.5; // segundos que tarda en recolectar en el punto de comida
const COLONY_REST_DURATION = 2; // segundos de permanencia en el hormiguero antes de salir
const WEAK_PHEROMONE_STRENGTH = 0.35; // rastro tenue para exploración y guía de regreso
const STRONG_PHEROMONE_STRENGTH = 1.2; // rastro denso cuando se encuentra comida
const COLONY_RADIUS_PX = 22;

// === Entidades ===
class Ant {
  constructor(x, y, role) {
    this.id = randomId();
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.2;
    this.vy = (Math.random() - 0.5) * 0.2;
    this.role = role;
    this.health = 100;
    this.salud = Salud.SANA;
    this.carrying = 0;
    this.lastPheromone = 0;
    this.foodTrailTimer = 0;
    this.collectTimer = 0;
    this.collectingFood = null;
    this.lastFoodId = null;
    this.colonyRestTimer = 0;
    this.lastFollowedId = null;
    this.lastFollowedDuration = 0;
    this.lastDir = { x: 1, y: 0 };
    this.lengthPx = ANT_LENGTH_MM / MILLIMETERS_PER_PIXEL;
    this.widthPx = ANT_WIDTH_MM / MILLIMETERS_PER_PIXEL;
  }

  update(dt, bounds, pheromones, pheromoneRate, foodList, colony) {
    const speed = ANT_SPEED_MM_S / MILLIMETERS_PER_PIXEL;
    const jitter = 0.15;

    const isReturning = this.carrying > 0;
    const collecting = this.collectTimer > 0;
    const resting = this.colonyRestTimer > 0;

    // Temporizadores de recolección y descanso
    this.collectTimer = Math.max(0, this.collectTimer - dt);
    this.colonyRestTimer = Math.max(0, this.colonyRestTimer - dt);

    // Pequeña deriva aleatoria
    if (!collecting && !resting) {
      this.vx += (Math.random() - 0.5) * jitter;
      this.vy += (Math.random() - 0.5) * jitter;
    } else {
      this.vx *= 0.85;
      this.vy *= 0.85;
    }

    // Orientarse hacia hormonas (prioriza ALARMA y evita quedarse pegada a una sola)
    let targetDx = 0;
    let targetDy = 0;
    let hasTarget = false;
    let bestWeight = 0;
    let targetSource = null;
    if (pheromones && pheromones.length) {
      const allowWeakTrail = isReturning; // las débiles solo guían al volver
      const colonyDirX = colony ? colony.x - this.x : 0;
      const colonyDirY = colony ? colony.y - this.y : 0;
      const colonyLen = Math.hypot(colonyDirX, colonyDirY) || 1;
      for (const p of pheromones) {
        if (!p.fromFood && (!allowWeakTrail || p.tipo !== TipoHormona.CAMINO)) continue;
        if (p.ownerId === this.id && isReturning) continue; // evita quedarse en su propio rastro denso
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > ANT_SENSE_RADIUS_PX * ANT_SENSE_RADIUS_PX || d2 < 25) continue; // ignora las muy cercanas
        const dist = Math.sqrt(d2);
        const dirMag = Math.hypot(this.vx, this.vy) || 1;
        const dot = (this.vx / dirMag) * (dx / dist) + (this.vy / dirMag) * (dy / dist);
        const forwardBias = Math.max(0, dot) + 0.4; // prefiere las que están delante
        const decayWithDistance = 1 / (1 + dist * 0.015);
        const base = p.fromFood ? 1.8 : 0.06; // el rastro débil casi no desvía a exploradoras
        let homeBias = 1;
        if (!p.fromFood && p.homeDir) {
          const align = (p.homeDir.x * colonyDirX + p.homeDir.y * colonyDirY) / colonyLen;
          homeBias = Math.max(0.25, align + 0.6);
        }
        const weight = base * (p.intensity + 0.1) * forwardBias * decayWithDistance * homeBias;
        if (weight > bestWeight) {
          bestWeight = weight;
          targetDx = dx;
          targetDy = dy;
          hasTarget = true;
          targetSource = p;
        }
      }
    }

    // Orientarse suavemente hacia la comida cercana
    if (!isReturning && foodList && foodList.length) {
      let nearest = null;
      let nearestDist2 = Infinity;
      for (const food of foodList) {
        const dx = food.x - this.x;
        const dy = food.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestDist2 && d2 < ANT_SENSE_RADIUS_PX * ANT_SENSE_RADIUS_PX) {
          nearestDist2 = d2;
          nearest = food;
        }
      }
      if (nearest) {
        const dx = nearest.x - this.x;
        const dy = nearest.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        targetDx = targetDx * 0.6 + (dx / len) * 0.4;
        targetDy = targetDy * 0.6 + (dy / len) * 0.4;
        hasTarget = true;
      }
    }

    // Regreso directo a la colonia cargando comida
    if (isReturning && colony) {
      const dx = colony.x - this.x;
      const dy = colony.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      targetDx = dx / len;
      targetDy = dy / len;
      hasTarget = true;
    }

    if (hasTarget) {
      if (targetSource && this.lastFollowedId === targetSource.id) {
        this.lastFollowedDuration += dt;
      } else {
        this.lastFollowedId = targetSource ? targetSource.id : null;
        this.lastFollowedDuration = 0;
      }

      // Si lleva demasiado tiempo persiguiendo la misma hormona sin avanzar, descártala
      if (targetSource && this.lastFollowedDuration > 1.4) {
        this.lastFollowedId = null;
        this.lastFollowedDuration = 0;
        hasTarget = false;
      }
    }

    if (hasTarget) {
      const len = Math.hypot(targetDx, targetDy) || 1;
      this.vx = this.vx * 0.82 + (targetDx / len) * 0.18;
      this.vy = this.vy * 0.82 + (targetDy / len) * 0.18;
      this.lastDir = { x: targetDx / len, y: targetDy / len };
    }

    // Limitar la magnitud para mantener velocidad acorde al tamaño
    const mag = Math.hypot(this.vx, this.vy) || 1;
    const capped = Math.min(mag, 1);
    this.vx = (this.vx / mag) * capped;
    this.vy = (this.vy / mag) * capped;

    if (!collecting && !resting) {
      this.x += this.vx * dt * speed;
      this.y += this.vy * dt * speed;
    }

    // Espacio libre: envolver (toroidal) para evitar rebotes en bordes
    if (this.x < 0) this.x += bounds.width;
    if (this.x > bounds.width) this.x -= bounds.width;
    if (this.y < 0) this.y += bounds.height;
    if (this.y > bounds.height) this.y -= bounds.height;

    // Degradación de salud
    const decayPerSecond = 100 / ANT_LIFESPAN_SECONDS;
    this.health -= dt * decayPerSecond; // mapea 100% a 30 días
    if (this.health <= 0) this.salud = Salud.MUERTA;
    else if (this.health < 30) this.salud = Salud.TOCADA;
    else this.salud = Salud.SANA;

    // Deja rastro
    this.lastPheromone += dt;
    this.foodTrailTimer = Math.max(0, this.foodTrailTimer - dt);
    const canDrop = !collecting && !resting && this.lastPheromone >= pheromoneRate;
    if (canDrop) {
      let shouldDrop = false;
      let fromFood = false;
      let tipo = TipoHormona.CAMINO;
      let strength = WEAK_PHEROMONE_STRENGTH;
      let sourceFoodId = null;
      const homeDir = colony ? { x: colony.x - this.x, y: colony.y - this.y } : null;

      if (isReturning && this.carrying > 0) {
        shouldDrop = true;
        fromFood = true;
        tipo = TipoHormona.ALARMA;
        strength = STRONG_PHEROMONE_STRENGTH;
        sourceFoodId = this.lastFoodId;
      } else if (!isReturning) {
        shouldDrop = true;
        fromFood = this.foodTrailTimer > 0;
        tipo = fromFood ? TipoHormona.ALARMA : TipoHormona.CAMINO;
        strength = fromFood ? STRONG_PHEROMONE_STRENGTH : WEAK_PHEROMONE_STRENGTH;
        sourceFoodId = fromFood ? this.lastFoodId : null;
      }

      if (shouldDrop) {
        pheromones.push(
          new Pheromone(this.x, this.y, tipo, fromFood, strength, this.id, sourceFoodId, homeDir)
        );
        this.lastPheromone = 0;
      }
    }
  }
}

class Food {
  constructor(x, y) {
    this.id = randomId();
    this.x = x;
    this.y = y;
    this.quantity = Math.floor(Math.random() * 40) + 10;
    this.type = Math.random() > 0.5 ? TipoComida.AZUCAR : TipoComida.PROTEINA;
    this.timeToLive = 80 + Math.random() * 40;
    this.radiusPx = (FOOD_DIAMETER_MM / MILLIMETERS_PER_PIXEL) / 2;
  }

  update(dt) {
    this.timeToLive -= dt;
    if (this.timeToLive <= 0) this.quantity = 0;
  }
}

class Pheromone {
  constructor(
    x,
    y,
    tipo,
    fromFood = false,
    strength = 1,
    ownerId = null,
    sourceFoodId = null,
    homeDir = null
  ) {
    this.id = randomId();
    this.x = x;
    this.y = y;
    this.tipo = tipo;
    this.fromFood = fromFood;
    this.strength = strength;
    this.ownerId = ownerId;
    this.sourceFoodId = sourceFoodId;
    this.intensity = Math.min(1.2, strength);
    this.radiusPx = (PHEROMONE_DIAMETER_MM / MILLIMETERS_PER_PIXEL) / 2;
    if (homeDir) {
      const len = Math.hypot(homeDir.x, homeDir.y) || 1;
      this.homeDir = { x: homeDir.x / len, y: homeDir.y / len };
    } else {
      this.homeDir = null;
    }
  }

  update(dt) {
    const decayRate = 0.08 / (0.5 + this.strength);
    this.intensity = Math.max(0, this.intensity - dt * decayRate);
  }
}

// === Gestor principal ===
class Simulation {
  constructor(canvas, infoEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.infoEl = infoEl;
    this.ants = [];
    this.food = [];
    this.pheromones = [];
    this.colony = { x: canvas.width / 2, y: canvas.height / 2, stock: 0, kind: "colony" };
    this.running = false;
    this.selected = null;
    this.lastTick = performance.now();
    this.pheromoneRate = 2;
    this.timeScale = 1;
    this.statusHook = null;
    this.handleClick = this.handleClick.bind(this);
    canvas.addEventListener("click", this.handleClick);
  }

  reset({ antCount, foodCount, pheromoneRate, timeScale }) {
    this.ants = [];
    this.food = [];
    this.pheromones = [];
    this.colony = { x: this.canvas.width / 2, y: this.canvas.height / 2, stock: 0, kind: "colony" };
    this.selected = null;
    this.running = false;
    this.pheromoneRate = pheromoneRate;
    this.timeScale = timeScale;

    const { width, height } = this.canvas;
    const roles = Object.values(Rol);
    for (let i = 0; i < antCount; i++) {
      const role = roles[i % roles.length];
      this.ants.push(new Ant(Math.random() * width, Math.random() * height, role));
    }

    for (let i = 0; i < foodCount; i++) {
      this.food.push(new Food(Math.random() * width, Math.random() * height));
    }
    this.lastTick = performance.now();
    this.draw();
    this.renderInfo();
    this.setStatus(
      "Listo",
      `Hormigas: ${this.ants.length} | Comida: ${this.food.length} | Hormonas: ${this.pheromones.length}`,
      "ready"
    );
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    this.setStatus("En ejecución", "La simulación está corriendo", "running");
    requestAnimationFrame(() => this.loop());
  }

  pause() {
    this.running = false;
    this.setStatus("Pausada", "Pulsa reanudar para continuar", "paused");
  }

  spawnFood(amount = 3) {
    const { width, height } = this.canvas;
    for (let i = 0; i < amount; i++) {
      this.food.push(new Food(Math.random() * width, Math.random() * height));
    }
    this.setStatus("Comida añadida", `Total de comida: ${this.food.length}`, "info");
    this.renderInfo();
    this.draw();
  }

  pulsePheromones(amount = 12) {
    const { width, height } = this.canvas;
    for (let i = 0; i < amount; i++) {
      const px = Math.random() * width;
      const py = Math.random() * height;
      this.pheromones.push(
        new Pheromone(px, py, TipoHormona.CAMINO, false, 1, null, null, {
          x: this.colony.x - px,
          y: this.colony.y - py,
        })
      );
    }
    this.setStatus("Pulso de hormonas", `Hormonas activas: ${this.pheromones.length}`, "info");
    this.draw();
  }

  loop() {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const scaledDt = Math.min(dt * this.timeScale, 30); // permite 1 día/min sin saltos infinitos
    this.update(scaledDt);
    this.draw();
    requestAnimationFrame(() => this.loop());
  }

  update(dt) {
    const bounds = { width: this.canvas.width, height: this.canvas.height };
    this.ants.forEach((a) => a.update(dt, bounds, this.pheromones, this.pheromoneRate, this.food, this.colony));
    this.food.forEach((f) => f.update(dt));
    this.pheromones.forEach((p) => p.update(dt));

    // Alimentación: al tocar comida se consume y la hormiga se rehidrata
    for (const ant of this.ants) {
      if (ant.carrying > 0 || ant.collectTimer > 0) continue;
      for (const food of this.food) {
        if (food.quantity <= 0) continue;
        const dx = ant.x - food.x;
        const dy = ant.y - food.y;
        const touchDistance = food.radiusPx + ant.lengthPx * 0.4;
        if (dx * dx + dy * dy <= touchDistance * touchDistance) {
          ant.collectTimer = HARVEST_DURATION;
          ant.collectingFood = food;
          ant.lastFoodId = food.id;
          ant.vx = 0;
          ant.vy = 0;
          // Marca el hallazgo con un rastro denso
          ant.foodTrailTimer = FOOD_TRAIL_DURATION;
          const homeDir = colony ? { x: colony.x - ant.x, y: colony.y - ant.y } : null;
          this.pheromones.push(
            new Pheromone(
              ant.x,
              ant.y,
              TipoHormona.ALARMA,
              true,
              STRONG_PHEROMONE_STRENGTH,
              ant.id,
              food.id,
              homeDir
            )
          );
        }
      }
    }

    // Proceso de recolección: consumir mientras dura el temporizador
    for (const ant of this.ants) {
      if (ant.collectTimer <= 0 || !ant.collectingFood) continue;
      const food = ant.collectingFood;
      const rate = Math.min(CARRY_CAPACITY - ant.carrying, FOOD_CONSUMPTION_PER_SEC * dt, food.quantity);
      food.quantity = Math.max(0, food.quantity - rate);
      ant.carrying = Math.min(CARRY_CAPACITY, ant.carrying + rate);
      ant.health = Math.min(100, ant.health + rate * 0.8);
      if (ant.collectTimer <= 0 || ant.carrying >= CARRY_CAPACITY || food.quantity <= 0) {
        ant.collectTimer = 0;
        ant.collectingFood = null;
      }
    }

    // Entrega en la colonia
    for (const ant of this.ants) {
      if (ant.carrying <= 0) continue;
      const dx = ant.x - this.colony.x;
      const dy = ant.y - this.colony.y;
      const touchDistance = COLONY_RADIUS_PX + ant.lengthPx * 0.4;
      if (dx * dx + dy * dy <= touchDistance * touchDistance) {
        this.colony.stock += ant.carrying;
        ant.carrying = 0;
        ant.foodTrailTimer = 0;
        ant.lastPheromone = 0;
        ant.lastFoodId = null;
        ant.colonyRestTimer = COLONY_REST_DURATION;
        ant.vx = 0;
        ant.vy = 0;
      }
    }

    // Retirar entidades expiradas
    const depletedFoodIds = this.food.filter((f) => f.quantity <= 0).map((f) => f.id);
    this.ants = this.ants.filter((a) => a.health > 0);
    this.food = this.food.filter((f) => f.quantity > 0);
    this.pheromones = this.pheromones.filter(
      (p) =>
        p.intensity > 0.01 &&
        !(p.fromFood && p.sourceFoodId && depletedFoodIds.length && depletedFoodIds.includes(p.sourceFoodId))
    );

    this.renderInfo();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Hormonas (círculo suave)
    for (const p of this.pheromones) {
      const alpha = p.fromFood ? Math.min(0.95, 0.55 + p.intensity * 0.4) : Math.min(0.35, 0.18 + p.intensity * 0.25);
      const color = p.fromFood ? "255, 180, 120" : "126, 214, 255";
      const radius = (p.radiusPx + (p.fromFood ? 3 : 1.5)) * (p.fromFood ? 0.9 : 0.6);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${color}, ${alpha})`;
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Colonia (hexágono)
    ctx.save();
    ctx.translate(this.colony.x, this.colony.y);
    ctx.beginPath();
    const size = COLONY_RADIUS_PX;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = Math.cos(angle) * size;
      const py = Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#334155";
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Comida (rombos)
    for (const f of this.food) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#a3e635";
      ctx.strokeStyle = "#d9f99d";
      const size = f.radiusPx + Math.min(8, f.quantity / 8);
      ctx.beginPath();
      ctx.rect(-size, -size, size * 2, size * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Hormigas (triángulos dirigidos)
    for (const ant of this.ants) {
      ctx.save();
      ctx.translate(ant.x, ant.y);
      const angle = Math.atan2(ant.vy, ant.vx) || 0;
      ctx.rotate(angle);
      let color = "#22d3ee";
      if (ant.health < 15) color = "#f8fafc";
      else if (ant.foodTrailTimer > 0 || ant.carrying > 0) color = "#ef4444";
      else if (ant.salud === Salud.TOCADA) color = "#f59e0b";
      ctx.globalAlpha = ant.colonyRestTimer > 0 ? 0.35 : 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ant.lengthPx / 2, 0);
      ctx.lineTo(-ant.lengthPx / 2, ant.widthPx / 1.2);
      ctx.lineTo(-ant.lengthPx / 2, -ant.widthPx / 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Selección
    if (this.selected) {
      ctx.beginPath();
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2;
      ctx.arc(this.selected.x, this.selected.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  handleClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (this.canvas.height / rect.height);
    const radius = 10;

    const findEntity = (list) =>
      list.find((e) => (e.x - x) ** 2 + (e.y - y) ** 2 < radius * radius);

    this.selected =
      ((this.colony.x - x) ** 2 + (this.colony.y - y) ** 2 < (COLONY_RADIUS_PX + 6) ** 2 ? this.colony : null) ||
      findEntity(this.ants) ||
      findEntity(this.food) ||
      findEntity(this.pheromones) ||
      null;
    this.renderInfo();
  }

  renderInfo() {
    const summary = `
        <div class="entity-card metrics">
          <div><strong>Hormigas:</strong> ${this.ants.length}</div>
          <div><strong>Comida:</strong> ${this.food.length}</div>
          <div><strong>Hormonas:</strong> ${this.pheromones.length}</div>
          <div><strong>Colonia (almacén):</strong> ${this.colony.stock.toFixed(0)}</div>
          <div><strong>Estado:</strong> ${this.running ? "En marcha" : "Pausada"}</div>
          <div><strong>Escala espacio:</strong> ${MILLIMETERS_PER_PIXEL} mm/px</div>
          <div><strong>Escala tiempo:</strong> x${this.timeScale.toFixed(0)} (máx 1 día/min)</div>
          <div><strong>Velocidad base:</strong> ${ANT_SPEED_MM_S} mm/s</div>
        </div>`;

    if (!this.selected) {
      this.infoEl.innerHTML = `${summary}<p>Haz clic en una hormiga, comida u hormona para ver sus datos.</p>`;
      return;
    }

    if (this.selected.kind === "colony") {
      this.infoEl.innerHTML = `
        ${summary}
        <div class="entity-card">
          <h3>Colonia</h3>
          <div><strong>Posición:</strong> (${this.colony.x.toFixed(1)}, ${this.colony.y.toFixed(1)})</div>
          <div><strong>Depósito:</strong> ${this.colony.stock.toFixed(1)} unidades</div>
          <div><strong>Radio de captura:</strong> ${COLONY_RADIUS_PX.toFixed(1)} px</div>
        </div>`;
    } else if (this.selected instanceof Ant) {
      this.infoEl.innerHTML = `
        ${summary}
        <div class="entity-card">
          <h3>Hormiga #${this.selected.id}</h3>
          <div><strong>Rol:</strong> ${this.selected.role}</div>
          <div><strong>Salud:</strong> ${this.selected.health.toFixed(1)} (${this.selected.salud})</div>
          <div><strong>Cargando:</strong> ${this.selected.carrying.toFixed(1)} unidades</div>
          <div><strong>Tamaño real:</strong> ${ANT_LENGTH_MM} mm largo · ${ANT_WIDTH_MM} mm ancho</div>
          <div><strong>Posición:</strong> (${this.selected.x.toFixed(1)}, ${this.selected.y.toFixed(1)})</div>
        </div>`;
    } else if (this.selected instanceof Food) {
      this.infoEl.innerHTML = `
        ${summary}
        <div class="entity-card">
          <h3>Comida #${this.selected.id}</h3>
          <div><strong>Tipo:</strong> ${this.selected.type}</div>
          <div><strong>Cantidad:</strong> ${this.selected.quantity.toFixed(0)}</div>
          <div><strong>TTL:</strong> ${this.selected.timeToLive.toFixed(1)}s</div>
          <div><strong>Posición:</strong> (${this.selected.x.toFixed(1)}, ${this.selected.y.toFixed(1)})</div>
        </div>`;
    } else {
      this.infoEl.innerHTML = `
        ${summary}
        <div class="entity-card">
          <h3>Hormona #${this.selected.id}</h3>
          <div><strong>Tipo:</strong> ${this.selected.tipo}</div>
          <div><strong>Intensidad:</strong> ${(this.selected.intensity * 100).toFixed(0)}%</div>
          <div><strong>Posición:</strong> (${this.selected.x.toFixed(1)}, ${this.selected.y.toFixed(1)})</div>
        </div>`;
    }
  }

  setStatus(label, detail, state) {
    if (typeof this.statusHook === "function") {
      this.statusHook(label, detail, state);
    }
  }
}

// === Bootstrap ===
const canvas = document.getElementById("simCanvas");
const info = document.getElementById("infoContent");
const sim = new Simulation(canvas, info);

const antCount = document.getElementById("antCount");
const foodCount = document.getElementById("foodCount");
const pheromoneRate = document.getElementById("pheromoneRate");
const timeScaleInput = document.getElementById("timeScale");
const timeScaleValue = document.getElementById("timeScaleValue");
const timeScaleBadge = document.getElementById("timeScaleBadge");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const spawnFoodBtn = document.getElementById("spawnFoodBtn");
const spawnPheromoneBtn = document.getElementById("spawnPheromoneBtn");

const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const statusDetail = document.getElementById("statusDetail");

const clampTimeScale = (value) => Math.min(MAX_TIME_SCALE, Math.max(1, value));
const renderTimeScale = (value) => {
  if (!timeScaleValue) return;
  if (value >= MAX_TIME_SCALE) {
    timeScaleValue.textContent = "1 día / min";
    if (timeScaleBadge) timeScaleBadge.textContent = "1 día / min";
  } else if (value >= 60) {
    const hours = (value / 60).toFixed(1).replace(/\.0$/, "");
    timeScaleValue.textContent = `${hours} h / min`;
    if (timeScaleBadge) timeScaleBadge.textContent = `${hours} h / min`;
  } else {
    timeScaleValue.textContent = `${value.toFixed(0)} min / min`;
    if (timeScaleBadge) timeScaleBadge.textContent = `${value.toFixed(0)} min / min`;
  }
};

sim.statusHook = (label, detail, state) => {
  statusLabel.textContent = label;
  statusDetail.textContent = detail;
  let color = "#f59e0b";
  if (state === "running") color = "#22d3ee";
  else if (state === "ready") color = "#a3e635";
  else if (state === "info") color = "#f472b6";
  else if (state === "paused") color = "#94a3b8";
  statusDot.style.background = color;
  statusDot.style.boxShadow = `0 0 0 4px ${color}22`;
};

startBtn.addEventListener("click", () => {
  sim.reset({
    antCount: Number(antCount.value),
    foodCount: Number(foodCount.value),
    pheromoneRate: Number(pheromoneRate.value),
    timeScale: clampTimeScale(Number(timeScaleInput.value)),
  });
  sim.start();
  pauseBtn.textContent = "Pausar";
});

pauseBtn.addEventListener("click", () => {
  if (sim.running) {
    sim.pause();
    pauseBtn.textContent = "Reanudar";
  } else {
    sim.start();
    pauseBtn.textContent = "Pausar";
  }
});

resetBtn.addEventListener("click", () => {
  sim.pause();
  sim.reset({
    antCount: Number(antCount.value),
    foodCount: Number(foodCount.value),
    pheromoneRate: Number(pheromoneRate.value),
    timeScale: clampTimeScale(Number(timeScaleInput.value)),
  });
  pauseBtn.textContent = "Reanudar";
});

spawnFoodBtn.addEventListener("click", () => sim.spawnFood());
spawnPheromoneBtn.addEventListener("click", () => sim.pulsePheromones());

timeScaleInput.addEventListener("input", () => {
  const value = clampTimeScale(Number(timeScaleInput.value));
  timeScaleInput.value = value;
  renderTimeScale(value);
  sim.timeScale = value;
  sim.renderInfo();
  sim.setStatus("Escala de tiempo", `x${value.toFixed(0)} (máx 1 día/min)`, "info");
});

// Estado inicial
const initialTimeScale = clampTimeScale(Number(timeScaleInput.value));
renderTimeScale(initialTimeScale);
sim.reset({
  antCount: Number(antCount.value),
  foodCount: Number(foodCount.value),
  pheromoneRate: Number(pheromoneRate.value),
  timeScale: initialTimeScale,
});
sim.start();
