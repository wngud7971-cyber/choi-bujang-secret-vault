const installation = document.querySelector('#installation-status');
const connection = document.querySelector('#connection-status');
const install = document.querySelector('#install-app');
const standalone = window.matchMedia('(display-mode: standalone)');
let prompt;

function showInstallation() {
  installation.textContent = standalone.matches || navigator.standalone === true
    ? '접속 앱 화면으로 열었습니다. 기기 승인은 서버 확인이 필요합니다.'
    : '브라우저에서 열었습니다. 브라우저 메뉴에서 앱 설치 또는 홈 화면 추가를 선택할 수 있습니다.';
}
function showConnection() {
  connection.textContent = navigator.onLine === false
    ? '오프라인입니다. 보호 자료는 표시하거나 저장하지 않습니다. 연결 후 다시 시도해 주세요.'
    : '인터넷 연결이 감지됐습니다. 실제 접속과 기기 승인 여부는 서버가 확인합니다.';
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  prompt = event;
  install.hidden = false;
});
install.addEventListener('click', async () => {
  if (!prompt) return;
  const current = prompt;
  prompt = null;
  install.hidden = true;
  try { await current.prompt(); await current.userChoice; }
  catch { installation.textContent = '설치 창을 열지 못했습니다. 브라우저 메뉴에서 설치해 주세요.'; }
});
window.addEventListener('appinstalled', () => {
  prompt = null;
  install.hidden = true;
  installation.textContent = '앱이 설치됐습니다. 기기 승인은 서버 확인이 필요합니다.';
});
standalone.addEventListener('change', showInstallation);
window.addEventListener('online', showConnection);
window.addEventListener('offline', showConnection);
showInstallation();
showConnection();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Online login and notes still work if the optional offline guide is unavailable.
  });
}
