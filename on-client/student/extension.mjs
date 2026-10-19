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
        `기기: ${value(device?.label)} · ID: ${value(device?.id)} · 상태: ${label(deviceLabels, device?.status)}`);
      const sessionLine = (parent, session) => line(parent,
        `세션 ID: ${value(session?.id)} · 상태: ${label(sessionLabels, session?.status)}`);
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
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
