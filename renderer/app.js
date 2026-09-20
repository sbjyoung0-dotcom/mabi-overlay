(async () => {
  const config = await window.mabi.invoke(CH.CONFIG_GET);
  document.getElementById('gather-status').textContent = `config OK (${config.layout})`;
  window.mabi.on(CH.EV_CONN, (s) => {
    const b = document.getElementById('badge-conn');
    b.textContent = s.connected ? '' : `연결 없음: ${s.reason}`;
    b.classList.toggle('hidden', s.connected);
  });
  document.getElementById('btn-quit').addEventListener('click', () => window.mabi.invoke(CH.WINDOW_QUIT));
})();
