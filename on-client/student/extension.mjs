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
        const unsupportedActions = Array.isArray(event.supportedActions)
          ? event.supportedActions.filter((action) => typeof action === 'string' && action.length > 0) : [];
        if (unsupportedActions.length > 0) {
          detail.appendChild(element('h4', '미지원 조치'));
          line(detail, '조치 실행 연결은 준비 중입니다. 아직 지원하지 않으며 요청을 전송하지 않습니다.');
          for (const action of unsupportedActions) {
            const button = element('button', `${action} 미지원`);
            button.type = 'button';
            button.disabled = true;
            detail.appendChild(button);
          }
        }
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
    renderStatus({ devices, sessions, notifications, diagnostics, mode }) {
      // 새 입력마다 새 DOM을 만들어 이전 목록·오류·진단 결과를 재사용하지 않습니다.
      const root = document.createElement('div');
      const value = (input) => typeof input === 'string' && input.trim().length > 0 ? input : '확인 불가';
      const element = (tag, text) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const line = (parent, text) => parent.appendChild(element('p', text));
      const section = (title) => {
        const block = element('section');
        block.appendChild(element('h3', title));
        root.appendChild(block);
        return block;
      };
      const showMode = (parent, resourceMode) => {
        const labels = { connected: '연결됨', demo: '예제 자료 · 실제 연결 아님', disconnected: '연결 없음', unknown: '연결 상태 확인 불가' };
        line(parent, Object.hasOwn(labels, resourceMode) ? labels[resourceMode] : '연결 상태 확인 불가');
      };
      const showFailure = (parent, name, resource, diagnostic = false) => {
        line(parent, `${name}를 불러오지 못했습니다: ${value(resource.error?.message)}`);
        const code = value(resource.error?.code);
        if (code.includes('TIMEOUT') || code.includes('TIMED_OUT')) line(parent, `시간 초과(${code})`);
        if (code === 'CONTRACT_MISMATCH') line(parent, '확인 불가: 응답 형식이 일치하지 않습니다.');
        line(parent, diagnostic
          ? '다시 시도는 제공 영역의 도움정보 불러오기 버튼을 직접 누르세요.'
          : '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요.');
      };
      const stateText = (labels, raw) => {
        const code = typeof raw === 'string' && raw.length > 0 ? raw : 'unknown';
        return `${Object.hasOwn(labels, code) ? labels[code] : '확인 불가'}(${code})`;
      };
      const showList = (name, resource, emptyText, renderItem) => {
        const block = section(name);
        showMode(block, resource?.mode);
        if (resource?.status === 'loading') {
          line(block, `${name}를 불러오는 중`);
        } else if (resource?.status === 'error') {
          showFailure(block, name, resource);
        } else if (resource?.status === 'ok' && Array.isArray(resource.data)) {
          if (resource.data.length === 0) line(block, emptyText);
          for (const item of resource.data) renderItem(block, item);
        } else {
          line(block, `${name} 확인 불가`);
          line(block, '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요.');
        }
      };
      showMode(root, mode);
      showList('기기 정보', devices, '등록된 기기가 없습니다', (parent, device) => {
        const labels = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
        line(parent, `기기: ${value(device?.label)} · ID: ${value(device?.id)} · 상태: ${stateText(labels, device?.status)}`);
      });
      showList('세션 정보', sessions, '현재 연결이 없습니다', (parent, session) => {
        const labels = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
        line(parent, `세션 ID: ${value(session?.id)} · 상태: ${stateText(labels, session?.status)}`);
      });
      line(root, '세션 조회는 현재 검증된 연결 한 개를 대상으로 하며, 과거 세션 전체 목록이 아닙니다.');
      const alerts = section('알림');
      if (!Array.isArray(notifications)) {
        line(alerts, '알림 정보를 확인할 수 없습니다');
      } else if (notifications.length === 0) {
        line(alerts, '주의할 알림이 없습니다');
      } else {
        const list = element('ul');
        for (const notification of notifications) {
          const item = element('li');
          line(item, `자료(resource): ${value(notification.resource)}`);
          line(item, `코드(code): ${value(notification.code)}`);
          line(item, `내용: ${value(notification.message)}`);
          list.appendChild(item);
        }
        alerts.appendChild(list);
      }
      const diagnostic = section('진단 정보');
      showMode(diagnostic, diagnostics?.mode);
      let helpText = '';
      if (diagnostics?.status === 'loading') {
        line(diagnostic, '진단 정보를 불러오는 중');
      } else if (diagnostics?.status === 'error') {
        showFailure(diagnostic, '진단 정보', diagnostics, true);
      } else if (diagnostics?.status === 'idle') {
        line(diagnostic, '진단 정보는 아직 조회하지 않았습니다. 제공 영역의 도움정보 불러오기 버튼을 직접 누르세요.');
      } else if (diagnostics?.status === 'ok') {
        const data = diagnostics.data;
        // 전체 응답을 직렬화하지 않고 지정된 여섯 문자열 필드만 새 객체로 투영합니다.
        const safe = {
          requestId: value(data?.requestId),
          component: value(data?.component),
          version: value(data?.version),
          checkedAt: value(data?.checkedAt),
          engine: { mode: value(data?.engine?.mode), code: value(data?.engine?.code) },
        };
        const fields = [data?.requestId, data?.component, data?.version, data?.checkedAt, data?.engine?.mode, data?.engine?.code];
        if (!fields.some((field) => typeof field === 'string' && field.trim().length > 0)) {
          line(diagnostic, '진단 정보가 없습니다. 확인 불가.');
          line(diagnostic, '제공 영역의 도움정보 불러오기 버튼을 직접 눌러 다시 확인하세요.');
        } else {
          helpText = JSON.stringify(safe, null, 2);
          diagnostic.appendChild(element('pre', helpText));
        }
      } else {
        line(diagnostic, '진단 정보 확인 불가. 제공 영역의 도움정보 불러오기 버튼을 직접 누르세요.');
      }
      line(diagnostic, '도움 요청에 사용할 진단 정보 중 지정된 여섯 항목만 복사합니다.');
      const copy = element('button', '도움정보 복사');
      copy.type = 'button';
      copy.disabled = helpText.length === 0;
      const copyStatus = element('p');
      copyStatus.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        if (!helpText) return;
        try {
          await navigator.clipboard.writeText(helpText);
          copyStatus.textContent = '도움정보를 클립보드에 복사했습니다.';
        } catch {
          copyStatus.textContent = '클립보드에 복사하지 못했습니다. 위 진단 정보를 선택해 직접 복사하세요.';
        }
      });
      diagnostic.appendChild(copy);
      diagnostic.appendChild(copyStatus);
      return root;
    },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
