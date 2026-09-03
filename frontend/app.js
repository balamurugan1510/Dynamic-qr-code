// ── API layer ──────────────────────────────────────────────────────────────
class QRManager {
  async batchCreate(count, labelPrefix) {
    const res = await fetch('/qr/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: parseInt(count), label_prefix: labelPrefix }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to generate QR codes');
    }
    return res.json();
  }

  async list(status = null) {
    const url = status ? `/qr/list?status=${status}` : '/qr/list';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch list');
    return res.json();
  }

  async assign(code, targetUrl, label) {
    const body = { target_url: targetUrl };
    if (label) body.label = label;
    const res = await fetch(`/qr/${code}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to assign URL');
    }
    return res.json();
  }

  async reassign(code, targetUrl) {
    const res = await fetch(`/qr/${code}/reassign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_url: targetUrl }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to update URL');
    }
    return res.json();
  }

  async setStatus(code, status) {
    const res = await fetch(`/qr/${code}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to update status');
    return res.json();
  }

  async deleteQR(code) {
    const res = await fetch(`/qr/${code}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    return res.json();
  }

  downloadZip(status = null) {
    const url = status ? `/qr/download/zip?status=${status}` : '/qr/download/zip';
    window.location.href = url;
  }

  downloadSingle(code) {
    window.location.href = `/qr/${code}/download`;
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 3200);
}

// ── Badge helper ───────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    UNASSIGNED: 'badge-unassigned',
    ACTIVE:     'badge-active',
    INACTIVE:   'badge-inactive',
    EXPIRED:    'badge-expired',
  };
  return `<span class="badge ${map[status] || 'badge-unassigned'}">${status}</span>`;
}

// ── Main App ───────────────────────────────────────────────────────────────
class App {
  constructor() {
    this.api   = new QRManager();
    this.qrs   = [];
    this.activeFilter = null;
    this.modalCode = null;
    this.modalMode = null; // 'assign' | 'edit'
    this._refreshInterval = null;

    this._bind();
    this.loadList();
    this._startAutoRefresh();
  }

  _bind() {
    // Generate form
    const genForm = document.getElementById('gen-form');
    if (genForm) {
      genForm.addEventListener('submit', e => {
        e.preventDefault();
        this.handleGenerate();
      });
    }

    // Filter tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFilter = tab.dataset.status || null;
        this.renderGrid();
      });
    });

    // Download ZIP button
    const zipBtn = document.getElementById('btn-download-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', () => {
        this.api.downloadZip(this.activeFilter);
      });
    }

    // ── Event delegation on grid ──
    const grid = document.getElementById('qr-grid');
    if (grid) {
      grid.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        this.handleCardAction(btn.dataset.action, btn.dataset.code);
      });
    }

    // Modal overlay & close
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeModal();
      });
    }
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', e => {
        e.preventDefault();
        this.closeModal();
      });
    }
    const modalForm = document.getElementById('modal-form');
    if (modalForm) {
      modalForm.addEventListener('submit', e => {
        e.preventDefault();
        this.handleModalSave();
      });
    }
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  async handleGenerate() {
    const countEl  = document.getElementById('gen-count');
    const prefixEl = document.getElementById('gen-prefix');
    const count  = countEl ? countEl.value : 5;
    const prefix = (prefixEl && prefixEl.value.trim()) || 'QR';
    const btn    = document.getElementById('btn-generate');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating…';
    }

    try {
      const newQRs = await this.api.batchCreate(count, prefix);
      this.qrs = [...newQRs, ...this.qrs];
      this.renderGrid();
      this.updateStats();
      toast(`✨ Generated ${newQRs.length} QR codes`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ Generate';
      }
    }
  }

  // ── Load list ─────────────────────────────────────────────────────────────
  async loadList() {
    try {
      this.qrs = await this.api.list();
      this.renderGrid();
      this.updateStats();
    } catch (err) {
      console.error('List error:', err);
    }
  }

  _startAutoRefresh() {
    this._refreshInterval = setInterval(() => this.loadList(), 30000);
  }

  // ── Filter & render grid ──────────────────────────────────────────────────
  renderGrid() {
    const grid = document.getElementById('qr-grid');
    if (!grid) return;

    const visible = this.activeFilter
      ? this.qrs.filter(q => q.status === this.activeFilter)
      : this.qrs;

    if (visible.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M17 17h3v3M14 20h3"/>
          </svg>
          <p>No QR codes here yet.<br>Generate some above!</p>
        </div>`;
      return;
    }

    grid.innerHTML = visible.map(q => this._cardHTML(q)).join('');
  }

  _cardHTML(q) {
    const urlDisplay = q.target_url
      ? `<span class="qr-card-url" title="${q.target_url}">${q.target_url}</span>`
      : `<span class="qr-card-url none">Not assigned</span>`;

    const actionBtns = q.status === 'UNASSIGNED'
      ? `<button type="button" class="btn btn-sm btn-success" data-action="assign" data-code="${q.short_code}" onclick="window.app.handleCardAction('assign','${q.short_code}')">🔗 Assign</button>`
      : `<button type="button" class="btn btn-sm btn-ghost" data-action="edit" data-code="${q.short_code}" onclick="window.app.handleCardAction('edit','${q.short_code}')">✏️ Edit URL</button>`;

    const toggleBtn = q.status === 'ACTIVE'
      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="disable" data-code="${q.short_code}" onclick="window.app.handleCardAction('disable','${q.short_code}')" title="Pause">⏸</button>`
      : q.status === 'INACTIVE'
      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="enable" data-code="${q.short_code}" onclick="window.app.handleCardAction('enable','${q.short_code}')" title="Activate">▶️</button>`
      : '';

    return `
      <div class="qr-card" id="card-${q.short_code}">
        <img class="qr-card-img" src="${q.qr_image_url}" alt="QR ${q.label}" loading="lazy" />
        <div class="qr-card-label" title="${q.label}">${q.label}</div>
        ${urlDisplay}
        <div class="qr-card-meta">
          ${statusBadge(q.status)}
          <span class="scan-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            ${q.scan_count}
          </span>
        </div>
        <div class="card-actions">
          ${actionBtns}
          ${toggleBtn}
          <button type="button" class="btn btn-sm btn-ghost btn-icon" data-action="download" data-code="${q.short_code}" onclick="window.app.handleCardAction('download','${q.short_code}')" title="Download PNG">⬇️</button>
          <button type="button" class="btn btn-sm btn-danger btn-icon" data-action="delete" data-code="${q.short_code}" onclick="window.app.handleCardAction('delete','${q.short_code}')" title="Delete">🗑️</button>
        </div>
      </div>`;
  }

  // ── Card actions ──────────────────────────────────────────────────────────
  async handleCardAction(action, code) {
    const qr = this.qrs.find(q => q.short_code === code);
    if (!qr) {
      // Reload in case this.qrs isn't updated yet
      await this.loadList();
      const refetched = this.qrs.find(q => q.short_code === code);
      if (!refetched) return;
      return this.handleCardAction(action, code);
    }

    if (action === 'assign') { this.openModal('assign', qr); return; }
    if (action === 'edit')   { this.openModal('edit',   qr); return; }
    if (action === 'download') { this.api.downloadSingle(code); return; }

    if (action === 'disable') {
      try {
        const updated = await this.api.setStatus(code, 'INACTIVE');
        this._updateLocal(updated); this.renderGrid(); this.updateStats();
        toast('QR paused');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (action === 'enable') {
      try {
        const updated = await this.api.setStatus(code, 'ACTIVE');
        this._updateLocal(updated); this.renderGrid(); this.updateStats();
        toast('QR activated');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (action === 'delete') {
      if (!confirm(`Delete QR "${qr.label}"? This cannot be undone.`)) return;
      try {
        await this.api.deleteQR(code);
        this.qrs = this.qrs.filter(q => q.short_code !== code);
        this.renderGrid(); this.updateStats();
        toast('QR deleted');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  openModal(mode, qr) {
    this.modalCode = qr.short_code;
    this.modalMode = mode;

    const isAssign = mode === 'assign';
    document.getElementById('modal-title').textContent    = isAssign ? '🔗 Assign URL to QR' : '✏️ Edit Target URL';
    document.getElementById('modal-subtitle').textContent = isAssign
      ? `Assigning a URL will activate this QR code.`
      : `Change where this QR code redirects.`;

    const labelRow = document.getElementById('modal-label-row');
    if (labelRow) labelRow.style.display = isAssign ? '' : 'none';

    document.getElementById('modal-label').value  = qr.label || '';
    document.getElementById('modal-url').value    = qr.target_url || '';
    document.getElementById('modal-save-btn').textContent = isAssign ? 'Activate QR' : 'Save Changes';

    // Preview thumb
    document.getElementById('modal-thumb').src = qr.qr_image_url;
    document.getElementById('modal-code').textContent = qr.short_code;
    document.getElementById('modal-redirect').textContent = qr.redirect_url;

    document.getElementById('modal-overlay').classList.add('open');
    setTimeout(() => {
      document.getElementById('modal-url').focus();
    }, 50);
  }

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('open');
    this.modalCode = null;
    this.modalMode = null;
  }

  async handleModalSave() {
    let url = document.getElementById('modal-url').value.trim();
    const label = document.getElementById('modal-label').value.trim();
    const btn   = document.getElementById('modal-save-btn');

    if (!url) {
      toast('Please enter a target URL', 'error');
      return;
    }

    // Auto-prepend https:// if user didn't type a protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      let updated;
      if (this.modalMode === 'assign') {
        updated = await this.api.assign(this.modalCode, url, label || null);
      } else {
        updated = await this.api.reassign(this.modalCode, url);
      }
      this._updateLocal(updated);
      this.renderGrid();
      this.updateStats();
      this.closeModal();
      toast(this.modalMode === 'assign' ? '✅ QR activated!' : '✅ URL updated!');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = this.modalMode === 'assign' ? 'Activate QR' : 'Save Changes';
    }
  }

  // ── Stats pills ───────────────────────────────────────────────────────────
  updateStats() {
    const counts = { total: this.qrs.length, UNASSIGNED: 0, ACTIVE: 0, INACTIVE: 0, EXPIRED: 0, scans: 0 };
    this.qrs.forEach(q => {
      counts[q.status] = (counts[q.status] || 0) + 1;
      counts.scans += q.scan_count;
    });
    const elTotal = document.getElementById('stat-total');
    const elActive = document.getElementById('stat-active');
    const elUnassigned = document.getElementById('stat-unassigned');
    const elScans = document.getElementById('stat-scans');

    if (elTotal) elTotal.textContent = counts.total;
    if (elActive) elActive.textContent = counts.ACTIVE;
    if (elUnassigned) elUnassigned.textContent = counts.UNASSIGNED;
    if (elScans) elScans.textContent = counts.scans;
  }

  // ── Local state update ────────────────────────────────────────────────────
  _updateLocal(updated) {
    const idx = this.qrs.findIndex(q => q.short_code === updated.short_code);
    if (idx !== -1) {
      this.qrs[idx] = updated;
    }
  }
}

// ── Boot & expose globally ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

