let selectedBillId = null;
let selectedAppointmentFee = 0;

function statusBadge(status) {
    const cls = status.toLowerCase();
    return `<span class="badge badge-${cls === 'paid' ? 'confirmed' : cls === 'partial' ? 'pending' : 'cancelled'}">${status}</span>`;
}

// ---- Stats ----
async function loadStats() {
    const res = await AdminAuth.authFetch('/api/admin/billing/stats');
    const data = await res.json();
    document.getElementById('statTodayCollection').textContent = '₹' + data.today_collection.toLocaleString('en-IN');
    document.getElementById('statUnpaid').textContent = data.unpaid_count;
    document.getElementById('statTodayTotal').textContent = data.today_total;
    document.getElementById('statMonth').textContent = '₹' + data.month_collection.toLocaleString('en-IN');
}

// ---- List ----
async function loadBills() {
    const date = document.getElementById('filterDate').value;
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('filterSearch').value.trim();

    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const res = await AdminAuth.authFetch('/api/admin/billing?' + params.toString());
    const { bills } = await res.json();

    const tbody = document.getElementById('tableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    if (bills.length === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
        bills.forEach(b => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Bill #"><strong>#${b.id}</strong></td>
                <td data-label="Patient">${escapeHtml(b.patient_name)}<br><small>${escapeHtml(b.phone_number)}</small></td>
                <td data-label="Doctor">Dr. ${escapeHtml(b.doctor_name)}</td>
                <td data-label="Date">${b.bill_date}</td>
                <td data-label="Amount"><strong>₹${Number(b.total_amount).toLocaleString('en-IN')}</strong></td>
                <td data-label="Payment">${b.payment_method}</td>
                <td data-label="Status">${statusBadge(b.payment_status)}</td>
                <td data-label="Actions"><button class="action-btn" data-id="${b.id}">View</button></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) viewBill(btn.dataset.id);
});

let searchDebounce = null;
document.getElementById('filterDate').addEventListener('change', loadBills);
document.getElementById('filterStatus').addEventListener('change', loadBills);
document.getElementById('filterSearch').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadBills, 300);
});
document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterSearch').value = '';
    loadBills();
});

// ---- Bill Detail modal ----
async function viewBill(billId) {
    selectedBillId = billId;
    const res = await AdminAuth.authFetch(`/api/admin/billing/${billId}`);
    if (!res.ok) { Toast.show('Could not load bill', 'error'); return; }
    const b = await res.json();

    document.getElementById('billDetailContent').innerHTML = `
        <div class="bill-summary-header">
            <div class="bill-header-row">
                <div class="bill-header-patient">
                    <div class="bill-header-sub">Bill #${b.id}</div>
                    <div class="bill-header-name">${escapeHtml(b.patient_name)}</div>
                    <div class="bill-header-sub">${escapeHtml(b.phone_number)}</div>
                </div>
                <div class="bill-header-amount">
                    <div class="bill-total-big">₹${Number(b.total_amount).toLocaleString('en-IN')}</div>
                    <span class="status-chip">${escapeHtml(b.payment_status)}</span>
                </div>
            </div>
        </div>
        <div class="detail-row"><span class="lbl">👨‍⚕️ Doctor</span><span>Dr. ${escapeHtml(b.doctor_name)}</span></div>
        <div class="detail-row"><span class="lbl">📅 Date</span><span>${b.bill_date}</span></div>
        <div class="detail-row"><span class="lbl">💳 Payment Method</span><span>${b.payment_method}</span></div>
        <div class="detail-row"><span class="lbl">🩺 Consultation</span><span>₹${b.consultation_fee}</span></div>
        <div class="detail-row"><span class="lbl">💊 Medicine</span><span>₹${b.medicine_charges}</span></div>
        <div class="detail-row"><span class="lbl">🧪 Tests</span><span>₹${b.test_charges}</span></div>
        <div class="detail-row"><span class="lbl">📦 Other</span><span>₹${b.other_charges}</span></div>
        <div class="detail-row"><span class="lbl">🏷️ Discount</span><span>-₹${b.discount}</span></div>
        ${b.notes ? `<div class="detail-row"><span class="lbl">📝 Notes</span><span>${escapeHtml(b.notes)}</span></div>` : ''}
    `;

    document.getElementById('markPaidBtn').style.display = b.payment_status === 'Paid' ? 'none' : 'inline-flex';
    document.getElementById('billDetailModal').classList.add('show');
}

document.getElementById('closeBillDetailBtn').addEventListener('click', () => {
    document.getElementById('billDetailModal').classList.remove('show');
});

document.getElementById('markPaidBtn').addEventListener('click', async () => {
    if (!selectedBillId) return;
    const res = await AdminAuth.authFetch(`/api/admin/billing/${selectedBillId}/pay`, { method: 'PATCH' });
    if (res.ok) {
        document.getElementById('billDetailModal').classList.remove('show');
        loadBills();
        loadStats();
    }
});

document.getElementById('sendWhatsAppBtn').addEventListener('click', async () => {
    if (!selectedBillId) return;
    const res = await AdminAuth.authFetch(`/api/admin/billing/${selectedBillId}/whatsapp`, { method: 'POST' });
    const data = await res.json();
    Toast.show(res.ok ? 'Bill sent on WhatsApp!' : (data.error || 'Failed to send'), res.ok ? 'success' : 'error');
});

document.getElementById('printBillBtn').addEventListener('click', () => window.print());

// Close modal on backdrop click.
document.getElementById('billDetailModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

loadStats();
loadBills();
