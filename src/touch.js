const R = 52;   // how far the thumb stick travels, in screen pixels
const $ = (id) => document.getElementById(id);

// Phone and tablet controls. The left half of the screen is a thumb stick that appears wherever your thumb lands
// (push it all the way to run), dragging anywhere else looks around, and the big button digs and swats.
export class Touch {
  constructor(canvas, game) {
    this.game = game;
    this.x = 0; this.z = 0; this.run = false; this.dig = false;
    this.stick = null; this.digId = null; this.looks = new Map();
    this.base = $('stick'); this.knob = $('knob'); this.btn = $('digbtn');
    const body = document.body;
    if (matchMedia('(hover: none) and (pointer: coarse)').matches) body.classList.add('touch');
    // whichever you used last decides what is on screen, so a laptop with a touch screen gets both
    addEventListener('pointerdown', (e) => body.classList.toggle('touch', e.pointerType !== 'mouse'), true);
    addEventListener('gesturestart', (e) => e.preventDefault());   // no pinch-zooming the page on an iPhone

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !game.started || (game.over && !game.looking)) return;
      e.preventDefault();
      game.net?.reclaim();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      if (!this.stick && e.clientX < innerWidth / 2) {
        this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.base.style.left = e.clientX - R + 'px'; this.base.style.top = e.clientY - R + 'px'; this.base.style.bottom = 'auto';
        this.base.classList.add('on');
      } else this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const move = (e) => {
      const s = this.stick;
      if (s && e.pointerId === s.id) {
        let dx = e.clientX - s.x, dy = e.clientY - s.y;
        const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
        dx *= k; dy *= k;
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const far = Math.min(1, d / R);
        if (far < 0.2) { this.x = this.z = 0; this.run = false; } else { this.x = -dx / R; this.z = -dy / R; this.run = far > 0.92; }
        return;
      }
      const l = this.looks.get(e.pointerId), p = game.player;
      if (!l) return;
      if (p) { p.camYaw -= (e.clientX - l.x) * 0.006; p.camPitch = Math.max(-0.2, Math.min(1.3, p.camPitch + (e.clientY - l.y) * 0.005)); }
      l.x = e.clientX; l.y = e.clientY;
    };
    const end = (e) => {
      if (this.stick && e.pointerId === this.stick.id) this.dropStick();
      if (e.pointerId === this.digId) this.dropDig();
      this.looks.delete(e.pointerId);
    };
    for (const el of [canvas, this.btn]) { el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end); }
    // hold to dig; the same thumb can drag to look around while it holds
    this.btn.addEventListener('pointerdown', (e) => {
      if (!game.started || (game.over && !game.looking)) return;
      e.preventDefault();
      game.net?.reclaim();
      try { this.btn.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      if (this.digId !== null) this.looks.delete(this.digId);
      this.digId = e.pointerId; this.dig = true; this.btn.classList.add('on');
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    this.btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dropStick() {
    this.stick = null; this.x = this.z = 0; this.run = false;
    this.knob.style.transform = '';
    this.base.style.left = this.base.style.top = this.base.style.bottom = '';
    this.base.classList.remove('on');
  }
  dropDig() { this.digId = null; this.dig = false; this.btn.classList.remove('on'); }
  clear() { this.dropStick(); this.dropDig(); this.looks.clear(); }
}
