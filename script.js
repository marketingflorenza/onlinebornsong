// ================================================================
// 1. CONFIGURATION
// ================================================================
const CONFIG = {
    API_BASE_URL: 'https://my-facebook-backend-bsk.vercel.app/api/bornsong',
    SHEET_ID: '1dlgM7YaQmJQTuiuNdAMb6tjKHllPgIs8MjfgGZnp8jU',
    SHEET_NAME_SUMMARY: 'SUM',
    COLUMN_NAMES: {
        CUSTOMER: 'ชื่อลูกค้า', DATE: 'วันที่', PHONE: 'เบอร์ติดต่อ',
        CATEGORIES: 'หมวดหมู่', CHANNEL: 'ช่องทาง', INTEREST: 'รายการที่สนใจ',
        IS_NEW: 'ลูกค้าใหม่', P1: 'P1', P2: 'P2', UP_P1: 'ยอดอัพ P1', UP_P2: 'ยอดอัพ P2'
    }
};

// ================================================================
// 2. GLOBAL STATE
// ================================================================
let ui = {
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    refreshBtn: document.getElementById('refreshBtn'),
    geminiBtn: document.getElementById('geminiBtn'),
    loading: document.getElementById('loading'),
    errorMessage: document.getElementById('errorMessage'),
    modal: document.getElementById('detailsModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    campaignsTableHeader: document.getElementById('campaignsTableHeader')
};

let charts = {};
let allSalesDataCache = [];
let latestSalesAnalysis = {};
let latestCampaignData = [];
let latestAdsTotals = {};
let currentSort = { key: 'insights.spend', direction: 'desc' };

// ================================================================
// 3. HELPER FUNCTIONS
// ================================================================
const formatCurrency = (num) => `฿${parseFloat(num || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const formatNumber = (num) => parseInt(num || 0).toLocaleString('en-US');
const toNumber = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    const n = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(n) ? 0 : n;
};
const parseGvizDate = (gvizDate) => {
    if (!gvizDate) return null;
    const match = gvizDate.match(/Date\((\d+),(\d+),(\d+)/);
    if (match) return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    const d = new Date(gvizDate);
    return isNaN(d) ? null : d;
};
const formatDate = (date) => date ? date.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
const isNewCustomer = (row) => {
    const val = String(row[CONFIG.COLUMN_NAMES.IS_NEW] || '').trim().toLowerCase();
    return val === 'true' || val === '✔' || val === '1';
};
const getNestedValue = (obj, path) => {
    return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
};

// ================================================================
// 4. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}?since=${since}&until=${until}`);
        if (!response.ok) throw new Error('Ads API Error');
        return await response.json();
    } catch (error) {
        console.warn("Ads Fetch Error:", error);
        return { success: false, error: error.message };
    }
}

async function fetchSalesData() {
    if (allSalesDataCache.length > 0) return allSalesDataCache;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME_SUMMARY}`;
    const response = await fetch(sheetUrl);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const gvizData = JSON.parse(jsonStr);
    const cols = gvizData.table.cols.map(c => (c.label || c.id || '').trim());
    
    allSalesDataCache = gvizData.table.rows.map(r => {
        const obj = {};
        cols.forEach((col, i) => obj[col] = r.c && r.c[i] ? r.c[i].v : null);
        return obj;
    });
    return allSalesDataCache;
}

// ================================================================
// 5. DATA PROCESSING
// ================================================================
function processSalesData(rows, startDate, endDate) {
    const C = CONFIG.COLUMN_NAMES;
    const startD = new Date(startDate + 'T00:00:00');
    const endD = new Date(endDate + 'T23:59:59');

    const filteredRows = rows.filter(r => {
        const d = parseGvizDate(r[C.DATE]);
        return d && d >= startD && d <= endD;
    });

    let summary = { 
        totalBills: 0, totalRevenue: 0, totalCustomers: 0,
        p1Revenue: 0, upp1Revenue: 0, upp2Revenue: 0,
        p1Bills: 0, upp1Bills: 0, upp2Bills: 0, p2Leads: 0,
        newCustomers: 0 
    };
    let channels = {};
    let categories = {};

    filteredRows.forEach(row => {
        const p1 = toNumber(row[C.P1]);
        const up1 = toNumber(row[C.UP_P1]);
        const up2 = toNumber(row[C.UP_P2]);
        const rev = p1 + up1 + up2;
        const hasRevenue = rev > 0;
        
        if (hasRevenue || row[C.P2]) {
            summary.totalRevenue += rev;
            summary.p1Revenue += p1;
            summary.upp1Revenue += up1;
            summary.upp2Revenue += up2;
            
            if (p1 > 0) summary.p1Bills++;
            if (up1 > 0) summary.upp1Bills++;
            if (up2 > 0) summary.upp2Bills++;
            if (row[C.P2]) summary.p2Leads++;

            if (hasRevenue) summary.totalBills++;
            if (p1 > 0 || up2 > 0) summary.totalCustomers++;
            if (isNewCustomer(row)) summary.newCustomers++;

            const ch = row[C.CHANNEL] || 'ไม่ระบุ';
            if (!channels[ch]) channels[ch] = { p1: 0, p2: 0, upP2: 0, newCust: 0, revenue: 0 };
            if (p1 > 0 && up1 === 0) channels[ch].p1++;
            if (row[C.P2]) channels[ch].p2++;
            if (up2 > 0) channels[ch].upP2++;
            if (isNewCustomer(row)) channels[ch].newCust++;
            channels[ch].revenue += rev;

            const cats = String(row[C.CATEGORIES] || '').split(',').map(s => s.trim()).filter(s => s && s !== '999');
            cats.forEach(cat => {
                if (!categories[cat]) categories[cat] = { 
                    name: cat, total: 0, 
                    p1B: 0, up1B: 0, up2B: 0,
                    p1Val: 0, up1Val: 0, up2Val: 0
                };
                const count = cats.length || 1;
                categories[cat].total += rev / count;
                categories[cat].p1Val += p1 / count;
                categories[cat].up1Val += up1 / count;
                categories[cat].up2Val += up2 / count;

                if (p1 > 0) categories[cat].p1B++;
                if (up1 > 0) categories[cat].up1B++;
                if (up2 > 0) categories[cat].up2B++;
            });
        }
    });

    return { 
        summary, 
        channels, 
        categories: Object.values(categories).sort((a,b) => b.total - a.total),
        filteredRows 
    };
}

// ================================================================
// 6. RENDERING FUNCTIONS
// ================================================================

function renderFunnel(adsTotals) {
    const spend = adsTotals.spend || 0;
    const rev = latestSalesAnalysis.summary.totalRevenue || 0;
    const totalBills = latestSalesAnalysis.summary.totalBills || 0;
    const totalCustomers = latestSalesAnalysis.summary.totalCustomers || 0;
    const messaging = adsTotals.messaging_conversations || 0;
    
    const roas = spend > 0 ? rev / spend : 0;
    const cpl = totalBills > 0 ? spend / totalBills : 0;
    const costPerHead = totalCustomers > 0 ? spend / totalCustomers : 0;
    
    const bookingToClose = totalBills > 0 ? ((totalCustomers / totalBills) * 100).toFixed(2) : "0.00";
    
    document.getElementById('funnelStatsGrid').innerHTML = `
        <div class="stat-card">
            <div class="stat-number">${formatCurrency(spend)}</div>
            <div class="stat-label">Ad Spend</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${formatCurrency(rev)}</div>
            <div class="stat-label">Total Revenue</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${roas.toFixed(2)}x</div>
            <div class="stat-label">ROAS</div>
        </div>
        <div class="stat-card" style="border: 1px solid var(--neon-cyan); background: rgba(0, 242, 254, 0.05);">
            <div class="stat-number" style="color: var(--neon-cyan);">${formatCurrency(cpl)}</div>
            <div class="stat-label">Cost per Booking</div>
        </div>
        <div class="stat-card" style="border: 1px solid #ff00f2; background: rgba(255, 0, 242, 0.05);">
            <div class="stat-number" style="color: #ff00f2;">${formatCurrency(costPerHead)}</div>
            <div class="stat-label">Cost per Head</div>
        </div>
        <div class="stat-card" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.05);">
            <div class="stat-number" style="color: #f59e0b;">${bookingToClose}%</div>
            <div class="stat-label">Booking → Close</div>
        </div>
    `;
}

function renderAdsStats(totals) {
    document.getElementById('adsStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatNumber(totals.impressions)}</div><div class="stat-label">Impressions</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(totals.messaging_conversations)}</div><div class="stat-label">Messaging</div></div>
        <div class="stat-card"><div class="stat-number">${formatCurrency(totals.cpm)}</div><div class="stat-label">CPM</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(totals.purchases)}</div><div class="stat-label">Ads Purchases</div></div>
    `;
}

function updateCampaignsTable() {
    const searchTerm = ui.campaignSearchInput.value.toLowerCase();
    let filtered = latestCampaignData.filter(c => c.name.toLowerCase().includes(searchTerm));

    filtered.sort((a, b) => {
        let valA = getNestedValue(a, currentSort.key);
        let valB = getNestedValue(b, currentSort.key);
        if (valA === undefined || valA === null) valA = -9999999999;
        if (valB === undefined || valB === null) valB = -9999999999;
        const numericKeys = ['insights.spend', 'insights.impressions', 'insights.purchases', 'insights.messaging_conversations', 'insights.cpm'];
        if (numericKeys.includes(currentSort.key)) {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }
        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    document.getElementById('campaignsTableBody').innerHTML = filtered.map(c => `
        <tr class="clickable-row" onclick="showAdDetails('${c.id}')">
            <td><strong>${c.name}</strong></td>
            <td><span style="color:${c.status === 'ACTIVE' ? 'var(--color-positive)' : 'var(--text-secondary)'}">${c.status}</span></td>
            <td class="revenue-cell">${formatCurrency(c.insights?.spend)}</td>
            <td>${formatNumber(c.insights?.impressions)}</td>
            <td>${formatNumber(c.insights?.purchases)}</td>
            <td>${formatNumber(c.insights?.messaging_conversations)}</td>
            <td>${formatCurrency(c.insights?.cpm)}</td>
        </tr>
    `).join('');

    document.querySelectorAll('#campaignsTableHeader th').forEach(th => {
        const span = th.querySelector('.sort-icon');
        if(span) span.innerHTML = '⇅';
        if (th.dataset.key === currentSort.key) {
            th.style.color = 'var(--neon-cyan)';
            if(span) span.innerHTML = currentSort.direction === 'asc' ? '▲' : '▼';
        } else {
            th.style.color = '';
        }
    });
}

function renderSalesStats(data) {
    document.getElementById('salesOverviewStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.totalBills)}</div><div class="stat-label">Total Bills</div></div>
        <div class="stat-card"><div class="stat-number">${formatCurrency(data.summary.totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.totalCustomers)}</div><div class="stat-label">Total Customers</div></div>
    `;

    const p1ToUpP1Rate = data.summary.p1Bills > 0 ? ((data.summary.upp1Bills / data.summary.p1Bills) * 100).toFixed(2) : "0.00";
    const p2ToUpP2Rate = data.summary.p2Leads > 0 ? ((data.summary.upp2Bills / data.summary.p2Leads) * 100).toFixed(2) : "0.00";

    document.getElementById('revenueContainer').innerHTML = `
        <div style="margin-bottom: 10px; color: var(--neon-cyan); font-weight: 600;">ยอดขายแยกตามประเภท (THB)</div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-number" style="color:#34d399">${formatCurrency(data.summary.p1Revenue)}</div><div class="stat-label">P1 Revenue</div></div>
            <div class="stat-card"><div class="stat-number" style="color:#ec4899">${formatCurrency(data.summary.upp1Revenue)}</div><div class="stat-label">UP P1 Revenue</div></div>
            <div class="stat-card"><div class="stat-number" style="color:#f59e0b">${formatCurrency(data.summary.upp2Revenue)}</div><div class="stat-label">UP P2 Revenue</div></div>
        </div>
        
        <div style="margin-bottom: 10px; margin-top: 20px; color: var(--neon-cyan); font-weight: 600;">วิเคราะห์อัตราส่วนการอัพเกรด (Success Rate)</div>
        <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.p1Bills)}</div><div class="stat-label">P1 Bills</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.upp1Bills)}</div><div class="stat-label">UP P1 Bills</div></div>
            <div class="stat-card" style="border: 1px solid #ec4899; background: rgba(236, 72, 153, 0.05);"><div class="stat-number" style="color:#ec4899">${p1ToUpP1Rate}%</div><div class="stat-label">P1 ➔ UP P1 Rate</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.p2Leads)}</div><div class="stat-label">P2 Leads</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.upp2Bills)}</div><div class="stat-label">UP P2 Bills</div></div>
            <div class="stat-card" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.05);"><div class="stat-number" style="color:#f59e0b">${p2ToUpP2Rate}%</div><div class="stat-label">P2 ➔ UP P2 Rate</div></div>
        </div>
    `;

    const sortedChannels = Object.entries(data.channels).sort((a,b) => b[1].revenue - a[1].revenue);
    document.getElementById('channelTableBody').innerHTML = sortedChannels.map(([name, val]) => `
        <tr class="clickable-row" onclick="showChannelDetails('${name.replace(/'/g, "\\'")}')">
            <td><strong>${name}</strong></td><td>${formatNumber(val.p1)}</td><td>${formatNumber(val.p2)}</td><td>${formatNumber(val.upP2)}</td><td class="revenue-cell">${formatCurrency(val.revenue)}</td>
        </tr>`).join('');

    document.getElementById('categoryTableBody').innerHTML = data.categories.map((c, i) => `
        <tr class="clickable-row" onclick="showCategoryDetails('${c.name.replace(/'/g, "\\'")}')">
            <td style="text-align:center;"><span class="type-badge">${i+1}</span></td><td><strong>${c.name}</strong></td><td>${formatNumber(c.p1B)}</td><td>${formatNumber(c.up1B)}</td><td>${formatNumber(c.up2B)}</td><td class="revenue-cell">${formatCurrency(c.total)}</td>
        </tr>`).join('');

    updateCategoryChart(data.categories);
}

function updateCategoryChart(cats) {
    const ctx = document.getElementById('revenueBarChart').getContext('2d');
    if (charts.bar) charts.bar.destroy();
    const top15 = cats.slice(0, 15);
    charts.bar = new Chart(ctx, {
        type: 'bar',
        data: { labels: top15.map(c => c.name), datasets: [{ label: 'Revenue (THB)', data: top15.map(c => c.total), backgroundColor: '#00f2fe', borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: '#a0a0b0' }, grid: { color: 'rgba(255,255,255,0.1)' } }, x: { ticks: { color: '#a0a0b0' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

function renderDailySpendChart(dailyData) {
    const ctx = document.getElementById('dailySpendChart').getContext('2d');
    if (charts.line) charts.line.destroy();
    charts.line = new Chart(ctx, {
        type: 'line',
        data: { labels: dailyData.map(d => { const date = new Date(d.date); return `${date.getDate()}/${date.getMonth()+1}`; }), datasets: [{ label: 'Ad Spend (THB)', data: dailyData.map(d => d.spend), borderColor: '#ff00f2', backgroundColor: 'rgba(255, 0, 242, 0.1)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#a0a0b0' }, grid: { color: 'rgba(255,255,255,0.1)' } }, x: { ticks: { color: '#a0a0b0' } } }, plugins: { legend: { display: false } } }
    });
}

function showCategoryDetails(categoryName) {
    const C = CONFIG.COLUMN_NAMES;
    const filtered = latestSalesAnalysis.filteredRows.filter(r => {
        const rowCats = String(r[C.CATEGORIES] || '').split(',').map(s => s.trim());
        return rowCats.includes(categoryName);
    });
    const groups = { p1: filtered.filter(r => toNumber(r[C.P1]) > 0 && toNumber(r[C.UP_P1]) === 0), up1: filtered.filter(r => toNumber(r[C.UP_P1]) > 0), up2: filtered.filter(r => toNumber(r[C.UP_P2]) > 0) };
    ui.modalTitle.textContent = `หมวดหมู่: ${categoryName}`;
    let html = '';
    if (groups.p1.length > 0) html += `<div class="type-section"><div class="type-title">📦 P1 Bills <span class="type-badge">${groups.p1.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Channel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.p1.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.CHANNEL] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td></tr>`).join('')}</tbody></table></div></div>`;
    if (groups.up1.length > 0) html += `<div class="type-section"><div class="type-title">🚀 UP P1 Bills <span class="type-badge">${groups.up1.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Upgrade Item</th><th>Original P1</th><th>Original P1 Amt</th><th>Upgrade Amt</th></tr></thead><tbody>${groups.up1.map(r => { const custName = String(r[C.CUSTOMER] || '').trim(); const custPhone = String(r[C.PHONE] || '').trim(); const history = allSalesDataCache.find(h => { const hName = String(h[C.CUSTOMER] || '').trim(); const hPhone = String(h[C.PHONE] || '').trim(); return ((custPhone && hPhone === custPhone) || (hName === custName)) && toNumber(h[C.P1]) > 0; }); const p1Val = history ? toNumber(history[C.P1]) : 0; const p1Interest = history ? history[C.INTEREST] : 'Not Found'; return `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td><span class="context-label">Old Interest</span>${p1Interest}</td><td class="context-cell">${formatCurrency(p1Val)}</td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P1]))}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    if (groups.up2.length > 0) html += `<div class="type-section"><div class="type-title">💎 UP P2 Bills <span class="type-badge">${groups.up2.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Upgrade Interest</th><th>Original P2</th><th>Revenue</th></tr></thead><tbody>${groups.up2.map(r => { const custName = String(r[C.CUSTOMER] || '').trim(); const custPhone = String(r[C.PHONE] || '').trim(); const history = allSalesDataCache.find(h => { const hName = String(h[C.CUSTOMER] || '').trim(); const hPhone = String(h[C.PHONE] || '').trim(); return ((custPhone && hPhone === custPhone) || (hName === custName)) && h[C.P2] && String(h[C.P2]).trim() !== ''; }); const p2Interest = history ? history[C.INTEREST] : 'Not Found'; const p2Date = history ? formatDate(parseGvizDate(history[C.DATE])) : ''; return `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td><span class="context-label">Lead Date: ${p2Date}</span>${p2Interest}</td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    if (html === '') html = '<p style="text-align:center; padding: 20px;">No transaction details found.</p>';
    ui.modalBody.innerHTML = html; ui.modal.classList.add('show');
}

function showChannelDetails(channelName) {
    const C = CONFIG.COLUMN_NAMES;
    const filtered = latestSalesAnalysis.filteredRows.filter(r => (r[C.CHANNEL] || 'ไม่ระบุ') === channelName);
    const groups = { p1: filtered.filter(r => toNumber(r[C.P1]) > 0 && toNumber(r[C.UP_P1]) === 0), p2: filtered.filter(r => r[C.P2] && String(r[C.P2]).trim() !== ''), upP2: filtered.filter(r => toNumber(r[C.UP_P2]) > 0) };
    ui.modalTitle.textContent = `ช่องทาง: ${channelName}`;
    let html = '';
    if (groups.p1.length > 0) html += `<div class="type-section"><div class="type-title">📦 P1 Bills <span class="type-badge">${groups.p1.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.p1.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td></tr>`).join('')}</tbody></table></div></div>`;
    if (groups.p2.length > 0) html += `<div class="type-section"><div class="type-title">📋 P2 Leads <span class="type-badge">${groups.p2.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th></tr></thead><tbody>${groups.p2.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.P2] || '-'}</small></td></tr>`).join('')}</tbody></table></div></div>`;
    if (groups.upP2.length > 0) html += `<div class="type-section"><div class="type-title">💎 UP P2 Bills <span class="type-badge">${groups.upP2.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.upP2.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td></tr>`).join('')}</tbody></table></div></div>`;
    if (html === '') html = '<p style="text-align:center; padding: 20px;">No transaction details found.</p>';
    ui.modalBody.innerHTML = html; ui.modal.classList.add('show');
}

function showAdDetails(campaignId) {
    const campaign = latestCampaignData.find(c => c.id === campaignId);
    if (!campaign) return;
    ui.modalTitle.textContent = `Ads in: ${campaign.name}`;
    const ads = campaign.ads || [];
    if (ads.length === 0) { ui.modalBody.innerHTML = '<p style="text-align:center;">No ads found.</p>'; } else { ui.modalBody.innerHTML = ads.sort((a,b) => b.insights.spend - a.insights.spend).map(ad => `<div class="ad-card"><img src="${ad.thumbnail_url}" onerror="this.src='https://placehold.co/80x80?text=No+Img'"><div style="flex:1;"><h4>${ad.name}</h4><div style="font-size:0.9em; color:#a0a0b0; display:grid; grid-template-columns: 1fr 1fr; margin-top:5px;"><div>Spend: <span style="color:white;">${formatCurrency(ad.insights.spend)}</span></div><div>Purchases: <span style="color:white;">${formatNumber(ad.insights.purchases)}</span></div><div>Messaging: <span style="color:white;">${formatNumber(ad.insights.messaging_conversations)}</span></div><div>Impressions: <span style="color:white;">${formatNumber(ad.insights.impressions)}</span></div><div>CPM: <span style="color:white;">${formatCurrency(ad.insights.cpm)}</span></div></div></div></div>`).join(''); }
    ui.modal.classList.add('show');
}

// ================================================================
// 8. GEMINI PROMPT GENERATION (UPDATED WITH TOTAL REVENUE & ALL TOP 5)
// ================================================================

function getCompareData() {
    const start = new Date(ui.startDate.value);
    const end = new Date(ui.endDate.value);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - diffDays + 1);
    const prevData = processSalesData(allSalesDataCache, prevStart.toISOString().split('T')[0], prevEnd.toISOString().split('T')[0]);
    return { period: `${formatDate(prevStart)} - ${formatDate(prevEnd)}`, data: prevData };
}

function generateGeminiPrompt() {
    const s = latestSalesAnalysis.summary;
    const ads = latestAdsTotals || {};
    const f = (n) => formatCurrency(n);
    const num = (n) => formatNumber(n);
    const branchName = document.querySelector('h1').innerText.split(':')[0].trim();

    const spend = ads.spend || 0;
    const rev = s.totalRevenue || 0;
    const messaging = ads.messaging_conversations || 0;
    const roas = spend > 0 ? (rev / spend).toFixed(2) + 'x' : '0x';
    const cpb = s.totalBills > 0 ? (spend / s.totalBills) : 0;
    const cph = s.totalCustomers > 0 ? (spend / s.totalCustomers) : 0;
    const bookingClose = s.totalBills > 0 ? ((s.totalCustomers / s.totalBills) * 100).toFixed(2) : 0;
    
    const p1ToUpP1Rate = s.p1Bills > 0 ? ((s.upp1Bills / s.p1Bills) * 100).toFixed(2) : "0.00";
    const p2ToUpP2Rate = s.p2Leads > 0 ? ((s.upp2Bills / s.p2Leads) * 100).toFixed(2) : "0.00";

    const compare = getCompareData();
    const ps = compare.data.summary;

    const calcDiff = (curr, prev) => {
        const diff = curr - prev;
        const pct = prev > 0 ? ((diff / prev) * 100).toFixed(2) : "N/A";
        const sign = diff >= 0 ? "+" : "";
        return `${sign}${num(diff)} (${sign}${pct}%)`;
    };

    const calcDiffCurr = (curr, prev) => {
        const diff = curr - prev;
        const pct = prev > 0 ? ((diff / prev) * 100).toFixed(2) : "N/A";
        const sign = diff >= 0 ? "+" : "";
        return `${sign}${f(diff)} (${sign}${pct}%)`;
    };

    const cats = latestSalesAnalysis.categories;
    const getTop5 = (sortKey) => [...cats].sort((a,b) => b[sortKey] - a[sortKey]).slice(0, 5);

    let p = `--- [บริบทและการวิเคราะห์เปรียบเทียบ] ---\n`;
    p += `* สาขา: ${branchName}\n`;
    p += `* ช่วงเวลาปัจจุบัน: ${formatDate(new Date(ui.startDate.value))} ถึง ${formatDate(new Date(ui.endDate.value))}\n`;
    p += `* ช่วงเวลาที่นำมาเทียบ: ${compare.period}\n\n`;

    p += `--- [ข้อมูล Ads & Funnel (ปัจจุบัน)] ---\n`;
    p += `Ad Spend: ${f(spend)}\n`;
    p += `ROAS: ${roas}\n`;
    p += `Messaging: ${num(messaging)}\n`;
    p += `Cost Per Booking: ${f(cpb)}\n`;
    p += `Cost Per Head: ${f(cph)}\n`;
    p += `Booking → Close: ${bookingClose}%\n\n`;

    p += `--- [เปรียบเทียบตัวเลขที่เปลี่ยนแปลง] ---\n`;
    p += `1. ยอดขายรวม: ${calcDiffCurr(s.totalRevenue, ps.totalRevenue)}\n`;
    p += `2. จำนวนบิล: ${calcDiff(s.totalBills, ps.totalBills)}\n`;
    p += `3. จำนวนลูกค้า: ${calcDiff(s.totalCustomers, ps.totalCustomers)}\n\n`;

    p += `--- [ข้อมูลช่วงเวลาปัจจุบัน (รายละเอียด)] ---\n`;
    p += `* Total Revenue (รายได้รวม): ${f(s.totalRevenue)}\n`; // <--- เพิ่มตามคำขอ
    p += `* ยอดขาย P1: ${f(s.p1Revenue)} (${num(s.p1Bills)} บิล)\n`;
    p += `* ยอดอัพ P1: ${f(s.upp1Revenue)} (${num(s.upp1Bills)} บิล)\n`;
    p += `* ยอดอัพ P2: ${f(s.upp2Revenue)} (${num(s.upp2Bills)} บิล)\n`;
    p += `* P1 ➔ UP P1 Rate: ${p1ToUpP1Rate}%\n`;
    p += `* P2 ➔ UP P2 Rate: ${p2ToUpP2Rate}%\n`;
    p += `* P2 Leads: ${num(s.p2Leads)} Leads\n\n`;

    p += `* 5 อันดับหมวดหมู่ขายดีทั้งหมด (รายได้รวมสูงสุด):\n` + getTop5('total').map(c => `  - ${c.name}: ${f(c.total)}`).join('\n') + `\n\n`;
    p += `* 5 อันดับหมวดหมู่ P1 ขายดี (ลูกค้าใหม่/ซื้อทันที):\n` + getTop5('p1B').map(c => `  - ${c.name}: ${num(c.p1B)} บิล`).join('\n') + `\n\n`;
    p += `* 5 อันดับหมวดหมู่ UP P1 ขายดี (อัพเกรดจาก P1):\n` + getTop5('up1B').map(c => `  - ${c.name}: ${num(c.up1B)} บิล`).join('\n') + `\n\n`;
    p += `* 5 อันดับหมวดหมู่ UP P2 ขายดี (ปิดการขายจาก Lead):\n` + getTop5('up2B').map(c => `  - ${c.name}: ${num(c.up2B)} บิล`).join('\n') + `\n\n`;

    p += `--- [วิเคราะห์ตามช่องทาง] ---\n`;
    Object.entries(latestSalesAnalysis.channels).sort((a,b) => b[1].revenue - a[1].revenue).forEach(([name, val]) => {
        p += `* ${name}: บิล P1 ${val.p1}, UP P2 ${val.upP2}, ยอดขายรวม ${f(val.revenue)}\n`;
    });

    p += `\nกรุณาวิเคราะห์แนวโน้ม และแนะนำแนวทางแก้ไขกรณีตัวเลขลดลง โดยเน้นเปรียบเทียบหมวดหมู่สินค้าครับ`;
    return p;
}

// ================================================================
// 9. MAIN EXECUTION
// ================================================================
async function main() {
    ui.loading.classList.add('show'); ui.errorMessage.classList.remove('show');
    try {
        await fetchSalesData();
        const salesRes = processSalesData(allSalesDataCache, ui.startDate.value, ui.endDate.value);
        latestSalesAnalysis = salesRes; renderSalesStats(salesRes);
        const adsRes = await fetchAdsData(ui.startDate.value, ui.endDate.value);
        if (adsRes.success) {
            latestCampaignData = adsRes.data.campaigns; latestAdsTotals = adsRes.totals;
            renderFunnel(adsRes.totals); renderAdsStats(adsRes.totals); updateCampaignsTable(); renderDailySpendChart(adsRes.data.dailySpend);
        } else {
            latestAdsTotals = {}; document.getElementById('adsStatsGrid').innerHTML = '<p style="color:var(--text-secondary);">Unable to load Ads data.</p>';
        }
    } catch (err) {
        console.error(err); ui.errorMessage.textContent = "Error: " + err.message; ui.errorMessage.classList.add('show');
    } finally { ui.loading.classList.remove('show'); }
}

// ================================================================
// 10. EVENTS
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date(); const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    ui.endDate.value = today.toISOString().split('T')[0]; ui.startDate.value = startMonth.toISOString().split('T')[0];
    main();
    ui.refreshBtn.addEventListener('click', main); ui.modalCloseBtn.addEventListener('click', () => ui.modal.classList.remove('show'));
    ui.geminiBtn.addEventListener('click', () => {
        const prompt = generateGeminiPrompt();
        ui.modalTitle.textContent = '🤖 Prompt วิเคราะห์เปรียบเทียบสำหรับ Gemini';
        ui.modalBody.innerHTML = `<textarea readonly onclick="this.select()" style="width:100%; min-height:400px; padding:10px; background:#1a1a2e; color:#00f2fe; border:1px solid #333; font-family:monospace;">${prompt}</textarea><div style="text-align:center; margin-top:10px;"><p style="font-size:0.9em; color:#a0a0b0;">Copy ข้อความเพื่อนำไปวางใน Gemini</p></div>`;
        ui.modal.classList.add('show');
    });
    if (ui.campaignsTableHeader) {
        ui.campaignsTableHeader.addEventListener('click', (e) => {
            const th = e.target.closest('th'); if (!th || !th.dataset.key) return; const key = th.dataset.key;
            if (currentSort.key === key) { currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc'; } else { currentSort.key = key; currentSort.direction = 'desc'; }
            updateCampaignsTable();
        });
    }
    document.getElementById('campaignSearchInput').addEventListener('input', () => { updateCampaignsTable(); });
});
