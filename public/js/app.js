// 앱 진입점: 라우팅, 공통 틀(사이드바·하단 탭), 이벤트 위임, 모달·토스트
import { createApi, ApiError } from './api.js';
import { html, raw, esc, icon, brandMark, formData, options } from './ui.js';
import { mountSignatures, getPad } from './signature.js';
import { readPref, writePref, applyTheme } from './prefs.js';
import { detectFindings, summarizeFindings } from '../core/detectors.js';
import dashboard from './views/dashboard.js';
import jobs from './views/jobs.js';
import jobNew from './views/job-new.js';
import jobDetail from './views/job-detail.js';
import schedule from './views/schedule.js';
import materials from './views/materials.js';
import billing from './views/billing.js';
import checks from './views/checks.js';
import more from './views/more.js';
import customer from './views/customer.js';

const ACTORS = ['사무실(김혜진)', '대표(오상철)', '현장 1팀', '현장 2팀', '현장 3팀'];

const app = {
  api: null,
  state: null,
  now: null,
  actor: readPref('smartsd-actor', ACTORS[0]),
  loadedAt: 0,
  modal: null,
  cache: new Map(),
};

// ─── 라우팅 ──────────────────────────────────────────────
function parseRoute() {
  const h = decodeURI(location.hash.replace(/^#/, '')) || '/';
  const [p, q = ''] = h.split('?');
  const seg = p.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(q));
  const r = { seg, query, path: p };
  if (!seg.length) return { ...r, name: 'dashboard', view: dashboard };
  if (seg[0] === 'jobs' && seg[1] === 'new') return { ...r, name: 'jobNew', view: jobNew };
  if (seg[0] === 'jobs' && seg[1]) return { ...r, name: 'job', view: jobDetail, params: { id: seg[1], tab: seg[2] || 'overview' } };
  if (seg[0] === 'jobs') return { ...r, name: 'jobs', view: jobs };
  if (seg[0] === 'schedule') return { ...r, name: 'schedule', view: schedule };
  if (seg[0] === 'materials') return { ...r, name: 'materials', view: materials };
  if (seg[0] === 'billing') return { ...r, name: 'billing', view: billing };
  if (seg[0] === 'checks') return { ...r, name: 'checks', view: checks };
  if (seg[0] === 'more' || seg[0] === 'settings') return { ...r, name: 'more', view: more };
  if (seg[0] === 'c' && seg[2]) return { ...r, name: 'customer', view: customer, params: { kind: seg[1], token: seg[2] }, bare: true };
  return { ...r, name: 'dashboard', view: dashboard };
}

/** 코드에서 화면 이동: 열린 모달을 유지한 채 이동한다 (링크 클릭은 hashchange 로 처리). */
export function go(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash !== target) {
    try {
      history.pushState(null, '', target);
    } catch {
      location.hash = target; // 일부 임베드 환경은 pushState 를 막는다
      return;
    }
  }
  render();
}

// ─── 컨텍스트 (뷰에 전달) ─────────────────────────────────
function findingsNow() {
  const key = `${app.state?.events?.length}|${app.now}|${Object.keys(app.state?.acks || {}).length}`;
  if (app.cache.get('findingsKey') !== key) {
    app.cache.set('findingsKey', key);
    app.cache.set('findings', app.state ? detectFindings(app.state, app.now) : []);
  }
  return app.cache.get('findings');
}

function ctx(route = parseRoute()) {
  return {
    state: app.state,
    now: app.now,
    route,
    params: route.params || {},
    query: route.query,
    actor: app.actor,
    actors: ACTORS,
    mode: app.api?.mode,
    findings: findingsNow(),
    run,
    go,
    render,
    toast,
    modal: { open: openModal, close: closeModal, error: modalError },
    confirm,
    getPad,
    request: (method, path, body) => app.api.request(method, path, body, app.actor),
    setActor(a) { app.actor = a; writePref('smartsd-actor', a); render(); },
    async reload() {
      const r = await app.api.load();
      app.state = r.state;
      app.now = r.now;
      app.loadedAt = Date.now();
    },
    async reset() {
      const r = await app.api.reset();
      app.state = r.state;
      app.now = r.now;
      app.cache.clear();
      render();
    },
    cache: app.cache,
  };
}

async function run(method, path, body) {
  const res = await app.api.request(method, path, body, app.actor);
  if (res.state) app.state = res.state;
  if (res.now) app.now = res.now;
  (res.data?.warnings || []).forEach((w) => toast(w, 'warn'));
  render();
  return res.data;
}

// ─── 렌더링 ──────────────────────────────────────────────
const NAV = [
  { key: 'dashboard', href: '#/', label: '오늘', icon: 'home', tab: true },
  { key: 'jobs', href: '#/jobs', label: '작업건', icon: 'jobs', tab: true, match: ['jobs', 'job', 'jobNew'] },
  { key: 'schedule', href: '#/schedule', label: '일정', icon: 'calendar', tab: true },
  { key: 'materials', href: '#/materials', label: '자재', icon: 'box' },
  { key: 'billing', href: '#/billing', label: '정산', icon: 'receipt' },
  { key: 'checks', href: '#/checks', label: '누락·충돌 점검', short: '점검', icon: 'shield', tab: true, count: true },
  { key: 'more', href: '#/more', label: '설정', short: '더보기', icon: 'more', tab: true, tabIcon: 'more', match: ['more'] },
];

function isActive(item, route) {
  return (item.match || [item.key]).includes(route.name) || (route.name === 'more' && item.key === 'more');
}

function shell(c, body, title, back) {
  const sum = summarizeFindings(c.findings);
  const count = (item) => (item.count && sum.critical ? html`<span class="count" aria-label="긴급 ${sum.critical}건">${sum.critical}</span>` : '');
  const company = c.state.meta.company;
  return html`<div class="shell">
    <aside class="sidebar" aria-label="주 메뉴">
      <div class="brand">${brandMark}<div><div class="brand-name">스마트설비</div><div class="brand-sub">${company.name}</div></div></div>
      <nav class="nav">
        ${NAV.map((n) => html`<a href="${n.href}" ${isActive(n, c.route) ? raw('aria-current="page"') : ''}>${icon(n.icon)}<span>${n.label}</span>${count(n)}</a>`)}
      </nav>
      <div class="sidebar-foot">
        <label for="actor-side">사용자</label>
        <select id="actor-side" data-change="actor">${options(c.actors.map((a) => ({ id: a, name: a })), c.actor)}</select>
        <span>${c.mode === 'standalone' ? '단독 데모 (이 브라우저에 저장)' : '서버 연결됨'} · 기준 시각 ${c.now?.replace('T', ' ')}</span>
      </div>
    </aside>
    <header class="topbar">
      ${back ? html`<a href="${back}" class="icon-btn" aria-label="뒤로">${icon('back')}</a>` : brandMark}
      <div class="t-title">${title}</div>
      <a href="#/jobs/new" class="icon-btn" aria-label="새 문의 접수">${icon('plus')}</a>
    </header>
    <main class="main" id="main">${body}</main>
    <nav class="tabbar" aria-label="하단 메뉴">
      ${NAV.filter((n) => n.tab).map((n) => html`<a href="${n.href}" ${isActive(n, c.route) ? raw('aria-current="page"') : ''}>${icon(n.tabIcon || n.icon)}<span>${n.short || n.label}</span>${count(n)}</a>`)}
    </nav>
  </div>`;
}

let lastRoute = '';
export function render() {
  const root = document.getElementById('app');
  const route = parseRoute();
  const c = ctx(route);
  const view = route.view;
  if (route.bare) {
    root.innerHTML = String(view.render(c));
  } else {
    if (!app.state) return;
    let body;
    try {
      body = view.render(c);
    } catch (err) {
      console.error(err);
      body = html`<div class="card card-pad stack"><h1>화면을 표시할 수 없습니다</h1><p class="muted">${err.message}</p><a class="btn" href="#/">처음으로</a></div>`;
    }
    const title = view.title ? view.title(c) : '스마트설비';
    root.innerHTML = String(shell(c, body, title, view.back ? view.back(c) : null));
    document.title = `${title} · 스마트설비`;
  }
  mountSignatures(root);
  view.mount?.(root, c);
  if (lastRoute !== location.hash) {
    lastRoute = location.hash;
    window.scrollTo(0, 0);
  }
}

// ─── 모달 ────────────────────────────────────────────────
function openModal({ title, body, foot = '', wide = false, actions = {}, forms = {}, inputs = {}, mount }) {
  const rootEl = document.getElementById('modal-root');
  app.modal = { actions, forms, inputs };
  rootEl.innerHTML = String(html`<div class="modal-backdrop" data-act="modal-backdrop">
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-act="modal-close" aria-label="닫기">${icon('x')}</button></div>
      ${body}
      ${foot}
    </div>
  </div>`);
  mountSignatures(rootEl);
  mount?.(rootEl);
  const first = rootEl.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea');
  if (first && window.matchMedia('(min-width: 861px)').matches) first.focus();
}

function closeModal() {
  app.modal = null;
  document.getElementById('modal-root').innerHTML = '';
}

function modalError(message) {
  const el = document.querySelector('#modal-root .form-error');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  } else {
    toast(message, 'error');
  }
}

function confirm({ title, message, confirmLabel = '확인', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: html`<div class="modal-body"><p>${message}</p></div>`,
      foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="c-no">취소</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="c-yes">${confirmLabel}</button></div>`,
      actions: {
        'c-yes': () => { closeModal(); resolve(true); },
        'c-no': () => { closeModal(); resolve(false); },
        'modal-close': () => { closeModal(); resolve(false); },
      },
    });
  });
}

// ─── 토스트 ──────────────────────────────────────────────
export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${String(icon(type === 'error' || type === 'warn' ? 'alert' : 'check'))}<span>${esc(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'info' ? 3500 : 7000);
}

// ─── 이벤트 위임 ─────────────────────────────────────────
const GLOBAL = {
  actions: {
    'modal-close': () => closeModal(),
    'modal-backdrop': (c, el, ev) => { if (ev.target === el) closeModal(); },
    'sig-clear': (c, el) => getPad(el.dataset.sig)?.clear(),
    back: () => history.back(),
    reload: () => location.reload(),
  },
  changes: {
    actor: (c, el) => c.setActor(el.value),
  },
  forms: {},
  inputs: {},
};

function handlerFor(type, name, el) {
  if (app.modal && el.closest('#modal-root')) {
    if (app.modal[type]?.[name]) return app.modal[type][name];
  }
  const view = parseRoute().view;
  return view[type]?.[name] || GLOBAL[type]?.[name];
}

async function guard(fn, form) {
  const buttons = form ? [...form.querySelectorAll('button')] : [];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      if (form && form.closest('#modal-root')) modalError(err.message);
      else toast(err.message, 'error');
    } else {
      console.error(err);
      toast(`오류: ${err.message}`, 'error');
    }
  } finally {
    buttons.forEach((b) => { if (b.isConnected) b.disabled = false; });
  }
}

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = handlerFor('actions', el.dataset.act, el);
    if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    guard(() => fn(ctx(), el, ev));
  });
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const fn = handlerFor('forms', form.dataset.form, form);
    if (!fn) return;
    const errBox = form.querySelector('.form-error') || document.querySelector('#modal-root .form-error');
    if (errBox) errBox.hidden = true;
    guard(() => fn(ctx(), formData(form), form, ev), form);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = handlerFor('changes', el.dataset.change, el);
    if (fn) guard(() => fn(ctx(), el, ev));
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (!el) return;
    const fn = handlerFor('inputs', el.dataset.input, el);
    if (fn) fn(ctx(), el, ev);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && app.modal) closeModal();
  });
  const onNavigate = async () => {
    closeModal();
    if (!app.state && !parseRoute().bare) {
      const r = await app.api.load();
      app.state = r.state;
      app.now = r.now;
      app.loadedAt = Date.now();
    }
    render();
    // 서버 모드에서는 화면 이동 때 다른 사용자의 변경을 반영한다.
    if (app.api?.mode === 'server' && Date.now() - app.loadedAt > 10000 && !parseRoute().bare) {
      try {
        const r = await app.api.load();
        app.loadedAt = Date.now();
        if (r.state.events.length !== app.state.events.length || r.now !== app.now) {
          app.state = r.state;
          app.now = r.now;
          render();
        }
      } catch { /* 네트워크 오류는 무시하고 다음 이동 때 재시도 */ }
    }
  };
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('popstate', onNavigate);
}

async function boot() {
  applyTheme();
  bindEvents();
  const root = document.getElementById('app');
  root.innerHTML = '<div class="boot">불러오는 중…</div>';
  try {
    app.api = await createApi({ standalone: !!window.SMARTSD_STANDALONE });
    // 고객용 링크 화면은 업체 전체 데이터를 불러오지 않는다.
    if (!parseRoute().bare || app.api.mode === 'standalone') {
      const r = await app.api.load();
      app.state = r.state;
      app.now = r.now;
      app.loadedAt = Date.now();
    }
    render();
  } catch (err) {
    console.error(err);
    root.innerHTML = String(html`<div class="boot"><div class="stack"><strong>데이터를 불러오지 못했습니다.</strong><span class="muted">${err.message}</span><button class="btn" data-act="reload">다시 시도</button></div></div>`);
  }
}

boot();
