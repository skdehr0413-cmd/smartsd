// 캔버스 서명 패드 (마우스·터치·펜 공용)
const pads = new Map();

export function mountSignatures(root) {
  root.querySelectorAll('.sigpad[data-sig]').forEach((el) => {
    if (el.dataset.ready) return;
    el.dataset.ready = '1';
    pads.set(el.dataset.sig, createPad(el));
  });
}

export const getPad = (name) => pads.get(name);

function createPad(el) {
  const canvas = el.querySelector('canvas');
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(200, Math.round(rect.width || 400));
  const h = Math.max(100, Math.round(rect.height || 160));
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#15222c';
  let drawing = false;
  let strokes = 0;
  let last = null;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    last = pos(e);
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 합성 이벤트 등 캡처 불가 시 무시 */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    g.beginPath();
    g.moveTo(last.x, last.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last = p;
    strokes += 1;
    if (strokes > 3) el.classList.add('signed');
    e.preventDefault();
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);

  return {
    isEmpty: () => strokes < 4,
    clear() {
      g.clearRect(0, 0, w, h);
      strokes = 0;
      el.classList.remove('signed');
    },
    toDataURL() {
      // 흰 바탕에 합성해 어떤 테마에서도 보이게 저장
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const o = out.getContext('2d');
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, w, h);
      o.drawImage(canvas, 0, 0, w, h);
      return out.toDataURL('image/png');
    },
    /** 자동 테스트·데모용: 서명 획을 그린다 */
    drawSample() {
      g.beginPath();
      g.moveTo(20, h * 0.7);
      for (let x = 20; x < w - 20; x += 12) g.lineTo(x, h * 0.5 + Math.sin(x / 18) * h * 0.25);
      g.stroke();
      strokes = 10;
      el.classList.add('signed');
    },
  };
}
