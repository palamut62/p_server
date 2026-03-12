const activeCount = document.getElementById('activeCount');
const portCount = document.getElementById('portCount');
const memoryCount = document.getElementById('memoryCount');
const refreshedAt = document.getElementById('refreshedAt');
const statusText = document.getElementById('statusText');
const serverList = document.getElementById('serverList');
const livePill = document.getElementById('livePill');
const refreshBtn = document.getElementById('refreshBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const quitBtn = document.getElementById('quitBtn');
const copyStatusBtn = document.getElementById('copyStatusBtn');

function formatTime(isoValue) {
  if (!isoValue) {
    return '-';
  }

  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(isoValue));
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderServers(servers) {
  if (!servers.length) {
    serverList.innerHTML = `
      <div class="empty-state">
        <strong>Acik gelistirme sunucusu bulunmadi.</strong>
        <span>VS Code, terminal ya da IDE tarafindan acilmis bir local server gorunurse burada listelenecek.</span>
      </div>
    `;
    return;
  }

  serverList.innerHTML = servers.map((server) => `
    <article class="server-card">
      <div class="server-topline">
        <div>
          <p class="server-runtime">${escapeHtml(server.runtime)}</p>
          <h2>${escapeHtml(server.displayName)}</h2>
        </div>
        <span class="server-port">:${server.primaryPort || '-'}</span>
      </div>
      <p class="server-command">${escapeHtml(server.command)}</p>
      <div class="server-meta">
        <span>PID ${server.pid}</span>
        <span>${escapeHtml(server.scope)}</span>
        <span>${server.memoryMb} MB</span>
        <span>Portlar ${server.ports.join(', ')}</span>
      </div>
      <div class="server-actions">
        ${server.url ? `<button class="btn btn-secondary" data-copy="${escapeHtml(server.url)}">URL Kopyala</button>` : ''}
        <button class="btn btn-secondary" data-copy="${escapeHtml(server.command)}">Komut Kopyala</button>
        <button class="btn btn-danger" data-stop="${server.pid}">Kapat</button>
      </div>
    </article>
  `).join('');
}

function renderState(state) {
  activeCount.textContent = state.summary.activeCount;
  portCount.textContent = state.summary.portCount;
  memoryCount.textContent = `${state.summary.totalMemoryMb} MB`;
  refreshedAt.textContent = formatTime(state.summary.refreshedAt);
  stopAllBtn.disabled = state.summary.activeCount === 0;

  if (state.summary.error) {
    statusText.textContent = state.summary.error;
    livePill.textContent = 'Hata';
    livePill.dataset.status = 'error';
  } else if (state.summary.activeCount > 0) {
    statusText.textContent = `${state.summary.activeCount} sunucu izleniyor`;
    livePill.textContent = 'Aktif';
    livePill.dataset.status = 'active';
  } else {
    statusText.textContent = 'Sistem temiz';
    livePill.textContent = 'Bos';
    livePill.dataset.status = 'idle';
  }

  renderServers(state.servers);
}

function flashCopyFeedback(button) {
  if (!button) {
    return;
  }

  const originalTitle = button.getAttribute('title') || '';
  button.setAttribute('title', 'Kopyalandi');
  button.dataset.copied = 'true';

  window.setTimeout(() => {
    button.setAttribute('title', originalTitle);
    delete button.dataset.copied;
  }, 900);
}

refreshBtn.addEventListener('click', async () => {
  const state = await window.api.refreshState();
  renderState(state);
});

stopAllBtn.addEventListener('click', async () => {
  const state = await window.api.stopAllServers();
  renderState(state);
});

quitBtn.addEventListener('click', () => window.api.quit());

copyStatusBtn.addEventListener('click', async () => {
  await window.api.copyText(statusText.textContent.trim());
  flashCopyFeedback(copyStatusBtn);
});

serverList.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) {
    return;
  }

  const copyValue = target.dataset.copy;
  const stopPid = target.dataset.stop;

  if (copyValue) {
    await window.api.copyText(copyValue);
    const originalText = target.textContent;
    target.textContent = 'Kopyalandi';
    flashCopyFeedback(target);
    window.setTimeout(() => {
      target.textContent = originalText;
    }, 900);
    return;
  }

  if (stopPid) {
    const state = await window.api.stopServer(Number(stopPid));
    renderState(state);
  }
});

window.api.onStateUpdate((state) => {
  renderState(state);
});

(async () => {
  const state = await window.api.getState();
  renderState(state);
})();
