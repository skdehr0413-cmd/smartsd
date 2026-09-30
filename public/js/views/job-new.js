// 1단계: 문의 접수 폼
import { html, options } from '../ui.js';
import { CHANNELS } from '../../core/constants.js';

export default {
  title: () => '새 문의 접수',
  back: () => '#/jobs',
  render(c) {
    const customers = [...c.state.customers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return html`
      <div class="page-head"><div><div class="eyebrow">1단계</div><h1>새 문의 접수</h1></div></div>
      <form class="card" data-form="create" style="max-width:760px">
        <div class="card-body form">
          <fieldset class="field cust-mode" style="border:0;padding:0;margin:0">
            <legend class="label" style="font-weight:700;color:var(--text-2);font-size:var(--fs-sm);margin-bottom:6px">고객</legend>
            <div class="seg">
              <label><input type="radio" name="mode" value="new" checked> 새 고객</label>
              <label><input type="radio" name="mode" value="existing"> 기존 고객</label>
            </div>
            <div class="fields-3 new-fields" style="margin-top:10px">
              <div class="field"><label for="n-name">고객명</label><input id="n-name" name="name" type="text" placeholder="예: 김서연 / 카페 온유"></div>
              <div class="field"><label for="n-phone">연락처</label><input id="n-phone" name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000"></div>
              <div class="field"><label for="n-type">구분</label><select id="n-type" name="type">${options(['개인', '상가', '관리사무소', '기업'].map((x) => ({ id: x, name: x })), '개인')}</select></div>
            </div>
            <div class="field existing-fields" style="margin-top:10px">
              <label for="n-cust">기존 고객 선택</label>
              <select id="n-cust" name="customerId">${options(customers, '', { label: (x) => `${x.name} · ${x.phone}`, placeholder: '고객을 선택하세요' })}</select>
            </div>
          </fieldset>
          <div class="field"><label for="n-addr">현장 주소</label><input id="n-addr" name="address" type="text" placeholder="기존 고객은 비워 두면 등록 주소를 씁니다"></div>
          <div class="field"><label for="n-title">문의 요약</label><input id="n-title" name="title" type="text" required maxlength="80" placeholder="예: 욕실 누수 — 아랫집 천장 얼룩"></div>
          <div class="field"><label for="n-sym">증상·요청 내용</label><textarea id="n-sym" name="symptom" placeholder="언제부터, 어디서, 어떤 증상인지 적어 두면 현장 확인이 빨라집니다."></textarea></div>
          <div class="fields-3">
            <div class="field"><label for="n-ch">접수 경로</label><select id="n-ch" name="channel">${options(CHANNELS.map((x) => ({ id: x, name: x })), '전화')}</select></div>
            <div class="field"><label for="n-pref">희망 방문 일시</label><input id="n-pref" name="preferredAt" type="datetime-local"></div>
            <div class="field"><span class="label">긴급도</span><label class="check" style="min-height:40px"><input type="checkbox" name="urgent" value="1"> 긴급 (당일 방문)</label></div>
          </div>
          <p class="form-error" hidden></p>
        </div>
        <div class="card-foot"><a class="btn" href="#/jobs">취소</a><button class="btn btn-primary" type="submit">접수하기</button></div>
      </form>
    `;
  },
  forms: {
    async create(c, d, form) {
      const payload = {
        title: d.title, symptom: d.symptom, channel: d.channel, address: d.address,
        urgency: d.urgent ? 'urgent' : 'normal', preferredAt: d.preferredAt || null,
      };
      if (d.mode === 'existing') payload.customerId = d.customerId;
      else payload.customer = { name: d.name, phone: d.phone, type: d.type, address: d.address };
      try {
        const job = await c.run('POST', '/api/jobs', payload);
        c.toast(`${job.id} 접수 완료`);
        c.go(`/jobs/${job.id}`);
      } catch (err) {
        const box = form.querySelector('.form-error');
        box.textContent = err.message;
        box.hidden = false;
      }
    },
  },
};
