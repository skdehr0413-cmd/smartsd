// 일정: 팀별 하루 타임라인(충돌은 빨간 블록) + 7일 요약. 휴대폰은 팀별 일정 목록.
import { html, icon, crewDot, crewVar, empty, findingAlert, fmtDate } from '../ui.js';
import { schedule as scheduleView } from '../../core/views.js';
import { addDays, dateOf, timeOf, parseWall, dayOfWeek } from '../../core/time.js';

const START_H = 7;
const END_H = 20;

function clip(b, date) {
  const dayStart = parseWall(`${date}T${String(START_H).padStart(2, '0')}:00`);
  const dayEnd = parseWall(`${date}T${END_H}:00`);
  const s = Math.max(parseWall(b.start), dayStart);
  const e = Math.min(parseWall(b.end), dayEnd);
  if (e <= s) return null;
  const span = dayEnd - dayStart;
  return { left: ((s - dayStart) / span) * 100, width: ((e - s) / span) * 100 };
}

/** 겹치는 블록은 줄(lane)을 나눠 모두 보이게 한다. */
function lanes(items) {
  const ends = [];
  return items.map((b) => {
    let lane = ends.findIndex((t) => t <= parseWall(b.start));
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = parseWall(b.end);
    return { ...b, lane };
  });
}

function blockClass(b) {
  const crit = b.issues.some((i) => i.severity === 'critical');
  const warn = b.issues.some((i) => i.severity === 'warning');
  return [b.kind === 'survey' ? 'survey' : '', b.done ? 'done' : '', crit ? 'conflict' : warn ? 'warn' : ''].join(' ');
}

function dayTimeline(c, v, date) {
  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
  const isToday = dateOf(c.now) === date;
  const nowPos = isToday ? clip({ start: c.now, end: `${date}T${END_H}:00` }, date)?.left : null;
  return html`<div class="timeline" style="--hours:${END_H - START_H}" data-testid="timeline">
    <div class="tl-corner"></div>
    <div class="tl-scale">${hours.map((h) => html`<span style="left:${((h - START_H) / (END_H - START_H)) * 100}%">${h}시</span>`)}</div>
    ${v.crews.map((crew) => {
      const items = lanes(v.bookings.filter((b) => b.crewId === crew.id && clip(b, date)));
      const n = Math.max(1, ...items.map((b) => b.lane + 1));
      return html`<div class="tl-crew"><span class="n">${crewDot(crew)}${crew.name}</span><span class="m">${crew.role} · ${crew.members.join(', ')}</span></div>
      <div class="tl-lane" style="min-height:${n * 56 + 8}px">
        ${nowPos !== null && nowPos !== undefined ? html`<div class="tl-now" style="left:${nowPos}%" title="지금"></div>` : ''}
        ${items.map((b) => {
          const pos = clip(b, date);
          return html`<a class="tl-block ${blockClass(b)}" href="#/jobs/${b.jobId}" style="left:${pos.left}%;width:${pos.width}%;top:${6 + b.lane * 56}px;${crewVar(crew)}" title="${b.issues.map((i) => i.title).join(' / ')}">
            <span class="t">${b.issues.some((i) => i.severity === 'critical') ? '⚠ ' : ''}${b.job.title}</span>
            <span class="s">${timeOf(b.start)}–${timeOf(b.end)} · ${b.kind === 'survey' ? '현장 확인' : '작업'} · ${b.jobId}</span>
          </a>`;
        })}
      </div>`;
    })}
  </div>`;
}

function agenda(c, v, date) {
  return html`<div class="stack">${v.crews.map((crew) => {
    const items = v.bookings.filter((b) => b.crewId === crew.id && dateOf(b.start) <= date && dateOf(b.end) >= date);
    return html`<section class="stack" style="gap:6px"><h3 class="row">${crewDot(crew)}${crew.name} <span class="faint small">${crew.members.join(', ')}</span></h3>
      ${items.length ? html`<div class="agenda">${items.map((b) => {
        const crit = b.issues.some((i) => i.severity === 'critical');
        return html`<a class="agenda-item ${crit ? 'conflict' : ''}" href="#/jobs/${b.jobId}" style="${crewVar(crew)}">
          <div class="time">${timeOf(b.start)}<small>${timeOf(b.end)}</small></div>
          <div class="stack" style="gap:2px"><strong>${b.job.title}</strong>
            <span class="small muted">${b.kind === 'survey' ? '현장 확인' : '작업'} · ${b.customer?.name} · ${b.address}</span>
            ${b.issues.map((i) => html`<span class="chip ${i.severity === 'critical' ? 'chip-crit' : 'chip-warn'}">${i.title}</span>`)}
          </div></a>`;
      })}</div>` : html`<p class="small faint">일정 없음</p>`}</section>`;
  })}</div>`;
}

function week(c, v) {
  const today = dateOf(c.now);
  return html`<div class="table-wrap"><div class="week" style="min-width:760px">
    <div class="wh"></div>${v.dates.map((d) => html`<div class="wh ${d === today ? 'today' : ''}"><a href="#/schedule?d=${d}">${Number(d.slice(8))}일(${dayOfWeek(d)})</a></div>`)}
    ${v.crews.map((crew) => html`<div class="wc">${crewDot(crew)} ${crew.name}</div>${v.dates.map((d) => {
      const items = v.bookings.filter((b) => b.crewId === crew.id && dateOf(b.start) <= d && dateOf(b.end) >= d);
      return html`<div class="cell">${items.map((b) => html`<a class="pill ${b.issues.some((i) => i.severity === 'critical') ? 'conflict' : ''}" style="${crewVar(crew)}" href="#/jobs/${b.jobId}" title="${b.job.title}">${timeOf(b.start)} ${b.job.title}</a>`)}</div>`;
    })}`)}
  </div></div>`;
}

export default {
  title: () => '일정',
  render(c) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(c.query.d || '') ? c.query.d : dateOf(c.now);
    const v = scheduleView(c.state, c.now, { from: date, days: 7 });
    const dayFindings = v.findings.filter((f) => f.refs.some((r) => v.bookings.some((b) => b.id === r && dateOf(b.start) <= date && dateOf(b.end) >= date)));
    const prev = dateOf(addDays(`${date}T00:00`, -1));
    const next = dateOf(addDays(`${date}T00:00`, 1));
    return html`
      <div class="page-head">
        <div><div class="eyebrow">작업 배정 · 현장 확인 방문</div><h1>팀 일정</h1></div>
        <div class="day-nav">
          <a class="btn btn-sm" href="#/schedule?d=${prev}" aria-label="전날">${icon('back')}</a>
          <span class="date">${fmtDate(date)}</span>
          <a class="btn btn-sm" href="#/schedule?d=${next}" aria-label="다음 날" style="transform:scaleX(-1)">${icon('back')}</a>
          <a class="btn btn-sm" href="#/schedule">오늘</a>
        </div>
      </div>
      ${dayFindings.length ? html`<div class="stack">${dayFindings.map((f) => findingAlert(f))}</div>` : html`<div class="alert alert-ok"><div class="alert-body">이 날짜에는 팀 일정 충돌이 없습니다.</div></div>`}
      <div class="legend"><span><i class="swatch"></i>작업</span><span><i class="swatch" style="border-style:dashed"></i>현장 확인</span><span><i class="swatch" style="border-color:var(--crit);background:var(--crit-soft)"></i>충돌</span><span><i class="swatch" style="background:var(--warn-soft)"></i>이동 시간 부족</span></div>
      <section class="hide-mobile">${dayTimeline(c, v, date)}</section>
      <section class="only-mobile">${agenda(c, v, date)}</section>
      <section class="stack hide-mobile"><h2>7일 요약</h2>${week(c, v)}</section>
      ${v.bookings.length ? '' : empty('이 기간에 일정이 없습니다.')}
    `;
  },
};
