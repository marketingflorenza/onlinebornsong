// ================================================================
// 1. CONFIGURATION
// ================================================================
const CONFIG = {
    API_BASE_URL: 'https://backend-api-ram.vercel.app/api',
    SHEET_ID: '1LFoETe4YdPIxxj27bXxNRip9dKJ-sL7bbDv820ExEtk',
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
        const response = await fetch(`${CONFIG.API_BASE_URL}/databillRam?since=${since}&until=${until}`);
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
    const roas = spend > 0 ? rev / spend : 0;
    
    document.getElementById('funnelStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatCurrency(spend)}</div><div class="stat-label">Ad Spend</div></div>
        <div class="stat-card"><div class="stat-number">${formatCurrency(rev)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-number">${roas.toFixed(2)}x</div><div class="stat-label">ROAS</div></div>
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
    
    let filtered = latestCampaignData.filter(c => 
        c.name.toLowerCase().includes(searchTerm)
    );

    filtered.sort((a, b) => {
        let valA = getNestedValue(a, currentSort.key);
        let valB = getNestedValue(b, currentSort.key);

        if (valA === undefined || valA === null) valA = -9999999999;
        if (valB === undefined || valB === null) valB = -9999999999;

        const numericKeys = ['insights.spend', 'insights.impressions', 'insights.purchases', 'insights.messaging_conversations', 'insights.cpm'];
        const isNumeric = numericKeys.includes(currentSort.key);

        if (isNumeric) {
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

    document.getElementById('revenueContainer').innerHTML = `
        <div style="margin-bottom: 10px; color: var(--neon-cyan); font-weight: 600;">ยอดขายแยกตามประเภท (THB)</div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-number" style="color:#34d399">${formatCurrency(data.summary.p1Revenue)}</div><div class="stat-label">P1 Revenue</div></div>
            <div class="stat-card"><div class="stat-number" style="color:#ec4899">${formatCurrency(data.summary.upp1Revenue)}</div><div class="stat-label">UP P1 Revenue</div></div>
            <div class="stat-card"><div class="stat-number" style="color:#f59e0b">${formatCurrency(data.summary.upp2Revenue)}</div><div class="stat-label">UP P2 Revenue</div></div>
        </div>
        
        <div style="margin-bottom: 10px; margin-top: 20px; color: var(--neon-cyan); font-weight: 600;">จำนวนบิลแยกตามประเภท (Bills Count)</div>
        <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.p1Bills)}</div><div class="stat-label">P1 Bills</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.upp1Bills)}</div><div class="stat-label">UP P1 Bills</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.upp2Bills)}</div><div class="stat-label">UP P2 Bills</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(data.summary.p2Leads)}</div><div class="stat-label">P2 Leads</div></div>
        </div>
    `;

    const sortedChannels = Object.entries(data.channels).sort((a,b) => b[1].revenue - a[1].revenue);
    document.getElementById('channelTableBody').innerHTML = sortedChannels.map(([name, val]) => `
        <tr>
            <td><strong>${name}</strong></td>
            <td>${formatNumber(val.p1)}</td>
            <td>${formatNumber(val.p2)}</td>
            <td>${formatNumber(val.upP2)}</td>
            <td class="revenue-cell">${formatCurrency(val.revenue)}</td>
        </tr>
    `).join('');

    document.getElementById('categoryTableBody').innerHTML = data.categories.map((c, i) => `
        <tr class="clickable-row" onclick="showCategoryDetails('${c.name.replace(/'/g, "\\'")}')">
            <td style="text-align:center;"><span class="type-badge">${i+1}</span></td>
            <td><strong>${c.name}</strong></td>
            <td>${formatNumber(c.p1B)}</td>
            <td>${formatNumber(c.up1B)}</td>
            <td>${formatNumber(c.up2B)}</td>
            <td class="revenue-cell">${formatCurrency(c.total)}</td>
        </tr>
    `).join('');

    updateCategoryChart(data.categories);
}

function updateCategoryChart(cats) {
    const ctx = document.getElementById('revenueBarChart').getContext('2d');
    if (charts.bar) charts.bar.destroy();
    const top15 = cats.slice(0, 15);
    charts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top15.map(c => c.name),
            datasets: [{ 
                label: 'Revenue (THB)', 
                data: top15.map(c => c.total), 
                backgroundColor: '#00f2fe', 
                borderRadius: 5 
            }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { 
                y: { ticks: { color: '#a0a0b0' }, grid: { color: 'rgba(255,255,255,0.1)' } }, 
                x: { ticks: { color: '#a0a0b0' }, grid: { display: false } } 
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderDailySpendChart(dailyData) {
    const ctx = document.getElementById('dailySpendChart').getContext('2d');
    if (charts.line) charts.line.destroy();
    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dailyData.map(d => {
                const date = new Date(d.date);
                return `${date.getDate()}/${date.getMonth()+1}`;
            }),
            datasets: [{
                label: 'Ad Spend (THB)',
                data: dailyData.map(d => d.spend),
                borderColor: '#ff00f2',
                backgroundColor: 'rgba(255, 0, 242, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0b0' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#a0a0b0' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function showCategoryDetails(categoryName) {
    const C = CONFIG.COLUMN_NAMES;
    const filtered = latestSalesAnalysis.filteredRows.filter(r => {
        const rowCats = String(r[C.CATEGORIES] || '').split(',').map(s => s.trim());
        return rowCats.includes(categoryName);
    });

    const groups = {
        p1: filtered.filter(r => toNumber(r[C.P1]) > 0 && toNumber(r[C.UP_P1]) === 0),
        up1: filtered.filter(r => toNumber(r[C.UP_P1]) > 0),
        up2: filtered.filter(r => toNumber(r[C.UP_P2]) > 0)
    };

    ui.modalTitle.textContent = `หมวดหมู่: ${categoryName}`;
    let html = '';

    if (groups.p1.length > 0) {
        html += `<div class="type-section"><div class="type-title">📦 P1 Bills <span class="type-badge">${groups.p1.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Channel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.p1.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.CHANNEL] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    if (groups.up1.length > 0) {
        html += `<div class="type-section"><div class="type-title">🚀 UP P1 Bills (Upgrade) <span class="type-badge">${groups.up1.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Upgrade Item</th><th>Original P1 Item</th><th>Original P1 Amt</th><th>Upgrade Amt</th></tr></thead><tbody>${groups.up1.map(r => {
            const custName = String(r[C.CUSTOMER] || '').trim();
            const custPhone = String(r[C.PHONE] || '').trim();
            const history = allSalesDataCache.find(h => {
                const hName = String(h[C.CUSTOMER] || '').trim();
                const hPhone = String(h[C.PHONE] || '').trim();
                const isSameUser = (custPhone && hPhone === custPhone) || (hName === custName);
                return isSameUser && toNumber(h[C.P1]) > 0;
            });
            const p1Val = history ? toNumber(history[C.P1]) : 0;
            const p1Interest = history ? history[C.INTEREST] : 'Not Found';
            return `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td><span class="context-label">Old Interest</span>${p1Interest}</td><td class="context-cell">${formatCurrency(p1Val)}</td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P1]))}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    }

    if (groups.up2.length > 0) {
        html += `<div class="type-section"><div class="type-title">💎 UP P2 Bills <span class="type-badge">${groups.up2.length} items</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Upgrade Interest</th><th>Original P2 Interest (Col F)</th><th>Revenue</th></tr></thead><tbody>${groups.up2.map(r => {
            const custName = String(r[C.CUSTOMER] || '').trim();
            const custPhone = String(r[C.PHONE] || '').trim();
            const history = allSalesDataCache.find(h => {
                const hName = String(h[C.CUSTOMER] || '').trim();
                const hPhone = String(h[C.PHONE] || '').trim();
                const isSameUser = (custPhone && hPhone === custPhone) || (hName === custName);
                const isP2Lead = h[C.P2] && String(h[C.P2]).trim() !== '';
                return isSameUser && isP2Lead;
            });
            const p2Interest = history ? history[C.INTEREST] : 'Not Found';
            const p2Date = history ? formatDate(parseGvizDate(history[C.DATE])) : '';
            return `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td><span class="context-label">Lead Date: ${p2Date}</span>${p2Interest}</td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    }

    if (html === '') html = '<p style="text-align:center; padding: 20px;">No transaction details found.</p>';
    ui.modalBody.innerHTML = html;
    ui.modal.classList.add('show');
}

function showAdDetails(campaignId) {
    const campaign = latestCampaignData.find(c => c.id === campaignId);
    if (!campaign) return;
    ui.modalTitle.textContent = `Ads in: ${campaign.name}`;
    const ads = campaign.ads || [];
    
    if (ads.length === 0) {
        ui.modalBody.innerHTML = '<p style="text-align:center;">No ads found.</p>';
    } else {
        ui.modalBody.innerHTML = ads.sort((a,b) => b.insights.spend - a.insights.spend).map(ad => `
            <div class="ad-card"><img src="${ad.thumbnail_url}" onerror="this.src='https://placehold.co/80x80?text=No+Img'"><div style="flex:1;"><h4>${ad.name}</h4><div style="font-size:0.9em; color:#a0a0b0; display:grid; grid-template-columns: 1fr 1fr; margin-top:5px;"><div>Spend: <span style="color:white;">${formatCurrency(ad.insights.spend)}</span></div><div>Purchases: <span style="color:white;">${formatNumber(ad.insights.purchases)}</span></div><div>Impressions: <span style="color:white;">${formatNumber(ad.insights.impressions)}</span></div><div>CPM: <span style="color:white;">${formatCurrency(ad.insights.cpm)}</span></div></div></div></div>
        `).join('');
    }
    ui.modal.classList.add('show');
}

function generateGeminiPrompt() {
    const s = latestSalesAnalysis.summary;
    const ads = latestAdsTotals || {};
    const f = (n) => formatCurrency(n);
    const num = (n) => formatNumber(n);
    const branchName = document.querySelector('h1').innerText.split(':')[0].trim();

    // Calculate ROAS
    const spend = ads.spend || 0;
    const rev = s.totalRevenue || 0;
    const roas = spend > 0 ? (rev / spend).toFixed(2) + 'x' : '0x';

    // Top 5 Helpers
    const cats = latestSalesAnalysis.categories;
    const getTop5 = (sortKey) => [...cats].sort((a,b) => b[sortKey] - a[sortKey]).slice(0, 5);

    let p = `--- [บริบทของการวิเคราะห์] ---\n`;
    p += `* สาขา: ${branchName}\n`;
    p += `* ช่วงเวลา: ${formatDate(new Date(ui.startDate.value))} ถึง ${formatDate(new Date(ui.endDate.value))}\n\n`;

    p += `--- [ข้อมูล Ads] ---\n`;
    p += `Ad Spend: ${f(spend)}\n`;
    p += `ROAS: ${roas}\n`;
    p += `Impressions: ${num(ads.impressions)}\n`;
    p += `Messaging: ${num(ads.messaging_conversations)}\n`;
    p += `CPM: ${f(ads.cpm)}\n`;
    p += `Ads Purchases: ${num(ads.purchases)}\n\n`;

    p += `--- [ข้อมูลช่วงเวลาปัจจุบัน] ---\n`;
    p += `* ยอดขายรวม: ${f(s.totalRevenue)}\n`;
    p += `* จำนวนบิลทั้งหมด: ${num(s.totalBills)} บิล\n`;
    p += `* ยอดขาย P1: ${f(s.p1Revenue)}\n`;
    p += `* ยอดขาย UP P1: ${f(s.upp1Revenue)}\n`;
    p += `* ยอดขาย UP P2: ${f(s.upp2Revenue)}\n\n`;

    p += `* 5 หมวดหมู่ที่ทำรายได้สูงสุด:\n` + getTop5('total').map(c => `  - ${c.name}: ${f(c.total)}`).join('\n') + `\n`;
    p += `* 5 หมวดหมู่ P1 ที่ได้รายได้สูงสุด:\n` + getTop5('p1Val').map(c => `  - ${c.name}: ${f(c.p1Val)}`).join('\n') + `\n`;
    p += `* 5 หมวดหมู่ UP P1 ที่ได้รายได้สูงสุด:\n` + getTop5('up1Val').map(c => `  - ${c.name}: ${f(c.up1Val)}`).join('\n') + `\n`;
    p += `* 5 หมวดหมู่ UP P2 ที่ได้รายได้สูงสุด:\n` + getTop5('up2Val').map(c => `  - ${c.name}: ${f(c.up2Val)}`).join('\n') + `\n\n`;

    p += `--- [สรุปประสิทธิภาพตามช่องทาง] ---\n`;
    p += `จำนวนบิลแต่ละประเภทยอด\n`;
    Object.entries(latestSalesAnalysis.channels).sort((a,b) => b[1].revenue - a[1].revenue).forEach(([name, val]) => {
        p += `* ${name}: บิล P1 ${val.p1}, UP P2 ${val.upP2}, ยอดขายรวม ${f(val.revenue)}\n`;
    });

    return p;
}

// ================================================================
// 9. MAIN EXECUTION
// ================================================================
async function main() {
    ui.loading.classList.add('show');
    ui.errorMessage.classList.remove('show');
    
    try {
        await fetchSalesData();
        const salesRes = processSalesData(allSalesDataCache, ui.startDate.value, ui.endDate.value);
        latestSalesAnalysis = salesRes;
        renderSalesStats(salesRes);

        const adsRes = await fetchAdsData(ui.startDate.value, ui.endDate.value);
        if (adsRes.success) {
            latestCampaignData = adsRes.data.campaigns;
            latestAdsTotals = adsRes.totals; 
            renderFunnel(adsRes.totals);
            renderAdsStats(adsRes.totals);
            updateCampaignsTable();
            renderDailySpendChart(adsRes.data.dailySpend);
        } else {
            latestAdsTotals = {}; 
            document.getElementById('adsStatsGrid').innerHTML = '<p style="color:var(--text-secondary);">Unable to load Ads data.</p>';
        }

    } catch (err) {
        console.error(err);
        ui.errorMessage.textContent = "Error: " + err.message;
        ui.errorMessage.classList.add('show');
    } finally {
        ui.loading.classList.remove('show');
    }
}

// ================================================================
// 10. EVENTS
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    ui.endDate.value = today.toISOString().split('T')[0];
    ui.startDate.value = startMonth.toISOString().split('T')[0];

    main();

    ui.refreshBtn.addEventListener('click', main);
    ui.modalCloseBtn.addEventListener('click', () => ui.modal.classList.remove('show'));
    
    ui.geminiBtn.addEventListener('click', () => {
        const prompt = generateGeminiPrompt();
        ui.modalTitle.textContent = '🤖 Prompt สำหรับ Gemini';
        ui.modalBody.innerHTML = `
            <textarea readonly onclick="this.select()">${prompt}</textarea>
            <div style="text-align:center; margin-top:10px;">
                <p style="font-size:0.9em; color:#a0a0b0;">Copy ข้อความด้านบนแล้วนำไปวางใน Google Gemini</p>
            </div>`;
        ui.modal.classList.add('show');
    });

    if (ui.campaignsTableHeader) {
        ui.campaignsTableHeader.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.key) return;
            const key = th.dataset.key;
            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc';
            } else {
                currentSort.key = key;
                currentSort.direction = 'desc';
            }
            updateCampaignsTable();
        });
    }

    document.getElementById('campaignSearchInput').addEventListener('input', () => {
        updateCampaignsTable();
    });
});
