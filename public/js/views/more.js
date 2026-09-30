// 더보기·설정: 사용자, 테마, 회사·팀 정보, 점검 기준, 데모 초기화
import { html, raw, icon, won, options } from '../ui.js';
import { settingsOf } from '../../core/model.js';
import { getTheme, setTheme } from '../prefs.js';

export default {
  title: () => '더보기',
  render(c) {
    const s = settingsOf(c.state);
    const company = c.state.meta.company;
    const theme = getTheme();
    return html`
      <div class="page-head"><div><div class="eyebrow">${company.name}</div><h1>더보기·설정</h1></div></div>
      <nav class="grid-2 only-mobile" aria-label="추가 메뉴">
        <a class="card card-pad row" href="#/materials">${icon('box')}<strong>자재·장비</strong></a>
        <a class="card card-pad row" href="#/billing">${icon('receipt')}<strong>정산</strong></a>
      </nav>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>사용자</h2></div>
          <div class="card-body">
            <div class="field"><label for="actor-more">지금 사용하는 사람</label><select id="actor-more" data-change="actor">${options(c.actors.map((a) => ({ id: a, name: a })), c.actor)}</select>
              <span class="hint">현장 팀을 고르면 '오늘' 화면에 그 팀 일정만 보이고, 모든 기록에 이름이 남습니다.</span></div>
            <div class="field"><span class="label">화면 테마</span>
              <div class="seg">${[['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([k, l]) => html`<label><input type="radio" name="theme" value="${k}" data-change="theme" ${theme === k ? raw('checked') : ''}> ${l}</label>`)}</div></div>
          </div>
        </section>
        <section class="card"><div class="card-head"><h2>회사 정보</h2></div>
          <div class="card-body"><dl class="kv">
            <dt>상호</dt><dd>${company.name}</dd><dt>대표</dt><dd>${company.owner || '-'}</dd><dt>전화</dt><dd>${company.phone}</dd>
            <dt>사업자번호</dt><dd>${company.bizNo}</dd><dt>입금 계좌</dt><dd>${company.account}</dd>
          </dl></div>
        </section>
        <section class="card"><div class="card-head"><h2>작업팀</h2></div>
          <div class="card-body">${c.state.crews.map((cr) => html`<div class="row-between"><span class="row"><span class="dot" style="background:var(--crew-${cr.color})"></span><strong>${cr.name}</strong><span class="small muted">${cr.role}</span></span><span class="small">${cr.members.join(', ')}</span></div>`)}
            <p class="xs faint">두 팀에 모두 속한 사람은 한쪽 일정만 잡을 수 있게 자동으로 확인합니다.</p></div>
        </section>
        <section class="card"><div class="card-head"><h2>점검 기준</h2></div>
          <div class="card-body"><dl class="kv num">
            <dt>연속 일정 이동 시간</dt><dd>${s.travelBufferMin}분 이상</dd>
            <dt>청구서 미발행 주의·긴급</dt><dd>완료 후 ${s.invoiceGraceDays}일 · ${s.invoiceCriticalDays}일</dd>
            <dt>추가 작업 승인 지연</dt><dd>${s.approvalDelayHours}시간</dd>
            <dt>구두 승인 참고 기준</dt><dd>${won(s.weakApprovalAmount)} 이상</dd>
            <dt>미수금 긴급</dt><dd>연체 ${s.overdueCriticalDays}일</dd>
            <dt>기본 결제 기한</dt><dd>${s.paymentDueDays}일</dd>
            <dt>팀 인건비 원가</dt><dd>${won(s.laborCostPerHour)}/시간</dd>
          </dl></div>
        </section>
      </div>
      <section class="card"><div class="card-head"><h2>데모 데이터</h2><span class="small muted">${c.mode === 'standalone' ? '이 브라우저에만 저장됩니다' : '서버에 저장됩니다'}</span></div>
        <div class="card-body row-between"><p class="small muted">4대 누락·충돌 사례가 들어 있는 한결배관설비 데모 데이터로 되돌립니다. 날짜는 오늘 기준으로 다시 만들어집니다.</p>
          <button class="btn btn-danger" data-act="reset">데모 데이터 초기화</button></div>
      </section>
    `;
  },
  changes: {
    theme(c, el) { setTheme(el.value); },
  },
  actions: {
    async reset(c) {
      if (!(await c.confirm({ title: '데모 데이터 초기화', message: '지금까지 입력한 내용이 모두 지워지고 데모 데이터로 바뀝니다.', confirmLabel: '초기화', danger: true }))) return;
      await c.reset();
      c.toast('데모 데이터로 초기화했습니다.');
      c.go('/');
    },
  },
};
