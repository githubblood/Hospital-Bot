// Platform-only global search (Stage 4B) — completely separate from the
// hospital-admin panel's own global search (js/topbar.js's runGlobalSearch,
// scoped to one hospital and untouched by this file). Same dropdown-panel
// visual pattern as that one for consistency, wired independently here since
// the platform shell has no topbar.js dependency at all.
const searchInput = document.getElementById('platformSearchInput');
const searchPanel = document.getElementById('platformSearchPanel');

function closeSearchPanel() {
    searchPanel?.classList.remove('open');
}

const SECTION_LABELS = { hospitals: 'Hospitals', doctors: 'Doctors', patients: 'Patients', staff: 'Staff' };

function resultHref(item) {
    if (item.type === 'hospital') return `hospital-detail.html?id=${item.id}`;
    if (item.hospitalId) return `hospital-detail.html?id=${item.hospitalId}`;
    return null;
}

function renderResults(results) {
    const sections = ['hospitals', 'doctors', 'patients', 'staff'];
    const hasAny = sections.some(s => results[s] && results[s].length > 0);
    if (!hasAny) {
        searchPanel.innerHTML = '<div class="dropdown-empty">No matches.</div>';
        return;
    }

    let html = '';
    sections.forEach(section => {
        const items = results[section] || [];
        if (items.length === 0) return;
        html += `<div class="dropdown-header">${SECTION_LABELS[section]}</div>`;
        html += items.map(item => {
            const href = resultHref(item);
            const meta = [item.hospital, item.branch, item.department].filter(Boolean).join(' • ');
            return `
                <button type="button" class="dropdown-item" data-href="${href || ''}">
                    ${escapeHtml(item.name)}<small>${escapeHtml(meta)}${item.status ? ' — ' + escapeHtml(String(item.status)) : ''}</small>
                </button>
            `;
        }).join('');
    });
    searchPanel.innerHTML = html;
    searchPanel.querySelectorAll('[data-href]').forEach(btn => {
        const href = btn.dataset.href;
        if (!href) return;
        btn.addEventListener('click', () => { window.location.href = href; });
    });
}

async function runSearch(q) {
    searchPanel.classList.add('open');
    searchPanel.innerHTML = '<div class="dropdown-empty">Searching…</div>';
    try {
        const res = await PlatformAuth.authFetch(`/api/platform/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderResults(data);
    } catch (err) {
        searchPanel.innerHTML = '<div class="dropdown-empty">Search failed.</div>';
    }
}

if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) { closeSearchPanel(); return; }
        debounceTimer = setTimeout(() => runSearch(q), 300);
    });
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2) runSearch(searchInput.value.trim());
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#platformSearchWrap')) closeSearchPanel();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearchPanel(); });
}
