// ================================================================
// 1. CONFIGURATION
// ================================================================
const CONFIG = {
    API_BASE_URL: 'https://my-facebook-backend-bsk.vercel.app/api/bornsong',
    SHEET_ID: '1dlgM7YaQmJQTuiuNdAMb6tjKHllPgIs8MjfgGZnp8jU',
    SHEET_NAME_SUMMARY: 'SUM',
    GOOGLE_SHEET_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbw3sB51doTE-BbjlkJaHlWGIg_Bm8VrHvLOfFU3xSAN4a29qRajyN2GlqcHcUXBAyWMag/exec',
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
    adsAnalystBtn: document.getElementById('adsAnalystBtn'),
    branchSummaryBtn: document.getElementById('branchSummaryBtn'),
    loading: document.getElementById('loading'),
    errorMessage: document.getElementById('errorMessage'),
    modal: document.getElementById('detailsModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    campaignsTableHeader: document.getElementById('campaignsTableHeader'),
    exportSheetBtn: document.getElementById('exportSheetBtn')
};

let charts = {};
let allSalesDataCache = [];
let latestSalesAnalysis = {};
let latestCampaignData = [];
let latestAdsTotals = {};
let latestDailySpendData = [];
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
const getNestedValue = (obj, path) => {
    return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
};

// ================================================================
// 3b. CUSTOMER HISTORY HELPER
// ================================================================
function hasPaidHistory(custName, custPhone, historyRows) {
    const C = CONFIG.COLUMN_NAMES;
    return historyRows.some(h => {
        const hName  = String(h[C.CUSTOMER] || '').trim();
        const hPhone = String(h[C.PHONE]    || '').trim();
        const hasPaidRevenue =
            toNumber(h[C.P1])    > 0 ||
            toNumber(h[C.UP_P1]) > 0 ||
            toNumber(h[C.UP_P2]) > 0;
        if (!hasPaidRevenue) return false;
        return (custName  !== '' && hName  === custName)  ||
               (custPhone !== '' && hPhone === custPhone);
    });
}
// ================================================================
// เพิ่มฟั่งชั่นให้เห็น
// ================================================================
function fillMissingDates(dailySpendArray, startDateStr, endDateStr) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const dataMap = {};

    // แปลงข้อมูลที่มีอยู่ให้เป็น Map เพื่อง่ายต่อการค้นหา
    (dailySpendArray || []).forEach(d => {
        // จัดฟอร์แมตวันที่ให้ตรงกัน
        const dateObj = new Date(d.date);
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        dataMap[`${y}-${m}-${day}`] = d;
    });

    const result = [];
    let current = new Date(start);

    // วนลูปตั้งแต่วันเริ่มต้นยันวันสิ้นสุด
    while (current <= end) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        const dateKey = `${y}-${m}-${day}`;

        if (dataMap[dateKey]) {
            result.push(dataMap[dateKey]); // ใช้วันที่มีข้อมูล
        } else {
            result.push({ date: dateKey, spend: 0 }); // ถ้าไม่มี ยัด spend: 0
        }
        
        current.setDate(current.getDate() + 1); // ขยับไปวันถัดไป
    }

    return result;
}

// ================================================================
// 4. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}?since=${since}&until=${until}`);
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
    const endD   = new Date(endDate   + 'T23:59:59');

    const historyData = rows.filter(r => {
        const d = parseGvizDate(r[C.DATE]);
        return d && d < startD;
    });

    const filteredRows = rows.filter(r => {
        const d = parseGvizDate(r[C.DATE]);
        return d && d >= startD && d <= endD;
    });

    let summary = {
        totalBills: 0, totalRevenue: 0, totalCustomers: 0,
        p1Revenue: 0, upp1Revenue: 0, upp2Revenue: 0,
        p1Bills: 0, upp1Bills: 0, upp2Bills: 0, p2Leads: 0,
        newCustomersCount: 0, repeatCustomersCount: 0
    };

    let channels  = {};
    let categories = {};

    const processedNewCust    = new Set();
    const processedRepeatCust = new Set();

    filteredRows.forEach(row => {
        const p1    = toNumber(row[C.P1]);
        const up1   = toNumber(row[C.UP_P1]);
        const up2   = toNumber(row[C.UP_P2]);
        const p2Str = String(row[C.P2] || '').trim();
        const rev   = p1 + up1 + up2;

        const custName  = String(row[C.CUSTOMER] || '').trim();
        const custPhone = String(row[C.PHONE]    || '').trim();
        const custKey   = `${custName}|${custPhone}`;

        if (p1  > 0) summary.p1Bills++;
        if (up1 > 0) summary.upp1Bills++;
        if (up2 > 0) summary.upp2Bills++;
        if (p2Str !== '') summary.p2Leads++;

        if (rev > 0 || p2Str !== '') {
            summary.totalRevenue  += rev;
            summary.p1Revenue     += p1;
            summary.upp1Revenue   += up1;
            summary.upp2Revenue   += up2;

            if (p1 > 0 || up2 > 0) summary.totalCustomers++;

            if (p1 > 0 || up2 > 0) {
                const isOldCustomer = hasPaidHistory(custName, custPhone, historyData);
                if (!isOldCustomer) {
                    if (!processedNewCust.has(custKey)) {
                        summary.newCustomersCount++;
                        processedNewCust.add(custKey);
                    }
                } else {
                    if (!processedRepeatCust.has(custKey)) {
                        summary.repeatCustomersCount++;
                        processedRepeatCust.add(custKey);
                    }
                }
            }

            const ch = row[C.CHANNEL] || 'ไม่ระบุ';
            if (!channels[ch]) channels[ch] = { p1: 0, p2: 0, upP2: 0, newCust: 0, revenue: 0, up2Revenue: 0 };
            if (p1 > 0 && up1 === 0) channels[ch].p1++;
            if (p2Str !== '')        channels[ch].p2++;
            if (up2 > 0)             channels[ch].upP2++;
            channels[ch].revenue    += rev;
            channels[ch].up2Revenue += up2;

            let isOldCustomerForCat = false;
            if (p1 > 0 || up2 > 0) {
                isOldCustomerForCat = hasPaidHistory(custName, custPhone, historyData);
            }

            const cats = String(row[C.CATEGORIES] || '').split(',').map(s => s.trim()).filter(s => s && s !== '999');
            cats.forEach(cat => {
                // อัปเดตโครงสร้างเริ่มต้น ให้รองรับการเก็บ Set ลูกค้า (กันนับซ้ำ) และตัวนับลูกค้า
                if (!categories[cat]) categories[cat] = { 
                    name: cat, total: 0, p1B: 0, up1B: 0, up2B: 0, p1Val: 0, up1Val: 0, up2Val: 0,
                    custSet: new Set(), newCust: 0, oldCust: 0
                };
                
                const count = cats.length || 1;
                categories[cat].total  += rev / count;
                categories[cat].p1Val  += p1  / count;
                categories[cat].up1Val += up1 / count;
                categories[cat].up2Val += up2 / count;
                
                if (p1  > 0) categories[cat].p1B++;
                if (up1 > 0) categories[cat].up1B++;
                if (up2 > 0) categories[cat].up2B++;

                // เพิ่มลอจิกนับจำนวนลูกค้าแยกเก่า-ใหม่ แบบไม่ซ้ำคน (Unique)
                if (p1 > 0 || up2 > 0) {
                    if (!categories[cat].custSet.has(custKey)) {
                        categories[cat].custSet.add(custKey); // เก็บ key ลูกค้าไว้ เพื่อครั้งหน้าจะได้ไม่นับซ้ำ
                        if (isOldCustomerForCat) {
                            categories[cat].oldCust++;
                        } else {
                            categories[cat].newCust++;
                        }
                    }
                }
            });
        }
    });

    summary.totalBills = summary.p1Bills + summary.p2Leads;

    // คืนค่า categories ออกไปเหมือนเดิม (คุณสามารถเอา newCust, oldCust ไปรวมกันเพื่อหา Total Customers ได้เลยตอน Render)
    return { summary, channels, categories: Object.values(categories).sort((a, b) => b.total - a.total), filteredRows };
}

// ================================================================
// 6. RENDERING FUNCTIONS
// ================================================================

function renderFunnel(adsTotals) {
    const s    = latestSalesAnalysis.summary;
    const spend = adsTotals.spend || 0;
    const rev   = s.totalRevenue  || 0;
    const totalBills     = s.totalBills     || 0;
    const totalCustomers = s.totalCustomers || 0;

    const roas        = spend > 0 ? rev / spend : 0;
    const cpl         = totalBills > 0 ? spend / totalBills : 0;
    const costPerHead = totalCustomers > 0 ? spend / totalCustomers : 0;
    const avgPerHead  = totalCustomers > 0 ? rev   / totalCustomers : 0;
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
        <div class="stat-card" style="border: 1px solid #3b82f6; background: rgba(59, 130, 246, 0.05);">
            <div class="stat-number" style="color: #3b82f6;">${formatCurrency(avgPerHead)}</div>
            <div class="stat-label">Avg Per Head</div>
        </div>
        <div class="stat-card" style="border: 1px solid var(--neon-cyan); background: rgba(0, 242, 254, 0.05);">
            <div class="stat-number" style="color: var(--neon-cyan);">${formatCurrency(cpl)}</div>
            <div class="stat-label">Cost per Booking (P1+P2)</div>
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
        if (span) span.innerHTML = '⇅';
        if (th.dataset.key === currentSort.key) {
            th.style.color = 'var(--neon-cyan)';
            if (span) span.innerHTML = currentSort.direction === 'asc' ? '▲' : '▼';
        } else {
            th.style.color = '';
        }
    });
}

function renderSalesStats(data) {
    const s   = data.summary;
    const ads = latestAdsTotals || {};
    const messaging = ads.messaging_conversations || 0;

    const messagingToP1Rate = messaging > 0 ? ((s.p1Bills  / messaging) * 100).toFixed(2) : "0.00";
    const messagingToP2Rate = messaging > 0 ? ((s.p2Leads  / messaging) * 100).toFixed(2) : "0.00";

    document.getElementById('salesOverviewStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatNumber(s.totalBills)}</div><div class="stat-label">Total Bills (P1+P2)</div></div>
        <div class="stat-card"><div class="stat-number">${formatCurrency(s.totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(s.totalCustomers)}</div><div class="stat-label">Total Customers</div></div>
        <div class="stat-card" style="border: 1px solid #34d399; background: rgba(52, 211, 153, 0.05);">
            <div class="stat-number" style="color: #34d399;">${formatNumber(s.newCustomersCount)}</div>
            <div class="stat-label">New Customers (P1/UP P2)</div>
        </div>
        <div class="stat-card" style="border: 1px solid #a855f7; background: rgba(168, 85, 247, 0.05);">
            <div class="stat-number" style="color: #a855f7;">${formatNumber(s.repeatCustomersCount)}</div>
            <div class="stat-label">Repeat Customers (P1/UP P2)</div>
        </div>
    `;

    const p1ToUpP1Rate = s.p1Bills  > 0 ? ((s.upp1Bills / s.p1Bills)  * 100).toFixed(2) : "0.00";
    const p2ToUpP2Rate = s.p2Leads  > 0 ? ((s.upp2Bills / s.p2Leads)  * 100).toFixed(2) : "0.00";

    document.getElementById('revenueContainer').innerHTML = `
        <div style="margin-bottom: 10px; color: var(--neon-cyan); font-weight: 600;">ยอดขายแยกตามประเภท (THB)</div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number" style="color:#34d399">${formatCurrency(s.p1Revenue)}</div>
                <div class="stat-label">P1 Revenue (${formatNumber(s.p1Bills)} บิล)</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" style="color:#ec4899">${formatCurrency(s.upp1Revenue)}</div>
                <div class="stat-label">UP P1 Revenue (${formatNumber(s.upp1Bills)} บิล)</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" style="color:#f59e0b">${formatCurrency(s.upp2Revenue)}</div>
                <div class="stat-label">UP P2 Revenue (${formatNumber(s.upp2Bills)} บิล)</div>
            </div>
        </div>

        <div style="margin-bottom: 10px; margin-top: 20px; color: var(--neon-cyan); font-weight: 600;">วิเคราะห์อัตราส่วนการอัพเกรด (Success Rate)</div>
        <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
            <div class="stat-card" style="border: 1px dashed var(--neon-cyan); background: rgba(0, 242, 254, 0.03);"><div class="stat-number" style="color:var(--neon-cyan)">${messagingToP1Rate}%</div><div class="stat-label">Msging ➔ P1 %</div></div>
            <div class="stat-card" style="border: 1px dashed #f59e0b; background: rgba(245, 158, 11, 0.03);"><div class="stat-number" style="color:#f59e0b">${messagingToP2Rate}%</div><div class="stat-label">Msging ➔ P2 %</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(s.p1Bills)}</div><div class="stat-label">P1 Bills</div></div>
            <div class="stat-card" style="border: 1px solid #ec4899; background: rgba(236, 72, 153, 0.05);"><div class="stat-number" style="color:#ec4899">${p1ToUpP1Rate}%</div><div class="stat-label">P1 ➔ UP P1 Rate</div></div>
            <div class="stat-card"><div class="stat-number">${formatNumber(s.p2Leads)}</div><div class="stat-label">P2 Leads</div></div>
            <div class="stat-card" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.05);"><div class="stat-number" style="color:#f59e0b">${p2ToUpP2Rate}%</div><div class="stat-label">P2 ➔ UP P2 Rate</div></div>
        </div>
    `;

    document.getElementById('categoryTableBody').innerHTML = data.categories.map((c, i) => {
        const totalCust = c.newCust + c.oldCust;
        return `
        <tr class="clickable-row" onclick="showCategoryDetails('${c.name.replace(/'/g, "\\'")}')">
            <td style="text-align:center;"><span class="type-badge">${i + 1}</span></td>
            <td><strong>${c.name}</strong></td>
            <td>${formatNumber(c.p1B)}<br><span style="font-size:0.85em; color:#34d399;">${formatCurrency(c.p1Val)}</span></td>
            <td>${formatNumber(c.up1B)}<br><span style="font-size:0.85em; color:#ec4899;">${formatCurrency(c.up1Val)}</span></td>
            <td>${formatNumber(c.up2B)}<br><span style="font-size:0.85em; color:#f59e0b;">${formatCurrency(c.up2Val)}</span></td>
            
            <td style="color:#60a5fa; font-weight:600;">${formatNumber(totalCust)}</td>
            <td style="color:#a855f7;">${formatNumber(c.oldCust)}</td>
            <td style="color:#34d399;">${formatNumber(c.newCust)}</td>
            <td class="revenue-cell">${formatCurrency(c.total)}</td>
        </tr>`;
    }).join('');

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

// ================================================================
// 6b. DAILY SPEND CHART
// ================================================================
function renderDailySpendChart(dailyData) {
    const canvas = document.getElementById('dailySpendChart');
    const ctx    = canvas.getContext('2d');

    // ทำลาย chart เดิมก่อนเสมอ
    if (charts.line) {
        charts.line.destroy();
        charts.line = null;
    }

    // ✅ ไม่กรองทิ้งวันที่ spend = 0 — เก็บไว้ทุกวัน
    const allData = (dailyData || []);

    // ── EMPTY STATE: ไม่มีข้อมูลวันไหนเลย ───────────────────────
    if (allData.length === 0) {
        const rect = canvas.getBoundingClientRect();
        const w = rect.width  || canvas.offsetWidth  || 600;
        const h = rect.height || canvas.offsetHeight || 200;
        canvas.width  = w * window.devicePixelRatio;
        canvas.height = h * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        ctx.clearRect(0, 0, w, h);

        // พื้นหลังจางๆ
        ctx.fillStyle = 'rgba(255,0,242,0.03)';
        ctx.fillRect(0, 0, w, h);

        // เส้น grid แนวนอน
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth   = 1;
        const gridLines = 5;
        for (let i = 1; i < gridLines; i++) {
            const y = (h / gridLines) * i;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // เส้น grid แนวตั้ง
        const vLines = 8;
        for (let i = 1; i < vLines; i++) {
            const x = (w / vLines) * i;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }

        // เส้นแนวโน้ม placeholder (คลื่นจาง)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,0,242,0.12)';
        ctx.lineWidth   = 2;
        for (let x = 0; x <= w; x += 2) {
            const y = h / 2 + Math.sin((x / w) * Math.PI * 3) * (h * 0.15);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // วงกลม icon background
        const cx = w / 2;
        const cy = h / 2 - 18;
        const r  = Math.min(w, h) * 0.1;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, 'rgba(255,0,242,0.25)');
        gradient.addColorStop(1, 'rgba(255,0,242,0.00)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // icon 📉
        ctx.font      = `${Math.max(18, Math.min(28, h * 0.18))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,0,242,0.85)';
        ctx.fillText('📉', cx, cy);

        // ข้อความหลัก
        const fontSize1 = Math.max(11, Math.min(14, h * 0.08));
        ctx.font      = `600 ${fontSize1}px sans-serif`;
        ctx.fillStyle = '#c0c0d0';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('ไม่มีข้อมูล Ad Spend ในช่วงเวลานี้', cx, cy + r + 16);

        // ข้อความรอง
        const fontSize2 = Math.max(9, Math.min(11, h * 0.065));
        ctx.font      = `${fontSize2}px sans-serif`;
        ctx.fillStyle = '#666680';
        ctx.fillText('ลองเปลี่ยนช่วงวันที่แล้วกด Refresh', cx, cy + r + 34);

        canvas.style.cursor = 'default';
        return;
    }

    // ── NORMAL CHART (รวมวันที่ spend = 0 ด้วย) ──────────────────
    // 🟡 จุดสีเหลือง + ขนาดใหญ่กว่า = วันที่ไม่มี spend แต่คลิกดูบิลได้
    const pointColors = allData.map(d =>
        toNumber(d.spend) === 0 ? '#facc15' : '#ff00f2'
    );
    const pointRadii = allData.map(d =>
        toNumber(d.spend) === 0 ? 7 : 5
    );

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allData.map(d => {
                const date = new Date(d.date);
                return `${date.getDate()}/${date.getMonth() + 1}`;
            }),
            datasets: [{
                label: 'Ad Spend (THB)',
                data: allData.map(d => toNumber(d.spend)),
                borderColor: '#ff00f2',
                backgroundColor: 'rgba(255, 0, 242, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: pointRadii,
                pointHoverRadius: 9,
                pointBackgroundColor: pointColors,
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements.length > 0) {
                    const idx     = elements[0].index;
                    const dayData = allData[idx];
                    if (dayData) showDailyAdsModal(dayData);
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#a0a0b0' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: { ticks: { color: '#a0a0b0' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const val = context.parsed.y;
                            return val === 0
                                ? '💸 ไม่มี Spend วันนี้ — คลิกดูบิล'
                                : `Ad Spend: ${formatCurrency(val)}`;
                        },
                        footer: () => '👆 คลิกเพื่อดูรายละเอียดวันนี้'
                    }
                }
            }
        }
    });

    canvas.style.cursor = 'pointer';
}

// ================================================================
// 7. MODALS
// ================================================================

function checkIsNewCustomer(row) {
    const C        = CONFIG.COLUMN_NAMES;
    const custName  = String(row[C.CUSTOMER] || '').trim();
    const custPhone = String(row[C.PHONE]    || '').trim();
    const startD    = new Date(ui.startDate.value + 'T00:00:00');

    const historyData = allSalesDataCache.filter(r => {
        const d = parseGvizDate(r[C.DATE]);
        return d && d < startD;
    });

    return !hasPaidHistory(custName, custPhone, historyData);
}

function showCategoryDetails(categoryName) {
    const C = CONFIG.COLUMN_NAMES;
    const filtered = latestSalesAnalysis.filteredRows.filter(r => {
        const rowCats = String(r[C.CATEGORIES] || '').split(',').map(s => s.trim());
        return rowCats.includes(categoryName);
    });

    const groups = {
        p1:  filtered.filter(r => toNumber(r[C.P1])    > 0 && toNumber(r[C.UP_P1]) === 0),
        up1: filtered.filter(r => toNumber(r[C.UP_P1]) > 0),
        up2: filtered.filter(r => toNumber(r[C.UP_P2]) > 0)
    };

    ui.modalTitle.textContent = `หมวดหมู่: ${categoryName}`;
    let html = '';

    if (groups.p1.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">📦 P1 Bills <span class="type-badge">${groups.p1.length} items</span></div>
            <div class="scrollable-table">
                <table>
                    <thead><tr><th>Date</th><th>Customer</th><th>Channel</th><th>ลูกค้าใหม่</th><th>Interest</th><th>Revenue</th></tr></thead>
                    <tbody>
                        ${groups.p1.map(r => {
                            const isNew = checkIsNewCustomer(r);
                            return `<tr>
                                <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                                <td>${r[C.CUSTOMER] || '-'}</td>
                                <td>${r[C.CHANNEL]  || '-'}</td>
                                <td><span style="color:${isNew ? '#34d399' : '#a855f7'}; font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                                <td><small>${r[C.INTEREST] || '-'}</small></td>
                                <td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    if (groups.up1.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">🚀 UP P1 Bills <span class="type-badge">${groups.up1.length} items</span></div>
            <div class="scrollable-table">
                <table>
                    <thead><tr><th>Date</th><th>Customer</th><th>Channel</th><th>ลูกค้าใหม่</th><th>Upgrade Item</th><th>Original P1</th><th>Original P1 Amt</th><th>Upgrade Amt</th></tr></thead>
                    <tbody>
                        ${groups.up1.map(r => {
                            const custName  = String(r[C.CUSTOMER] || '').trim();
                            const custPhone = String(r[C.PHONE]    || '').trim();
                            const history   = allSalesDataCache.find(h => {
                                const hName  = String(h[C.CUSTOMER] || '').trim();
                                const hPhone = String(h[C.PHONE]    || '').trim();
                                return ((custPhone && hPhone === custPhone) || (hName === custName)) && toNumber(h[C.P1]) > 0;
                            });
                            const p1Val      = history ? toNumber(history[C.P1]) : 0;
                            const p1Interest = history ? history[C.INTEREST]     : 'Not Found';
                            const isNew = checkIsNewCustomer(r);
                            return `<tr>
                                <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                                <td>${r[C.CUSTOMER] || '-'}</td>
                                <td>${r[C.CHANNEL]  || '-'}</td>
                                <td><span style="color:${isNew ? '#34d399' : '#a855f7'}; font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                                <td><small>${r[C.INTEREST] || '-'}</small></td>
                                <td><span class="context-label">Old Interest</span>${p1Interest}</td>
                                <td class="context-cell">${formatCurrency(p1Val)}</td>
                                <td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P1]))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    if (groups.up2.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">💎 UP P2 Bills <span class="type-badge">${groups.up2.length} items</span></div>
            <div class="scrollable-table">
                <table>
                    <thead><tr><th>Date</th><th>Customer</th><th>Channel</th><th>ลูกค้าใหม่</th><th>Upgrade Interest</th><th>Original P2</th><th>Revenue</th></tr></thead>
                    <tbody>
                        ${groups.up2.map(r => {
                            const custName  = String(r[C.CUSTOMER] || '').trim();
                            const custPhone = String(r[C.PHONE]    || '').trim();
                            const history   = allSalesDataCache.find(h => {
                                const hName  = String(h[C.CUSTOMER] || '').trim();
                                const hPhone = String(h[C.PHONE]    || '').trim();
                                return ((custPhone && hPhone === custPhone) || (hName === custName)) && h[C.P2] && String(h[C.P2]).trim() !== '';
                            });
                            const p2Interest = history ? history[C.INTEREST]                         : 'Not Found';
                            const p2Date     = history ? formatDate(parseGvizDate(history[C.DATE]))  : '';
                            const isNew = checkIsNewCustomer(r);
                            return `<tr>
                                <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                                <td>${r[C.CUSTOMER] || '-'}</td>
                                <td>${r[C.CHANNEL]  || '-'}</td>
                                <td><span style="color:${isNew ? '#34d399' : '#a855f7'}; font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                                <td><small>${r[C.INTEREST] || '-'}</small></td>
                                <td><span class="context-label">Lead Date: ${p2Date}</span>${p2Interest}</td>
                                <td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    if (html === '') html = '<p style="text-align:center; padding: 20px;">No transaction details found.</p>';
    ui.modalBody.innerHTML = html;
    ui.modal.classList.add('show');
}

function showChannelDetails(channelName) {
    const C = CONFIG.COLUMN_NAMES;
    const filtered = latestSalesAnalysis.filteredRows.filter(r => (r[C.CHANNEL] || 'ไม่ระบุ') === channelName);
    const groups = {
        p1:   filtered.filter(r => toNumber(r[C.P1])    > 0 && toNumber(r[C.UP_P1]) === 0),
        p2:   filtered.filter(r => r[C.P2] && String(r[C.P2]).trim() !== ''),
        upP2: filtered.filter(r => toNumber(r[C.UP_P2]) > 0)
    };
    ui.modalTitle.textContent = `ช่องทาง: ${channelName}`;
    let html = '';
    if (groups.p1.length > 0)   html += `<div class="type-section"><div class="type-title">📦 P1 Bills <span class="type-badge">${groups.p1.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.p1.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td></tr>`).join('')}</tbody></table></div></div>`;
    if (groups.p2.length > 0)   html += `<div class="type-section"><div class="type-title">📋 P2 Leads <span class="type-badge">${groups.p2.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th></tr></thead><tbody>${groups.p2.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.P2] || '-'}</small></td></tr>`).join('')}</tbody></table></div></div>`;
    if (groups.upP2.length > 0) html += `<div class="type-section"><div class="type-title">💎 UP P2 Bills <span class="type-badge">${groups.upP2.length}</span></div><div class="scrollable-table"><table><thead><tr><th>Date</th><th>Customer</th><th>Tel</th><th>Interest</th><th>Revenue</th></tr></thead><tbody>${groups.upP2.map(r => `<tr><td>${formatDate(parseGvizDate(r[C.DATE]))}</td><td>${r[C.CUSTOMER] || '-'}</td><td>${r[C.PHONE] || '-'}</td><td><small>${r[C.INTEREST] || '-'}</small></td><td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td></tr>`).join('')}</tbody></table></div></div>`;
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
        ui.modalBody.innerHTML = ads.sort((a, b) => b.insights.spend - a.insights.spend).map(ad => `
            <div class="ad-card">
                <img src="${ad.thumbnail_url}" onerror="this.src='https://placehold.co/80x80?text=No+Img'">
                <div style="flex:1;">
                    <h4>${ad.name}</h4>
                    <div style="font-size:0.9em; color:#a0a0b0; display:grid; grid-template-columns: 1fr 1fr; margin-top:5px;">
                        <div>Spend: <span style="color:white;">${formatCurrency(ad.insights.spend)}</span></div>
                        <div>Purchases: <span style="color:white;">${formatNumber(ad.insights.purchases)}</span></div>
                        <div>Messaging: <span style="color:white;">${formatNumber(ad.insights.messaging_conversations)}</span></div>
                        <div>Impressions: <span style="color:white;">${formatNumber(ad.insights.impressions)}</span></div>
                        <div>CPM: <span style="color:white;">${formatCurrency(ad.insights.cpm)}</span></div>
                    </div>
                </div>
            </div>`).join('');
    }
    ui.modal.classList.add('show');
}

// ================================================================
// 7b. DAILY ADS MODAL
// ================================================================

function normalizeDateStr(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return s.slice(0, 10);
}

function getDailyMessaging(dateStr) {
    const targetDate = normalizeDateStr(dateStr);
    let total = 0;

    (latestCampaignData || []).forEach(campaign => {
        (campaign.ads || []).forEach(ad => {
            const breakdown = ad.daily_breakdown || ad.insights_daily || [];
            breakdown.forEach(day => {
                if (normalizeDateStr(day.date) === targetDate) {
                    total += toNumber(day.messaging_conversations || day.messaging || 0);
                }
            });
        });
    });

    if (total === 0) {
        const totalSpend = toNumber(latestAdsTotals.spend || 0);
        const totalMsg   = toNumber(latestAdsTotals.messaging_conversations || 0);
        const dayEntry   = latestDailySpendData.find(d => normalizeDateStr(d.date) === targetDate);
        const daySpend   = toNumber((dayEntry || {}).spend || 0);
        if (totalSpend > 0 && totalMsg > 0 && daySpend > 0) {
            total = Math.round((daySpend / totalSpend) * totalMsg);
        }
    }
    return total;
}

function processDailyAdsSales(dateStr) {
    const C          = CONFIG.COLUMN_NAMES;
    const normalized = normalizeDateStr(dateStr);
    const targetDate = new Date(normalized + 'T00:00:00');
    const targetY    = targetDate.getFullYear();
    const targetM    = targetDate.getMonth();
    const targetD    = targetDate.getDate();

    const dayRows = latestSalesAnalysis.filteredRows.filter(r => {
        const d = parseGvizDate(r[C.DATE]);
        return d && d.getFullYear() === targetY && d.getMonth() === targetM && d.getDate() === targetD;
    });

    let p1Bills = 0, p1Revenue = 0;
    let p2Leads = 0;
    let up1Bills = 0, up1Revenue = 0;
    let up2Bills = 0, up2Revenue = 0;
    let totalRevenue = 0, totalCustomers = 0;

    dayRows.forEach(r => {
        const p1    = toNumber(r[C.P1]);
        const up1   = toNumber(r[C.UP_P1]);
        const up2   = toNumber(r[C.UP_P2]);
        const p2Str = String(r[C.P2] || '').trim();

        if (p1  > 0) { p1Bills++;  p1Revenue  += p1;  }
        if (up1 > 0) { up1Bills++; up1Revenue += up1; }
        if (up2 > 0) { up2Bills++; up2Revenue += up2; }
        if (p2Str !== '') p2Leads++;

        const rev = p1 + up1 + up2;
        if (p1 > 0 || up2 > 0) totalCustomers++;
        totalRevenue += rev;
    });

    return { dayRows, p1Bills, p1Revenue, p2Leads, up1Bills, up1Revenue, up2Bills, up2Revenue, totalRevenue, totalCustomers };
}

function showDailyAdsModal(dayData) {
    const C       = CONFIG.COLUMN_NAMES;
    const dateStr = normalizeDateStr(dayData.date);
    const spend   = dayData.spend || 0;
    const messaging = getDailyMessaging(dateStr);

    const sales = processDailyAdsSales(dateStr);
    const { p1Bills, p1Revenue, p2Leads, up1Bills, up1Revenue,
            up2Bills, up2Revenue, totalRevenue, totalCustomers, dayRows } = sales;

    const avgPerHead  = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
    const closingP1   = messaging > 0 ? ((p1Bills / messaging) * 100).toFixed(2) : '0.00';
    const closingP2   = messaging > 0 ? ((p2Leads / messaging) * 100).toFixed(2) : '0.00';
    const roas        = spend > 0 ? (totalRevenue / spend).toFixed(2) : '0.00';
    const costPerHead = totalCustomers > 0 ? spend / totalCustomers : 0;

    const displayDate = formatDate(new Date(dateStr + 'T00:00:00'));
    const branchName  = (() => {
        try { return document.querySelector('h1').innerText.split(':')[0].trim(); } catch(e) { return 'สาขา'; }
    })();

    ui.modalTitle.textContent = `📅 วิเคราะห์ Ads ${displayDate}`;

    const p1Rows  = dayRows.filter(r => toNumber(r[C.P1])    > 0 && toNumber(r[C.UP_P1]) === 0);
    const up1Rows = dayRows.filter(r => toNumber(r[C.UP_P1]) > 0);
    const p2Rows  = dayRows.filter(r => String(r[C.P2] || '').trim() !== '');
    const up2Rows = dayRows.filter(r => toNumber(r[C.UP_P2]) > 0);

    const kpiCard = (color, value, label) => `
        <div style="border:1px solid ${color};background:${color}12;border-radius:10px;
                    padding:12px 8px;text-align:center;min-width:0;">
            <div style="font-size:1.05em;font-weight:700;color:${color};
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>
            <div style="font-size:0.68em;color:#a0a0b0;margin-top:4px;line-height:1.3;">${label}</div>
        </div>`;

    const sectionLabel = (text) => `
        <div style="font-size:0.7em;font-weight:700;color:#555;letter-spacing:1.5px;
                    text-transform:uppercase;margin:14px 0 6px 2px;">${text}</div>`;

    let html = `
    <div id="dailyModalExportArea"
         style="background:#0f0f1a;padding:18px 16px;border-radius:12px;">

        <!-- ── Header ── -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding-bottom:12px;margin-bottom:4px;
                    border-bottom:1px solid rgba(0,242,254,0.25);">
            <div>
                <div style="font-size:1.05em;font-weight:700;color:#00f2fe;letter-spacing:1px;">
                    🏪 ${branchName}
                </div>
                <div style="font-size:0.78em;color:#a0a0b0;margin-top:2px;">
                    📅 ประจำวันที่ ${displayDate}
                </div>
            </div>
            <div style="text-align:right;font-size:0.72em;color:#444;">
                Ads Analytics Report
            </div>
        </div>

        <!-- ══ SECTION 1: ADS PERFORMANCE ══ -->
        ${sectionLabel('📣 Ads Performance')}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${kpiCard('#ff00f2', formatCurrency(spend),        '💸 ค่า Ads')}
            ${kpiCard('#00f2fe', formatNumber(messaging),      '💬 Messaging')}
            ${kpiCard('#ec4899', formatCurrency(costPerHead),  '💡 Cost / Head')}
        </div>

        <!-- ══ SECTION 2: SALES SUMMARY ══ -->
        ${sectionLabel('💰 Sales Summary')}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
            ${kpiCard('#34d399', p1Bills + ' บิล',             '📦 P1 บิล')}
            ${kpiCard('#34d399', formatCurrency(p1Revenue),    '📦 P1 ยอด')}
            ${kpiCard('#f59e0b', p2Leads + ' นัด',             '📋 P2 Leads')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
            ${kpiCard('#ec4899', up1Bills + ' บิล',            '🚀 UP P1 บิล')}
            ${kpiCard('#ec4899', formatCurrency(up1Revenue),   '🚀 UP P1 ยอด')}
            ${kpiCard('#f59e0b', p2Leads + ' นัด → ' + up2Bills + ' ปิด', '💎 P2→UP P2')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${kpiCard('#a78bfa', up2Bills + ' บิล',            '💎 UP P2 บิล')}
            ${kpiCard('#a78bfa', formatCurrency(up2Revenue),   '💎 UP P2 ยอด')}
            ${kpiCard('#ffffff', formatCurrency(totalRevenue), '🏆 ยอดขายรวม')}
        </div>

        <!-- ══ SECTION 3: CONVERSION & EFFICIENCY ══ -->
        ${sectionLabel('🎯 Conversion & Efficiency')}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
            ${kpiCard('#00f2fe', closingP1 + '%',              '🎯 ปิด P1<br><span style="font-size:0.9em;opacity:0.6;">Msg→P1</span>')}
            ${kpiCard('#f59e0b', closingP2 + '%',              '🎯 ปิด P2<br><span style="font-size:0.9em;opacity:0.6;">Msg→P2</span>')}
            ${kpiCard('#3b82f6', formatCurrency(avgPerHead),   '👤 Avg / Head')}
            ${kpiCard('#a855f7', roas + 'x',                   '📈 ROAS')}
        </div>

        <!-- ── Bill tables ── -->
        ${buildDailyBillTables(p1Rows, up1Rows, p2Rows, up2Rows)}
    </div>

    <!-- ── Export button ── -->
    <div style="text-align:center;margin-top:14px;">
        <button id="exportDailyBtn"
            onclick="exportDailyModalAsImage('${branchName}', '${displayDate}')"
            style="padding:9px 26px;
                   background:linear-gradient(135deg,#00f2fe,#a855f7);
                   color:#000;border:none;border-radius:8px;font-weight:700;
                   cursor:pointer;font-size:0.9em;letter-spacing:0.5px;">
            📷 Export เป็นรูป
        </button>
    </div>`;

    ui.modalBody.innerHTML = html;
    ui.modal.classList.add('show');
}

// ── ตารางบิลทุกประเภท ────────────────────────────────────────────
function buildDailyBillTables(p1Rows, up1Rows, p2Rows, up2Rows) {
    const C = CONFIG.COLUMN_NAMES;
    let html = '';

    // P1
    if (p1Rows.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">📦 P1 Bills <span class="type-badge">${p1Rows.length} items</span></div>
            <div class="scrollable-table"><table>
                <thead><tr>
                    <th>Date</th><th>Customer</th><th>Channel</th>
                    <th>ลูกค้าใหม่</th><th>Interest</th><th>Revenue</th>
                </tr></thead>
                <tbody>
                ${p1Rows.map(r => {
                    const isNew = checkIsNewCustomer(r);
                    return `<tr>
                        <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                        <td>${r[C.CUSTOMER] || '-'}</td>
                        <td>${r[C.CHANNEL]  || '-'}</td>
                        <td><span style="color:${isNew ? '#34d399' : '#a855f7'};font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                        <td><small>${r[C.INTEREST] || '-'}</small></td>
                        <td class="revenue-cell">${formatCurrency(toNumber(r[C.P1]))}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>
        </div>`;
    }

    // UP P1
    if (up1Rows.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">🚀 UP P1 Bills <span class="type-badge">${up1Rows.length} items</span></div>
            <div class="scrollable-table"><table>
                <thead><tr>
                    <th>Date</th><th>Customer</th><th>Channel</th>
                    <th>ลูกค้าใหม่</th><th>Upgrade Item</th>
                    <th>Original P1</th><th>Original Amt</th><th>Upgrade Amt</th>
                </tr></thead>
                <tbody>
                ${up1Rows.map(r => {
                    const custName  = String(r[C.CUSTOMER] || '').trim();
                    const custPhone = String(r[C.PHONE]    || '').trim();
                    const history   = allSalesDataCache.find(h => {
                        const hName  = String(h[C.CUSTOMER] || '').trim();
                        const hPhone = String(h[C.PHONE]    || '').trim();
                        return ((custPhone && hPhone === custPhone) || (hName === custName)) && toNumber(h[C.P1]) > 0;
                    });
                    const p1Val      = history ? toNumber(history[C.P1]) : 0;
                    const p1Interest = history ? history[C.INTEREST]     : 'Not Found';
                    const isNew = checkIsNewCustomer(r);
                    return `<tr>
                        <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                        <td>${r[C.CUSTOMER] || '-'}</td>
                        <td>${r[C.CHANNEL]  || '-'}</td>
                        <td><span style="color:${isNew ? '#34d399' : '#a855f7'};font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                        <td><small>${r[C.INTEREST] || '-'}</small></td>
                        <td><span class="context-label">Old Interest</span>${p1Interest}</td>
                        <td class="context-cell">${formatCurrency(p1Val)}</td>
                        <td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P1]))}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>
        </div>`;
    }

    // P2 Leads
    if (p2Rows.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">📋 P2 Leads <span class="type-badge">${p2Rows.length} items</span></div>
            <div class="scrollable-table"><table>
                <thead><tr>
                    <th>Date</th><th>Customer</th><th>Channel</th><th>Tel</th>
                    <th>รายการที่สนใจ</th>
                </tr></thead>
                <tbody>
                ${p2Rows.map(r => `<tr>
                    <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                    <td>${r[C.CUSTOMER] || '-'}</td>
                    <td>${r[C.CHANNEL]  || '-'}</td>
                    <td style="color:#a0a0b0;font-size:0.85em;">${r[C.PHONE] || '-'}</td>
                    <td><small style="color:#a0a0b0;">${r[C.INTEREST] || '-'}</small></td>
                </tr>`).join('')}
                </tbody>
            </table></div>
        </div>`;
    }

    // UP P2
    if (up2Rows.length > 0) {
        html += `
        <div class="type-section">
            <div class="type-title">💎 UP P2 Bills <span class="type-badge">${up2Rows.length} items</span></div>
            <div class="scrollable-table"><table>
                <thead><tr>
                    <th>Date</th><th>Customer</th><th>Channel</th>
                    <th>ลูกค้าใหม่</th><th>Upgrade Interest</th><th>Original P2</th><th>Revenue</th>
                </tr></thead>
                <tbody>
                ${up2Rows.map(r => {
                    const custName  = String(r[C.CUSTOMER] || '').trim();
                    const custPhone = String(r[C.PHONE]    || '').trim();
                    const history   = allSalesDataCache.find(h => {
                        const hName  = String(h[C.CUSTOMER] || '').trim();
                        const hPhone = String(h[C.PHONE]    || '').trim();
                        return ((custPhone && hPhone === custPhone) || (hName === custName))
                            && h[C.P2] && String(h[C.P2]).trim() !== '';
                    });
                    const p2Interest = history ? history[C.INTEREST]                         : 'Not Found';
                    const p2Date     = history ? formatDate(parseGvizDate(history[C.DATE]))  : '';
                    const isNew = checkIsNewCustomer(r);
                    return `<tr>
                        <td>${formatDate(parseGvizDate(r[C.DATE]))}</td>
                        <td>${r[C.CUSTOMER] || '-'}</td>
                        <td>${r[C.CHANNEL]  || '-'}</td>
                        <td><span style="color:${isNew ? '#34d399' : '#a855f7'};font-weight:600;">${isNew ? '🟢 ใหม่' : '🟣 เก่า'}</span></td>
                        <td><small>${r[C.INTEREST] || '-'}</small></td>
                        <td><span class="context-label">Lead Date: ${p2Date}</span>${p2Interest}</td>
                        <td class="revenue-cell">${formatCurrency(toNumber(r[C.UP_P2]))}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>
        </div>`;
    }

    if (html === '') html = '<p style="text-align:center;color:#a0a0b0;padding:20px;">ไม่มีบิลในวันนี้</p>';
    return html;
}

// ── Export modal เป็นรูป ──────────────────────────────────────────
async function exportDailyModalAsImage(branchName, displayDate) {
    const btn = document.getElementById('exportDailyBtn');
    if (btn) { btn.textContent = '⏳ กำลังสร้างรูป...'; btn.disabled = true; }

    try {
        if (typeof html2canvas === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                s.onload = resolve; s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        const target = document.getElementById('dailyModalExportArea');

        const scrollDivs = target.querySelectorAll('.scrollable-table');
        const origMax = [], origOvf = [];
        scrollDivs.forEach(d => {
            origMax.push(d.style.maxHeight);
            origOvf.push(d.style.overflow);
            d.style.maxHeight = 'none';
            d.style.overflow  = 'visible';
        });

        const canvas = await html2canvas(target, {
            backgroundColor: '#0f0f1a',
            scale: 3,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: target.scrollWidth,
            windowHeight: target.scrollHeight
        });

        scrollDivs.forEach((d, i) => {
            d.style.maxHeight = origMax[i];
            d.style.overflow  = origOvf[i];
        });

        const safeDate   = displayDate.replace(/\s/g, '').replace(/\//g, '-');
        const safeBranch = branchName.replace(/[^a-zA-Zก-๙0-9]/g, '_');
        const link = document.createElement('a');
        link.download = `${safeBranch}_${safeDate}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();

        if (btn) { btn.textContent = '✅ บันทึกแล้ว!'; }
        setTimeout(() => {
            if (btn) { btn.textContent = '📷 Export เป็นรูป'; btn.disabled = false; }
        }, 2000);

    } catch (err) {
        console.error('Export error:', err);
        if (btn) { btn.textContent = '❌ Export ไม่สำเร็จ'; }
        setTimeout(() => {
            if (btn) { btn.textContent = '📷 Export เป็นรูป'; btn.disabled = false; }
        }, 2000);
    }
}

// ================================================================

async function exportToGoogleSheet() {
    const s = latestSalesAnalysis.summary;
    const ads = latestAdsTotals || {};
    const branchName = document.querySelector('h1').innerText.split(':')[0].replace('🚀 ', '').trim();

    // คำนวณ PAR จากข้อมูลจริง
    const PAR_P1 = 200; // เป้าหมายบิล P1
    const PAR_P2 = 150; // เป้าหมาย P2 Leads

    // ข้อมูลตามหัวข้อในรูปภาพ
    const data = {
        branch: branchName,
        facebookAds: ads.spend || 0,
        parBillP1: PAR_P1,
        p1Revenue: s.p1Revenue || 0,
        p1Bills: s.p1Bills || 0,
        upP1Revenue: s.upp1Revenue || 0,
        parP2: PAR_P2,
        p2Named: s.p2Leads || 0, // P2 ที่ได้ชื่อ (Leads)
        p2Entered: s.upp2Bills || 0, // P2 ที่เข้ามา (จำนวนบิล UP P2)
        upP2Revenue: s.upp2Revenue || 0,
        shortfallBill: Math.max(0, PAR_P1 - (s.p1Bills || 0)), // ยอดขาด/บิล = 200 - จำนวนบิล P1
        shortfallP2: Math.max(0, PAR_P2 - (s.p2Leads || 0)), // ยอดขาด/P2 = 150 - P2 ที่ได้ชื่อ
        totalRevenue: s.totalRevenue || 0
    };

    const btn = ui.exportSheetBtn;
    const originalText = btn.textContent;
    btn.textContent = '⏳ กำลังส่งข้อมูล...';
    btn.disabled = true;

    try {
        // หมายเหตุ: ต้องมี Google Apps Script Webhook URL
        const WEBHOOK_URL = CONFIG.GOOGLE_SHEET_WEBHOOK_URL; 
        
        if (!WEBHOOK_URL || WEBHOOK_URL === 'YOUR_APPS_SCRIPT_URL') {
            alert('กรุณาตั้งค่า GOOGLE_SHEET_WEBHOOK_URL ใน CONFIG ก่อนใช้งาน');
            throw new Error('Webhook URL not configured');
        }

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors', // ใช้ no-cors สำหรับ Apps Script
            cache: 'no-cache',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp: new Date().toLocaleString('th-TH'),
                startDate: ui.startDate.value,
                endDate: ui.endDate.value,
                ...data
            })
        });

        btn.textContent = '✅ ส่งข้อมูลสำเร็จ!';
        btn.style.background = '#2e7d32';
    } catch (err) {
        console.error('Export Error:', err);
        alert('เกิดข้อผิดพลาดในการส่งข้อมูล: ' + err.message);
        btn.textContent = '❌ ส่งข้อมูลไม่สำเร็จ';
        btn.style.background = '#c62828';
    } finally {
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = 'linear-gradient(135deg, #34a853, #1b5e20)';
            btn.disabled = false;
        }, 3000);
    }
}

// ================================================================
// 8. PROMPT GENERATORS
// ================================================================

function generateAdsAnalystPrompt() {
    const s         = latestSalesAnalysis.summary;
    const ads       = latestAdsTotals || {};
    const f         = (n) => formatCurrency(n);
    const num       = (n) => formatNumber(n);
    const spend     = ads.spend || 0;
    const rev       = s.totalRevenue || 0;
    const messaging = ads.messaging_conversations || 0;
    const aph       = s.totalCustomers > 0 ? (rev / s.totalCustomers) : 0;
    const msgingToP1 = messaging > 0 ? ((s.p1Bills / messaging) * 100).toFixed(2) : "0.00";
    const msgingToP2 = messaging > 0 ? ((s.p2Leads / messaging) * 100).toFixed(2) : "0.00";

    const cats     = latestSalesAnalysis.categories || [];
    const getTop5  = (sortKey) => [...cats].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 5);
    const channels = latestSalesAnalysis.channels || {};
    const sortedChannels = Object.entries(channels).sort((a, b) => b[1].revenue - a[1].revenue);

    let p = `### [สรุป Ads Analyst]\n`;
    p += `ค่า Ads = ${f(spend)}\n`;
    p += `ข้อความทัก = ${num(messaging)}\n`;
    p += `P1 บิล = ${num(s.p1Bills)}\n`;
    p += `P1 ยอด = ${f(s.p1Revenue)}\n`;
    p += `การปิด P1% = ${msgingToP1}%\n`;
    p += `P2 นัด = ${num(s.p2Leads)}\n`;
    p += `การปิด P2% = ${msgingToP2}%\n`;
    p += `Avg Per Head = ${f(aph)}\n\n`;

    p += `หมวดหมู่ P1 (บิลพร้อมยอดชำระ):\n`;
    const p1cats = getTop5('p1B').filter(c => c.p1B > 0);
    p += (p1cats.length > 0
        ? p1cats.map(c => `- ${c.name}: ${num(c.p1B)} บิล | ยอดสะสม: ${f(c.p1Val)}`).join('\n')
        : '- ไม่มีข้อมูล');
    p += `\n\n`;

    p += `ช่องทางการติดต่อ P1 (บิล P1 แยกตามช่องทาง):\n`;
    if (sortedChannels.length > 0) {
        sortedChannels.forEach(([chName, chVal]) => {
            if (chVal.p1 > 0) p += `- ${chName}: ${num(chVal.p1)} บิล\n`;
        });
    } else {
        p += `- ไม่มีข้อมูล\n`;
    }
    p += `\n____________________\n\n`;

    p += `UP P1 บิล = ${num(s.upp1Bills)}\n`;
    p += `UP P1 ยอดชำระ = ${f(s.upp1Revenue)}\n`;
    p += `หมวดหมู่ UP P1 (บิลพร้อมยอดชำระ):\n`;
    const up1cats = getTop5('up1B').filter(c => c.up1B > 0);
    p += (up1cats.length > 0
        ? up1cats.map(c => `- ${c.name}: ${num(c.up1B)} บิล | ยอดสะสม: ${f(c.up1Val)}`).join('\n')
        : '- ไม่มีข้อมูล');
    p += `\n\n`;

    p += `UP P2 บิล = ${num(s.upp2Bills)}\n`;
    p += `UP P2 ยอดชำระ = ${f(s.upp2Revenue)}\n`;
    p += `หมวดหมู่ UP P2 (บิลพร้อมยอดชำระ):\n`;
    const up2cats = getTop5('up2B').filter(c => c.up2B > 0);
    p += (up2cats.length > 0
        ? up2cats.map(c => `- ${c.name}: ${num(c.up2B)} บิล | ยอดสะสม: ${f(c.up2Val)}`).join('\n')
        : '- ไม่มีข้อมูล');
    p += `\n\n`;

    p += `ช่องทางการติดต่อ UP P2 (แยกตามช่องทาง):\n`;
    if (sortedChannels.length > 0) {
        sortedChannels.forEach(([chName, chVal]) => {
            if (chVal.upP2 > 0) p += `- ${chName}: ${num(chVal.upP2)} บิล | ยอดสะสม: ${f(chVal.up2Revenue)}\n`;
        });
    } else {
        p += `- ไม่มีข้อมูล\n`;
    }
    p += `\n____________________\n\n`;

    p += `สรุปช่องทางการติดต่อรวมทุกประเภท (เรียงตามยอดขาย):\n`;
    if (sortedChannels.length > 0) {
        sortedChannels.forEach(([chName, chVal]) => {
            p += `- ${chName}: P1=${num(chVal.p1)} บิล | P2=${num(chVal.p2)} นัด | UP P2=${num(chVal.upP2)} บิล | ยอดรวม=${f(chVal.revenue)}\n`;
        });
    } else {
        p += `- ไม่มีข้อมูล\n`;
    }

    p += `\nกรุณาวิเคราะห์ประสิทธิภาพ Ads โดยเน้นเปรียบเทียบ Cost per Result, Messaging Rate และ Conversion ของแต่ละหมวดหมู่สินค้า รวมถึงประสิทธิภาพแต่ละช่องทางการติดต่อครับ`;

    return p;
}

function generateBranchSummaryPrompt() {
    const s          = latestSalesAnalysis.summary;
    const ads        = latestAdsTotals || {};
    const f          = (n) => formatCurrency(n);
    const num        = (n) => formatNumber(n);
    const branchName = document.querySelector('h1').innerText.split(':')[0].trim();

    const spend      = ads.spend || 0;
    const rev        = s.totalRevenue || 0;
    const messaging  = ads.messaging_conversations || 0;
    const roas       = spend > 0 ? (rev / spend).toFixed(2) + 'x' : '0x';
    const cpb        = s.totalBills     > 0 ? (spend / s.totalBills)     : 0;
    const cph        = s.totalCustomers > 0 ? (spend / s.totalCustomers) : 0;
    const aph        = s.totalCustomers > 0 ? (rev   / s.totalCustomers) : 0;
    const bookingClose  = s.totalBills  > 0 ? ((s.totalCustomers / s.totalBills) * 100).toFixed(2) : 0;
    const msgingToP1    = messaging > 0 ? ((s.p1Bills  / messaging) * 100).toFixed(2) : "0.00";
    const msgingToP2    = messaging > 0 ? ((s.p2Leads  / messaging) * 100).toFixed(2) : "0.00";
    const p1ToUpP1Rate  = s.p1Bills > 0 ? ((s.upp1Bills / s.p1Bills) * 100).toFixed(2) : "0.00";
    const p2ToUpP2Rate  = s.p2Leads > 0 ? ((s.upp2Bills / s.p2Leads) * 100).toFixed(2) : "0.00";

    const cats     = latestSalesAnalysis.categories || [];
    const getTop5  = (sortKey) => [...cats].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 5);

    let p = `### [สรุปผลรวมสาขา]\n`;
    p += `สาขา: ${branchName}\n`;
    p += `ช่วงเวลา: ${formatDate(new Date(ui.startDate.value))} ถึง ${formatDate(new Date(ui.endDate.value))}\n\n`;

    p += `--- [ข้อมูล Ads & Funnel] ---\n`;
    p += `Ad Spend: ${f(spend)}\n`;
    p += `Total Revenue: ${f(rev)}\n`;
    p += `ROAS: ${roas}\n`;
    p += `Avg Per Head: ${f(aph)}\n`;
    p += `Messaging: ${num(messaging)}\n`;
    p += `Cost Per Booking: ${f(cpb)}\n`;
    p += `Cost Per Head: ${f(cph)}\n`;
    p += `Booking → Close: ${bookingClose}%\n\n`;

    p += `--- [วิเคราะห์ Success Rate %] ---\n`;
    p += `Messaging ➔ P1 Rate: ${msgingToP1}%\n`;
    p += `Messaging ➔ P2 Rate: ${msgingToP2}%\n`;
    p += `P1 ➔ UP P1 Rate: ${p1ToUpP1Rate}%\n`;
    p += `P2 ➔ UP P2 Rate: ${p2ToUpP2Rate}%\n\n`;

    p += `--- [วิเคราะห์ลูกค้า] ---\n`;
    p += `* Total Customers: ${num(s.totalCustomers)}\n`;
    p += `* New Customers (P1/UP P2): ${num(s.newCustomersCount)}\n`;
    p += `* Repeat Customers (P1/UP P2): ${num(s.repeatCustomersCount)}\n\n`;

    p += `--- [รายละเอียดยอดขาย] ---\n`;
    p += `Total Revenue: ${f(rev)}\n`;
    p += `ยอดขาย P1: ${f(s.p1Revenue)} (${num(s.p1Bills)} บิล)\n`;
    p += `ยอดอัพ P1: ${f(s.upp1Revenue)} (${num(s.upp1Bills)} บิล)\n`;
    p += `ยอดอัพ P2: ${f(s.upp2Revenue)} (${num(s.upp2Bills)} บิล)\n`;
    p += `P2 Leads: ${num(s.p2Leads)} Leads\n\n`;

    p += `5 อันดับหมวดหมู่ขายดีทั้งหมด (รายได้รวมสูงสุด):\n`;
    p += getTop5('total').map(c => `- ${c.name}: ${f(c.total)}`).join('\n') + `\n\n`;

    p += `5 อันดับหมวดหมู่ P1 ขายดี (ลูกค้าใหม่/ซื้อทันที):\n`;
    p += getTop5('p1B').map(c => `- ${c.name}: ${num(c.p1B)} บิล | ยอดชำระ: ${f(c.p1Val)}`).join('\n') + `\n\n`;

    p += `5 อันดับหมวดหมู่ UP P1 ขายดี (อัพเกรดจาก P1):\n`;
    p += getTop5('up1B').map(c => `- ${c.name}: ${num(c.up1B)} บิล | ยอดชำระ: ${f(c.up1Val)}`).join('\n') + `\n\n`;

    p += `5 อันดับหมวดหมู่ UP P2 ขายดี (ปิดการขายจาก Lead):\n`;
    p += getTop5('up2B').map(c => `- ${c.name}: ${num(c.up2B)} บิล | ยอดชำระ: ${f(c.up2Val)}`).join('\n') + `\n\n`;

    const channels       = latestSalesAnalysis.channels || {};
    const sortedChannels = Object.entries(channels).sort((a, b) => b[1].revenue - a[1].revenue);
    p += `--- [ช่องทางการติดต่อรวมทุกประเภท] ---\n`;
    if (sortedChannels.length > 0) {
        sortedChannels.forEach(([chName, chVal]) => {
            p += `- ${chName}: P1=${num(chVal.p1)} บิล | P2=${num(chVal.p2)} นัด | UP P2=${num(chVal.upP2)} บิล | ยอดรวม=${f(chVal.revenue)}\n`;
        });
    } else {
        p += `- ไม่มีข้อมูล\n`;
    }
    p += `\n`;

    p += `กรุณาวิเคราะห์แนวโน้มภาพรวมสาขา และแนะนำแนวทางแก้ไขกรณีตัวเลขลดลง โดยเน้นเปรียบเทียบหมวดหมู่สินค้าและช่องทางการติดต่อครับ`;

    return p;
}

function openPromptModal(title, prompt, textColor, btnColor) {
    const _btnColor = btnColor || textColor;
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = `
        <textarea readonly onclick="this.select()" style="
            width: 100%;
            min-height: 420px;
            padding: 12px;
            background: #1a1a2e;
            color: ${textColor};
            border: 1px solid #333;
            border-radius: 6px;
            font-family: monospace;
            font-size: 0.85em;
            line-height: 1.6;
            resize: vertical;
            box-sizing: border-box;
        ">${prompt}</textarea>
        <div style="text-align:center; margin-top:10px;">
            <button onclick="
                const ta = this.closest('.modal-body, #detailsModal').querySelector('textarea');
                ta.select();
                document.execCommand('copy');
                this.textContent = '✅ Copied!';
                setTimeout(() => this.textContent = '📋 Copy to Clipboard', 1500);
            " style="
                padding: 8px 20px;
                background: ${_btnColor};
                color: #000;
                border: none;
                border-radius: 6px;
                font-weight: 700;
                cursor: pointer;
                font-size: 0.9em;
            ">📋 Copy to Clipboard</button>
            <p style="font-size:0.85em; color:#a0a0b0; margin-top:8px;">หรือคลิกที่ข้อความแล้ว Ctrl+A, Ctrl+C เพื่อนำไปวางใน Gemini</p>
        </div>
    `;
    ui.modal.classList.add('show');
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

        const adsRes = await fetchAdsData(ui.startDate.value, ui.endDate.value);
        if (adsRes.success) {
            latestCampaignData   = adsRes.data.campaigns;
            latestAdsTotals      = adsRes.totals;
            
            // ✅ เปลี่ยนบรรทัดนี้: เติมวันที่ให้ครบแม้ Spend จะเป็น 0
            latestDailySpendData = fillMissingDates(adsRes.data.dailySpend, ui.startDate.value, ui.endDate.value);
            
            renderFunnel(adsRes.totals);
            renderAdsStats(adsRes.totals);
            updateCampaignsTable();
            renderDailySpendChart(latestDailySpendData);
        } else {
            latestAdsTotals      = {};
            
            // ✅ เปลี่ยนบรรทัดนี้: กรณี API Error ก็ยังต้องแสดงกราฟวันที่เป็น 0 ให้กดดูยอดขายได้
            latestDailySpendData = fillMissingDates([], ui.startDate.value, ui.endDate.value);
            
            document.getElementById('adsStatsGrid').innerHTML = '<p style="color:var(--text-secondary);">Unable to load Ads data.</p>';
            renderDailySpendChart(latestDailySpendData); // ส่งข้อมูลที่เติมแล้วไปแสดงผล
        }

        renderSalesStats(salesRes);

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
    const today      = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    ui.endDate.value   = today.toISOString().split('T')[0];
    ui.startDate.value = startMonth.toISOString().split('T')[0];

    main();

    ui.refreshBtn.addEventListener('click', () => {
        allSalesDataCache = [];
        main();
    });

    ui.modalCloseBtn.addEventListener('click', () => ui.modal.classList.remove('show'));

    ui.adsAnalystBtn.addEventListener('click', () => {
        const prompt = generateAdsAnalystPrompt();
        openPromptModal('🤖 Prompt สรุป Ads Analyst', prompt, '#00f2fe');
    });

    ui.branchSummaryBtn.addEventListener('click', () => {
        const prompt = generateBranchSummaryPrompt();
        openPromptModal('📊 Prompt สรุปผลรวมสาขา', prompt, '#ffffff', '#f472b6');
    });

    if (ui.campaignsTableHeader) {
        ui.campaignsTableHeader.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.key) return;
            const key = th.dataset.key;
            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc';
            } else {
                currentSort.key       = key;
                currentSort.direction = 'desc';
            }
            updateCampaignsTable();
        });
    }

    document.getElementById('campaignSearchInput').addEventListener('input', () => {
        updateCampaignsTable();
    });

    if (ui.exportSheetBtn) {
        ui.exportSheetBtn.addEventListener('click', exportToGoogleSheet);
    }
});
