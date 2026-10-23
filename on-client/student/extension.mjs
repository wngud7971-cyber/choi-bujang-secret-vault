// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
export function createStudentView() {
  // AI 입력은 제공 UI가 가린 값을 받으며, 알 수 없는 원문 오류는 다시 노출하지 않습니다.
  const safeAiText = (text, limit = 500) => typeof text === 'string' && text.trim().length > 0
    && text.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
    && !/(?:Bearer\s+\S+|sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?key|authorization|password|access[_ -]?token|refresh[_ -]?token|비밀번호|토큰)\s*[:=]\s*\S+)/i.test(text);
  const aiFailureInfo = (error) => {
    const verify = '담당자에게 현재 계정 연결과 앱 이용 권한을 확인해 달라고 요청하세요.';
    const retry = '연결 상태를 확인한 뒤 잠시 후 점검 버튼을 직접 누르세요.';
    const models = '담당자에게 현재 앱에서 사용할 모델의 허용 설정을 확인해 달라고 요청하세요.';
    const cancelled = '이전 응답은 현재 결과가 아닙니다. 필요하면 사용자가 직접 다시 요청하세요.';
    const reasons = {
      ON_AI_PROVISIONING_PENDING: ['권한 준비 중', `운영 측 계정·앱 권한 준비가 필요하며 학생 코드만으로 연결할 수 없습니다. ${verify}`],
      ON_AI_AUTHORIZATION_CHANGED: ['앱 권한 변경', verify],
      WB_CLCO_AUTH_REQUIRED: ['인증 실패', `계정 연결을 다시 확인하세요. ${verify}`],
      WB_CLCO_ACCESS_BLOCKED: ['접근 제한', verify],
      WB_CLCO_COHORT_BUDGET_EXHAUSTED: ['반 사용량 소진', '담당자에게 반의 AI 사용량을 확인해 달라고 요청하세요.'],
      WB_CLCO_LIMIT_REACHED: ['이용 한도 도달', '담당자에게 AI 이용 한도를 확인해 달라고 요청하세요.'],
      WB_CLCO_SESSION_CLOSED: ['이용 시간 아님', '담당자에게 AI 이용 시간을 확인하세요.'],
      WB_CLCO_RATE_LIMITED: ['요청 제한', retry],
      WB_CLCO_TIMEOUT: ['시간 초과', retry],
      REQUEST_TIMEOUT: ['시간 초과', retry],
      ENGINE_TIMEOUT: ['시간 초과', retry],
      TIMEOUT: ['시간 초과', retry],
      WB_CLCO_NETWORK_ERROR: ['네트워크 연결 실패', retry],
      NETWORK_ERROR: ['네트워크 연결 실패', retry],
      WB_CLCO_SERVER_UNAVAILABLE: ['AI 서버 응답 없음', retry],
      WB_CLCO_CANCELLED: ['취소됨', cancelled],
      CANCELLED: ['취소됨', cancelled],
      REQUEST_CANCELLED: ['취소됨', cancelled],
      MODEL_NOT_CONFIGURED: ['사용할 모델 없음', models],
      ON_AI_MODEL_LIST_EMPTY: ['사용할 모델 없음', models],
      SUBJECT_SCOPE_UNVERIFIED: ['현재 계정·사건 연결 확인 불가', verify],
      ON_AI_INVALID_INPUT: ['사건 입력 확인 불가', '원래 기록의 사건 ID·근거·규칙을 확인하세요.'],
      ON_AI_INVALID_OUTPUT: ['사건 설명 결과 확인 불가', '원래 기록을 확인하고 담당자에게 문의하세요.'],
      AI_REQUEST_UNVERIFIED: ['AI 연결 또는 응답 확인 불가', verify],
    };
    const known = Object.hasOwn(reasons, error?.code);
    const code = known ? error.code : 'AI_REQUEST_UNVERIFIED';
    const [reason, guidance] = reasons[code];
    const message = known && safeAiText(error?.message)
      ? error.message : 'AI 연결 또는 응답을 확인할 수 없습니다. 원문 오류는 표시하지 않습니다.';
    return { code, message, reason, guidance };
  };
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
    renderAiConnection({ status, mode, data, error, checkedAt, explanationAccepted }) {
      const root = document.createElement('div');
      const line = (text) => {
        const p = document.createElement('p');
        p.textContent = text;
        root.appendChild(p);
      };
      if (mode === 'demo') line('예제 자료 · 실제 AI 연결을 확인한 결과가 아닙니다.');
      if (mode === 'disconnected') line('연결 없음(disconnected)');
      if (mode === 'unknown') line('연결 상태 확인 불가(unknown)');
      if (status === 'idle') {
        line('AI 연결 점검 전');
      } else if (status === 'loading') {
        line('AI 연결 점검 중');
      } else if (status === 'error') {
        const failure = aiFailureInfo(error);
        line(`AI 연결 점검 실패 · ${failure.reason}`);
        line(`오류 코드: ${failure.code}`);
        line(`오류 메시지: ${failure.message}`);
        line(failure.guidance);
      } else if (status === 'ok' && data?.transportChecked === true
        && ['test', 'verified'].includes(data.audienceAuthorization)
        && Number.isInteger(data.modelCount) && data.modelCount >= 0 && data.modelCount <= 10000) {
        line(data.audienceAuthorization === 'test' ? '시험 연결 점검(test)' : '앱 권한 확인 후 점검(verified)');
        line(`모델 수: ${data.modelCount}`);
        line(`점검 시각: ${safeAiText(checkedAt, 100) ? checkedAt : '확인 불가'}`);
        if (data.audienceAuthorization === 'test') line('시험용 연결 점검이며 실제 앱 권한의 검증을 뜻하지 않습니다.');
        if (data.modelCount === 0) line('쓸 수 있는 모델이 없습니다. 담당자에게 모델 허용 설정을 확인하세요.');
      } else {
        line('AI 연결 점검 결과 확인 불가');
      }
      // 이 입력의 explanationAccepted는 false이며 모델 목록 응답으로 설명 성공을 만들지 않습니다.
      line('이 화면은 연결 점검 결과입니다. 사건 설명은 아직 실행하지 않았습니다.');
      line('다시 점검하려면 제공 영역의 AI 연결 점검 버튼을 직접 누르세요. 자동으로 다시 점검하지 않습니다.');
      return root;
    },
    renderExplanation({ event, explanation, checkedAt }) {
      const root = document.createElement('div');
      const element = (tag, text) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const line = (text) => {
        root.appendChild(element('p', text));
      };
      const fail = (reason, error = explanation?.error) => {
        const failure = aiFailureInfo(error || {
          code: 'ON_AI_INVALID_OUTPUT', message: 'AI 설명의 근거·현재 상태·미실행 정보를 확인할 수 없습니다.',
        });
        line(`AI 설명 실패: ${failure.message}`);
        line(`오류 코드: ${failure.code}`);
        line(`실패 이유: ${reason || failure.reason}`);
        line(failure.guidance);
        line('기록은 그대로입니다. 업무 앱 판정과 보안 기록은 유지됩니다. AI 설명 요청 실패와 과제 판정은 별개입니다.');
        return root;
      };
      // 근거 부족 등으로 event가 null이어도 전달된 실패 이유부터 보여 줍니다.
      if (explanation?.status === 'error') {
        return fail(aiFailureInfo(explanation.error).reason);
      }
      if (!event) {
        line('보안 기록에서 기록을 먼저 고르세요');
        return root;
      }
      if (!explanation || explanation.status === 'idle') {
        line('AI 사건 설명 요청 전입니다. 선택한 기록의 설명 버튼을 직접 눌러 요청하세요.');
        return root;
      }
      if (explanation.status === 'loading') {
        line('AI 설명 요청 중');
        return root;
      }
      if (explanation.status !== 'ok') return fail('설명 요청 상태를 확인할 수 없습니다.');
      const data = explanation.data;
      const safeId = (id) => safeAiText(id, 80) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id);
      if (!safeId(event.id) || !safeAiText(data?.summary, 1500)) {
        return fail('사건 ID 또는 AI 요약을 확인할 수 없어 이 설명을 쓸 수 없습니다.');
      }
      if (data.executed === true) {
        return fail('AI가 이미 실행했다고 답한 설명은 쓸 수 없습니다. 실제 조치 실행을 확인한 결과가 아닙니다.');
      }
      if (data.executed !== false || data.requiresHumanConfirmation !== true) {
        return fail('사람 확인 필요 여부와 미실행 상태가 맞지 않아 이 설명을 쓸 수 없습니다.');
      }
      if (!Array.isArray(event.evidence) || event.evidence.length === 0) {
        return fail('선택한 사건의 근거가 부족해 이 설명을 쓸 수 없습니다.');
      }
      if (!event.evidence.every((row) => safeId(row?.id) && safeAiText(row?.text, 500))) {
        return fail('선택한 사건의 근거 ID와 근거 글을 확인할 수 없습니다.');
      }
      const evidence = new Map(event.evidence.map((row) => [row.id, row.text]));
      const validReferences = (refs) => Array.isArray(refs) && refs.length > 0
        && new Set(refs).size === refs.length && refs.every((id) => evidence.has(id));
      if (evidence.size !== event.evidence.length || !validReferences(data.evidenceIds)
        || data.evidenceIds.length !== evidence.size) {
        return fail('인용 근거가 현재 사건의 근거와 맞지 않습니다. 누락·중복·없는 근거 ID가 있는 설명은 쓸 수 없습니다.');
      }
      if (!Array.isArray(event.rules) || event.rules.length === 0
        || !event.rules.every((rule) => safeId(rule?.id) && safeAiText(rule?.text, 300))) {
        return fail('선택한 사건의 규칙 ID와 규칙 글을 확인할 수 없습니다.');
      }
      const states = {
        access: { name: '접속', values: ['allowed', 'denied', 'unknown'] },
        session: { name: '세션', values: ['active', 'expired', 'revoked', 'unknown'] },
        device: { name: '기기', values: ['compliant', 'noncompliant', 'unknown'] },
      };
      if (!event.state || !Object.entries(states).every(([key, info]) => info.values.includes(event.state[key]))) {
        return fail('선택한 사건의 접속·세션·기기 상태를 확인할 수 없습니다.');
      }
      if (!Array.isArray(event.supportedActions) || !Array.isArray(data.proposals)
        || !data.proposals.every((proposal) => safeId(proposal?.action)
          && event.supportedActions.includes(proposal.action) && safeAiText(proposal.reason, 500)
          && validReferences(proposal.evidenceIds))) {
        return fail('제안의 지원 조치·이유·근거가 현재 사건과 맞지 않아 이 설명을 쓸 수 없습니다.');
      }
      // 모든 대조가 끝난 설명에만 성공 표식을 붙입니다. 이전 DOM을 재사용하지 않습니다.
      root.setAttribute('data-student-explanation-event', event.id);
      root.appendChild(element('h3', 'AI 설명(참고용)'));
      if (explanation.mode === 'demo') line('예제 자료 · 실제 AI 설명 실행의 증거가 아닙니다.');
      line(`사건 ID: ${event.id}`);
      line(`AI 요약: ${data.summary}`);
      line(`설명 시각: ${safeAiText(checkedAt, 100) ? checkedAt : '확인 불가'}`);
      line('AI 설명은 해석입니다. 사실 판단은 근거 글과 연동 시스템이 알려 준 현재 상태를 기준으로 합니다.');
      root.appendChild(element('h4', '인용한 근거'));
      const evidenceList = element('ul');
      for (const id of data.evidenceIds) evidenceList.appendChild(element('li', `${id} — ${evidence.get(id)}`));
      root.appendChild(evidenceList);
      root.appendChild(element('h4', '규칙'));
      const rules = element('ul');
      for (const rule of event.rules) rules.appendChild(element('li', `${rule.id} — ${rule.text}`));
      root.appendChild(rules);
      root.appendChild(element('h4', '확인 불가 상태'));
      const unknown = Object.entries(states).filter(([key]) => event.state[key] === 'unknown');
      if (unknown.length === 0) {
        line('없음');
      } else {
        const list = element('ul');
        for (const [, info] of unknown) list.appendChild(element('li', `${info.name}: 확인 불가(unknown)`));
        root.appendChild(list);
      }
      root.appendChild(element('h4', '조치 제안'));
      if (data.proposals.length === 0) {
        line(event.supportedActions.length === 0
          ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상)'
          : 'AI가 이 기록에 대해 제안한 조치가 없습니다.');
      } else {
        const list = element('ul');
        for (const proposal of data.proposals) {
          const item = element('li');
          item.appendChild(element('p', `조치: ${proposal.action}`));
          item.appendChild(element('p', `이유: ${proposal.reason}`));
          item.appendChild(element('p', `근거 ID: ${proposal.evidenceIds.join(', ')}`));
          item.appendChild(element('p', '사람 확인이 필요하며 실행되지 않았습니다'));
          list.appendChild(item);
        }
        root.appendChild(list);
      }
      line('설명·제안만으로 보안 조치는 실행되지 않습니다. 이 화면은 조치 요청을 전송하지 않습니다.');
      return root;
    },
    renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error }) {
      // 현재 입력만 그리며 요청·확인 티켓·이전 결과를 저장하거나 실행하지 않습니다.
      const root = document.createElement('div');
      const line = (text) => {
        const p = document.createElement('p');
        p.textContent = text;
        root.appendChild(p);
      };
      const present = (input) => safeAiText(input, 200);
      const field = (name, input) => {
        if (present(input)) line(`${name}: ${input}`);
      };
      const labels = {
        idle: '아직 미실행(idle)',
        loading: '조치 준비 또는 결과 조회 중(loading). 결과가 아직 확인되지 않았습니다.',
        prepared: '준비됨·미실행(prepared)',
        executing: '서버에 전달 중(executing). 결과가 아직 확인되지 않았습니다.',
        pending: '서버 접수·처리 중(pending). 접수 응답(ACK)만으로 실제 효과를 판단할 수 없습니다.',
        succeeded: '효과 확인(succeeded)',
        denied: '거절(denied)',
        failed: '실패(failed)',
        unknown: '결과 불명(unknown)',
        expired: '확인 기한 지남(expired)',
        error: '요청이 처리되지 않았습니다(error)',
      };
      const known = Object.hasOwn(labels, status);
      const mismatch = (present(event?.id) && present(receipt?.eventId) && event.id !== receipt.eventId)
        || (present(actionId) && present(receipt?.actionId) && actionId !== receipt.actionId)
        || (present(target?.id) && present(receipt?.target?.id) && target.id !== receipt.target.id)
        || (Number.isSafeInteger(target?.generation) && Number.isSafeInteger(receipt?.target?.generation)
          && target.generation !== receipt.target.generation)
        || (status === 'succeeded' && present(receipt?.status) && receipt.status !== 'succeeded');
      const currentStatus = !known || mismatch || (status === 'succeeded' && observation?.effectApplied !== true)
        ? 'unknown' : status;
      line(labels[currentStatus]);
      if (currentStatus === 'idle') {
        if (safeAiText(message, 1000)) line(message);
        line('조치 제안은 실행이 아닙니다. 현재 화면에 준비된 요청은 없습니다.');
        line('조치 화면 취소는 이미 서버에 전달된 조치의 효과를 되돌리는 기능이 아닙니다.');
        return root;
      }
      if (mismatch) {
        line('현재 사건·조치·실제 대상과 서버의 요청 결과가 맞지 않아 같은 요청의 결과로 표시할 수 없습니다.');
      } else {
        // 이 속성들은 현재 사건·요청의 연결을 표시하며 효과 성공을 뜻하지 않습니다.
        if (present(event?.id)) root.setAttribute('data-student-action-event', event.id);
        if (present(receipt?.requestId)) root.setAttribute('data-student-action-request', receipt.requestId);
        field('사건 ID(event.id)', event?.id);
        if (Array.isArray(event?.evidence)) {
          for (const row of event.evidence) field('근거 ID', row?.id);
        }
        field('조치(actionId)', actionId);
        field('실제 대상(target.id)', target?.id);
        if (Number.isSafeInteger(target?.generation)) line(`대상 세대(generation): ${target.generation}`);
        field('요청 ID(requestId)', receipt?.requestId);
        field('접수 기록 ID(receiptId)', receipt?.receiptId);
        if (Number.isSafeInteger(receipt?.version)) line(`결과 버전(version): ${receipt.version}`);
        if (receipt?.replayed === true) line('같은 요청의 기존 결과를 다시 표시합니다(replayed: true). 새 조치를 실행하지 않습니다.');
      }
      if (currentStatus === 'prepared') {
        line(`사람 확인 기한: ${present(confirmationExpiresAt) ? confirmationExpiresAt : '확인 불가'}`);
        line('실제 대상·대상 세대·확인 기한을 읽고 제공 화면의 사람 확인 버튼을 직접 눌러야 합니다. 아직 실행되지 않았습니다.');
      } else if (currentStatus === 'succeeded') {
        line(`관측 시각: ${present(observation.observedAt) ? observation.observedAt : '확인 불가'}`);
        line('effectApplied: true');
        if (!present(receipt?.receiptId)) line('접수 기록 ID(receiptId): 확인 불가');
      } else if (currentStatus === 'unknown') {
        line('성공 여부와 효과 유무를 판단할 수 없습니다. 효과 없음으로도 단정하지 마세요.');
        line('재실행하지 말고 제공 화면의 결과만 재조회하는 버튼을 직접 눌러 현재 결과를 확인하세요.');
      } else if (currentStatus === 'expired') {
        line('확인 기한이 지났으므로 제공 화면에서 조치를 다시 준비하고 실제 대상을 확인하세요.');
      }
      if (['denied', 'failed', 'error'].includes(currentStatus) && safeAiText(message, 1000)) line(message);
      if (['denied', 'failed', 'unknown', 'error', 'expired'].includes(currentStatus) && error) {
        const codes = new Set([
          'ACTION_UNSUPPORTED', 'ACTION_DENIED', 'ACTION_CONFIRMATION_EXPIRED', 'ACTION_CONFIRMATION_INVALID',
          'ACTION_SCOPE_CHANGED', 'ACTION_SCOPE_UNVERIFIED', 'SUBJECT_SCOPE_UNVERIFIED', 'ACTION_SNAPSHOT_CHANGED',
          'ACTION_EVENT_UNAVAILABLE', 'ACTION_TIMEOUT', 'ACTION_STORE_FAILED', 'ACTION_RESULT_UNVERIFIED',
        ]);
        const code = codes.has(error.code) ? error.code : 'ACTION_RESULT_UNVERIFIED';
        line(`오류 코드: ${code}`);
        line(`오류 메시지: ${codes.has(error.code) && safeAiText(error.message) ? error.message : '조치 요청 결과를 확인할 수 없습니다.'}`);
      } else if (currentStatus === 'error') {
        line('조치 요청이 처리되지 않았습니다. 제공 화면의 현재 오류 안내를 확인하세요.');
      }
      line('조치 버튼과 사람 확인은 제공 화면을 사용하세요. 이 학생 영역은 요청을 보내거나 자동으로 다시 실행하지 않습니다.');
      line('조치 화면 취소는 이미 서버에 전달된 조치의 효과를 되돌리는 기능이 아닙니다.');
      return root;
    },
  };
}
