// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
export function createStudentView() {
  return {
    renderIdentity({ me, devices, sessions }) {
      // 매번 새 DOM을 반환하여 이전 신원의 표시를 재사용하지 않습니다.
      const root = document.createElement('div');
      const deviceLabels = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
      const sessionLabels = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
      const label = (labels, value) => Object.hasOwn(labels, value) ? labels[value] : '확인 불가';
      const value = (input) => typeof input === 'string' && input.length > 0 ? input : '확인 불가';
      const line = (parent, text) => {
        const p = document.createElement('p');
        p.textContent = text;
        parent.appendChild(p);
      };
      const section = (title, resource, renderData) => {
        const block = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = title;
        block.appendChild(heading);
        const modes = { connected: '연결됨', demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
        line(block, label(modes, resource?.mode));
        if (resource?.status === 'loading') {
          line(block, '불러오는 중');
        } else if (resource?.status === 'error') {
          line(block, `연결 실패: ${value(resource.error?.message)}`);
        } else if (resource?.status === 'ok') {
          renderData(block, resource.data);
        } else {
          line(block, '확인 불가');
        }
        root.appendChild(block);
      };
      const deviceLine = (parent, device) => line(parent,
        `기기: ${value(device?.label)} · ID: ${value(device?.id)} · 상태: ${label(deviceLabels, device?.status)}(${value(device?.status)})`);
      const sessionLine = (parent, session) => line(parent,
        `세션 ID: ${value(session?.id)} · 상태: ${label(sessionLabels, session?.status)}(${value(session?.status)})`);
      section('현재 계정·기기·세션', me, (parent, data) => {
        line(parent, `사용자: ${value(data?.user?.label)} · ID: ${value(data?.user?.id)}`);
        deviceLine(parent, data?.device);
        sessionLine(parent, data?.session);
      });
      section('기기 목록', devices, (parent, data) => {
        if (!Array.isArray(data)) return line(parent, '확인 불가');
        if (data.length === 0) line(parent, '표시할 기기가 없습니다.');
        for (const device of data) deviceLine(parent, device);
      });
      section('세션 목록', sessions, (parent, data) => {
        if (!Array.isArray(data)) return line(parent, '확인 불가');
        if (data.length === 0) line(parent, '표시할 세션이 없습니다.');
        for (const session of data) sessionLine(parent, session);
      });
      return root;
    },
    renderDecision({ status, mode, data, error, appId }) {
      const root = document.createElement('div');
      const value = (input) => typeof input === 'string' && input.trim().length > 0 ? input : '확인 불가';
      const line = (text) => {
        const p = document.createElement('p');
        p.textContent = text;
        root.appendChild(p);
      };
      if (status === 'idle') {
        line('업무 앱을 골라 접속을 요청하세요.');
      } else if (status === 'loading') {
        line(`요청한 앱 ID: ${value(appId)}`);
        line('판정 확인 중');
      } else if (status === 'error') {
        line(`요청한 앱 ID: ${value(appId)}`);
        line(`요청 실패: ${value(error?.message)}`);
        line('요청 실패는 접근 거부 판정이 아닙니다. 접근 판정을 받지 못했습니다.');
      } else if (status === 'ok') {
        line(`판정 대상 앱 ID: ${value(data?.appId)}`);
        const labels = {
          allow: '접근 허용',
          deny: '접근 거부',
          challenge: '추가 인증 또는 확인 필요',
          unknown: '판정 확인 불가',
        };
        const decision = Object.hasOwn(labels, data?.decision) ? data.decision : 'unknown';
        line(`${labels[decision]}(${decision})`);
        if (decision === 'allow') {
          line('정책상 접근 허용이며 실제 앱 접속 성공을 보장하지 않습니다.');
        } else if (decision === 'challenge') {
          line('이 앱은 추가 인증 또는 확인 절차를 대신 수행하지 않습니다.');
        } else if (decision === 'unknown') {
          line('접근 판정을 확인할 수 없습니다. 접근이 허용된 것으로 볼 수 없습니다.');
        }
        line(`판정 이유: ${value(data?.reason)}`);
        line(`판정 시각: ${value(data?.checkedAt)}`);
      } else {
        line('요청 상태 확인 불가. 접근 판정을 확인할 수 없습니다.');
      }
      return root;
    },
    renderEvents({ status, mode, data, error }) {
      // 필터와 상세 선택은 이번 입력의 DOM 안에서만 유지합니다.
      const root = document.createElement('div');
      const value = (input) => typeof input === 'string' && input.trim().length > 0 ? input : '확인 불가';
      const element = (tag, text) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const line = (parent, text) => parent.appendChild(element('p', text));
      if (mode === 'demo') line(root, '예제 자료 · 실제 연결 아님');
      if (mode === 'disconnected') line(root, '연결 없음');
      if (mode === 'unknown') line(root, '연결 상태 확인 불가');
      if (status === 'loading') {
        line(root, '기록을 불러오는 중');
        return root;
      }
      if (status === 'error') {
        line(root, `기록을 불러오지 못했습니다: ${value(error?.message)}`);
        if (error?.code === 'CONTRACT_MISMATCH') line(root, '확인 불가: 기록의 응답 형식을 확인할 수 없습니다.');
        return root;
      }
      if (status !== 'ok' || !Array.isArray(data)) {
        line(root, '확인 불가: 기록의 응답 형식을 확인할 수 없습니다.');
        return root;
      }
      // 정렬과 필터링은 받은 배열 안에서만 수행하며 원본은 변경하지 않습니다.
      const events = [...data].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (events.length === 0) {
        line(root, '표시 기록: 0건');
        line(root, '표시할 기록이 없습니다');
        return root;
      }
      const kindLabels = { access: '접속 기록', xdr: 'XDR 경보' };
      const accessLabels = { allowed: '접근 허용', denied: '접근 거부', unknown: '확인 불가' };
      const sessionLabels = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
      const deviceLabels = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
      const stateText = (labels, raw) => {
        const code = typeof raw === 'string' && raw.length > 0 ? raw : 'unknown';
        const description = Object.hasOwn(labels, code) ? labels[code] : '확인 불가';
        return `${description}(${code})`;
      };
      const appText = (appId) => typeof appId === 'string' && appId.length > 0 ? appId : '앱을 확인할 수 없습니다';
      const filters = element('div');
      const count = element('p');
      const list = element('ul');
      const detail = element('section');
      const makeFilter = (name, values, describe) => {
        const label = element('label');
        label.appendChild(element('span', name));
        const select = element('select');
        select.setAttribute('aria-label', name);
        const all = element('option', '전체');
        all.value = 'all';
        select.appendChild(all);
        for (const raw of new Set(values.filter((item) => typeof item === 'string' && item.length > 0))) {
          const option = element('option', describe(raw));
          option.value = raw;
          select.appendChild(option);
        }
        select.value = 'all';
        label.appendChild(select);
        filters.appendChild(label);
        return select;
      };
      const kindFilter = makeFilter('기록 종류', events.map((event) => event.kind), (raw) => stateText(kindLabels, raw));
      const appFilter = makeFilter('업무 앱', events.map((event) => event.appId), (raw) => raw);
      const accessFilter = makeFilter('접속 상태', events.map((event) => event.state?.access), (raw) => stateText(accessLabels, raw));
      const showDetail = (event) => {
        detail.replaceChildren();
        detail.setAttribute('data-student-event-detail', event.id);
        detail.appendChild(element('h3', `${value(event.id)} 상세`));
        line(detail, `사건 ID: ${value(event.id)}`);
        line(detail, `업무 앱: ${appText(event.appId)}`);
        const entries = (title, items) => {
          detail.appendChild(element('h4', title));
          if (!Array.isArray(items) || items.length === 0) {
            line(detail, `${title}: 제공된 항목이 없습니다`);
            return;
          }
          for (const item of items) line(detail, `ID: ${value(item.id)} · 내용: ${value(item.text)}`);
        };
        entries('근거', event.evidence);
        entries('규칙', event.rules);
        detail.appendChild(element('h4', '상태'));
        line(detail, `접속 상태: ${stateText(accessLabels, event.state?.access)}`);
        line(detail, `세션 상태: ${stateText(sessionLabels, event.state?.session)}`);
        line(detail, `기기 상태: ${stateText(deviceLabels, event.state?.device)}`);
      };
      const renderList = () => {
        // 필터 변경 시 선택된 상세가 숨겨진 기록을 계속 가리키지 않게 합니다.
        detail.replaceChildren();
        detail.removeAttribute('data-student-event-detail');
        list.replaceChildren();
        const filtered = events.filter((event) =>
          (kindFilter.value === 'all' || event.kind === kindFilter.value)
          && (appFilter.value === 'all' || event.appId === appFilter.value)
          && (accessFilter.value === 'all' || event.state?.access === accessFilter.value));
        count.textContent = `표시 기록: ${filtered.length}건 / 받은 기록: ${events.length}건`;
        if (filtered.length === 0) list.appendChild(element('li', '조건에 맞는 기록이 없습니다'));
        for (const event of filtered) {
          const row = element('li');
          row.setAttribute('data-student-event-id', event.id);
          line(row, `사건 ID: ${value(event.id)}`);
          line(row, `시각: ${value(event.at)}`);
          line(row, `종류: ${stateText(kindLabels, event.kind)}`);
          line(row, `업무 앱: ${appText(event.appId)}`);
          line(row, `요약: ${value(event.summary)}`);
          const button = element('button', `${event.id} 상세`);
          button.type = 'button';
          button.addEventListener('click', () => showDetail(event));
          row.appendChild(button);
          list.appendChild(row);
        }
      };
      root.appendChild(filters);
      root.appendChild(count);
      root.appendChild(list);
      root.appendChild(detail);
      for (const filter of [kindFilter, appFilter, accessFilter]) filter.addEventListener('change', renderList);
      renderList();
      return root;
    },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
