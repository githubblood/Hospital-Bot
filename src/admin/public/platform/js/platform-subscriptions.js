PlatformAuth.requireAuth();

let currentPage = 1;
let currentPagination = null;
let searchDebounceTimer = null;

function statusClass(status) {
    return 'status-' + status.toLowerCase().replace(/\s+/g, '-');
}
function statusBadge(status) {
    return `<span class="badge ${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'none';
}
function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorState').textContent = message;
    document.getElementById('tableWrap').style.display = 'none';
}
function showTable() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'block';
}

async function loadSubscriptions(page = 1) {
    showLoading();
    currentPage = page;
    const search = document.getElementById('searchInput').value.trim();
    const status = document.getElementById('statusFilter').value;

    const params = new URLSearchParams({ page, pageSize: 20 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/subscriptions?${params.toString()}`);
        if (!res.ok) { showError('Could not load subscriptions.'); return; }
        const data = await res.json();
        renderTable(data.subscriptions);
        renderPagination(data.pagination);
        showTable();
    } catch (err) {
        console.error('Failed to load subscriptions:', err);
        showError('Could not reach the server.');
    }
}

function renderTable(subscriptions) {
    const tbody = document.getElementById('tableBody');
    const empty = document.getElementById('emptyState');
    tbody.innerHTML = '';
    empty.style.display = subscriptions.length === 0 ? 'block' : 'none';

    subscriptions.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Hospital"><a href="subscription-detail.html?hospitalId=${s.hospital_id}">${escapeHtml(s.hospital_name)}</a></td>
            <td data-label="Plan">${escapeHtml(s.plan_name || '—')}</td>
            <td data-label="Status">${statusBadge(s.effective_status)}</td>
            <td data-label="Trial Ends">${escapeHtml(s.trial_end_date || '—')}</td>
            <td data-label="Subscription Ends">${escapeHtml(s.subscription_end || '—')}</td>
            <td data-label="Grace Period Ends">${escapeHtml(s.grace_period_end || '—')}</td>
            <td data-label="Actions">
                <div class="actions-cell">
                    <a class="action-btn action-view" href="subscription-detail.html?hospitalId=${s.hospital_id}">View</a>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPagination(pagination) {
    currentPagination = pagination;
    document.getElementById('paginationInfo').textContent =
        `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} hospital${pagination.total === 1 ? '' : 's'})`;
    document.getElementById('prevPageBtn').disabled = pagination.page <= 1;
    document.getElementById('nextPageBtn').disabled = pagination.page >= pagination.totalPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPagination.page > 1) loadSubscriptions(currentPagination.page - 1); });
document.getElementById('nextPageBtn').addEventListener('click', () => { if (currentPagination.page < currentPagination.totalPages) loadSubscriptions(currentPagination.page + 1); });

document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadSubscriptions(1), 350);
});
document.getElementById('statusFilter').addEventListener('change', () => loadSubscriptions(1));

loadSubscriptions(1);
