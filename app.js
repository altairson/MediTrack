if (!document.getElementById("medicineName")) {
    console.error("HTML not loaded correctly or wrong page opened");
}

// =========================
// DATABASE
// =========================

const STORAGE_KEY = "mediTrackDB";

let db = loadDatabase();

function loadDatabase() {

    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) return JSON.parse(saved);

    return {
        medicines: [],
        schedules: [],
        dailyLog: {},
        history: []
    };
}

function saveDatabase() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

// =========================
// HELPERS
// =========================

function generateId() {
    return Date.now() + Math.floor(Math.random() * 1000);
}

function todayKey() {
    return new Date().toISOString().split("T")[0];
}

// =========================
// TAB NAVIGATION
// =========================

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {

        document.querySelectorAll(".tab-btn")
            .forEach(x => x.classList.remove("active"));

        document.querySelectorAll(".tab")
            .forEach(x => x.classList.remove("active"));

        btn.classList.add("active");

        document.getElementById(btn.dataset.tab)
            .classList.add("active");
    });
});

// =========================
// MEDICINES
// =========================

const medicineName = document.getElementById("medicineName");
const medicineDose = document.getElementById("medicineDose");
const addMedicineBtn = document.getElementById("addMedicineBtn");
const medicineList = document.getElementById("medicineList");

addMedicineBtn.addEventListener("click", addMedicine);

function addMedicine() {

    const name = medicineName.value.trim();
    const dose = medicineDose.value.trim();

    if (!name || !dose) return alert("Fill all fields");

    db.medicines.push({
        id: generateId(),
        name,
        defaultDose: dose
    });

    saveDatabase();

    medicineName.value = "";
    medicineDose.value = "";

    renderMedicines();
    renderMedicineSelector();
}

function deleteMedicine(id) {

    db.medicines = db.medicines.filter(m => m.id !== id);

    saveDatabase();

    renderMedicines();
    renderMedicineSelector();
}

function renderMedicines() {

    medicineList.innerHTML = "";

    db.medicines.forEach(med => {

        const div = document.createElement("div");
        div.className = "list-item";

        div.innerHTML = `
            <div>
                <strong>${med.name}</strong><br>
                ${med.defaultDose}
            </div>
            <button class="delete-btn" onclick="deleteMedicine(${med.id})">
                Delete
            </button>
        `;

        medicineList.appendChild(div);
    });
}

// =========================
// MEDICINE SELECTOR
// =========================

const medicineCheckboxes = document.getElementById("medicineCheckboxes");

function renderMedicineSelector() {

    medicineCheckboxes.innerHTML = "";

    db.medicines.forEach(med => {

        const div = document.createElement("div");
        div.className = "medicine-option";

        div.innerHTML = `
            <label>
                <input type="checkbox" value="${med.id}">
                ${med.name}
            </label>

            <input class="dose-edit"
                type="text"
                value="${med.defaultDose}"
                data-dose="${med.id}">
        `;

        medicineCheckboxes.appendChild(div);
    });
}

// =========================
// SCHEDULES
// =========================

const scheduleTime = document.getElementById("scheduleTime");
const addScheduleBtn = document.getElementById("addScheduleBtn");
const scheduleList = document.getElementById("scheduleList");

addScheduleBtn.addEventListener("click", addSchedule);

function addSchedule() {

    const time = scheduleTime.value;

    if (!time) return alert("Select time");

    const meds = [];

    medicineCheckboxes.querySelectorAll("input[type=checkbox]")
        .forEach(cb => {

            if (!cb.checked) return;

            const doseInput =
                document.querySelector(`[data-dose="${cb.value}"]`);

            meds.push({
                medicineId: Number(cb.value),
                dose: doseInput.value
            });
        });

    if (meds.length === 0)
        return alert("Select at least one medicine");

    db.schedules.push({
        id: generateId(),
        time,
        medications: meds
    });

    db.schedules.sort((a, b) => a.time.localeCompare(b.time));

    saveDatabase();

    scheduleTime.value = "";

    renderSchedules();
    renderTodaySchedule();
}

// =========================
// RENDER SCHEDULE LIST (SETUP TAB)
// =========================

function renderSchedules() {

    scheduleList.innerHTML = "";

    db.schedules.forEach(s => {

        const div = document.createElement("div");
        div.className = "list-item";

        div.innerHTML = `
            <div>
                <strong>${s.time}</strong><br>
                ${s.medications.length} meds
            </div>

            <button class="delete-btn" onclick="deleteSchedule(${s.id})">
                Delete
            </button>
        `;

        scheduleList.appendChild(div);
    });
}

function deleteSchedule(id) {

    db.schedules = db.schedules.filter(x => x.id !== id);

    saveDatabase();

    renderSchedules();
    renderTodaySchedule();
}

// =========================
// DAILY LOG
// =========================

function getTodayLog() {

    const key = todayKey();

    if (!db.dailyLog[key]) {
        db.dailyLog[key] = {};
    }

    return db.dailyLog[key];
}

// =========================
// CHECK MEDS
// =========================

function areAllMedsChecked(scheduleId) {

    const schedule = db.schedules.find(x => x.id === scheduleId);

    const log = getTodayLog()[scheduleId];

    if (!schedule || !log?.meds) return false;

    return schedule.medications.every(
        m => log.meds[m.medicineId]
    );
}

// =========================
// TOGGLE MED
// =========================

function toggleMedCheck(scheduleId, medId) {

    const log = getTodayLog();

    if (!log[scheduleId]) {
        log[scheduleId] = { completed: false, meds: {} };
    }

    const current = log[scheduleId].meds?.[medId] || false;

    log[scheduleId].meds[medId] = !current;

    saveDatabase();

    updateCompleteButton(scheduleId);
}

// =========================
// UPDATE BUTTON STATE
// =========================

function updateCompleteButton(scheduleId) {

    const btn = document.getElementById(`complete-btn-${scheduleId}`);

    if (!btn) return;

    btn.disabled = !areAllMedsChecked(scheduleId);
}

// =========================
// COMPLETE SCHEDULE
// =========================

function completeSchedule(id) {

    if (!areAllMedsChecked(id)) {
        alert("Check all medications first");
        return;
    }

    const log = getTodayLog();

    log[id] = {
        completed: true,
        completedAt: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        })
    };

    addHistoryEntry(id);

    saveDatabase();

    renderTodaySchedule();
    renderHistory();
    drawClock();
}

// =========================
// HISTORY
// =========================

function addHistoryEntry(scheduleId) {

    const schedule = db.schedules.find(x => x.id === scheduleId);

    const log = getTodayLog()[scheduleId];

    if (!schedule || !log) return;

    schedule.medications.forEach(m => {

        const med = db.medicines.find(x => x.id === m.medicineId);

        const taken = log.meds?.[m.medicineId] === true;

        db.history.push({
            date: todayKey(),
            time: schedule.time,
            medicine: med?.name || "Unknown",
            dose: m.dose,
            status: taken ? "Taken" : "Missed"
        });
    });
}

function renderHistory() {

    const tbody = document.querySelector("#historyTable tbody");

    tbody.innerHTML = "";

    [...db.history].reverse().forEach(h => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${h.date}</td>
            <td>${h.time}</td>
            <td>${h.medicine}</td>
            <td>${h.dose}</td>
            <td class="${h.status === "Taken" ? "status-done" : "status-missed"}">
                ${h.status}
            </td>
        `;

        tbody.appendChild(tr);
    });
}

// =========================
// TODAY VIEW
// =========================

const todaySchedule = document.getElementById("todaySchedule");

function renderTodaySchedule() {

    const log = getTodayLog();

    todaySchedule.innerHTML = "";

    const currentIndex = getCurrentScheduleIndex();

    db.schedules.forEach((s, i) => {

        const completed = log[s.id]?.completed;

        let state = "schedule-upcoming";

        if (completed) state = "schedule-completed";
        else if (i === currentIndex) state = "schedule-current";

        const div = document.createElement("div");

        div.className = `schedule-card ${state}`;

        div.innerHTML = `
            <div class="schedule-header"
                onclick="toggleSchedule(${s.id})">
                <span>${s.time}</span>
                <span>${completed ? "✅" : "▼"}</span>
            </div>

            <div id="body-${s.id}" class="schedule-body ${i === currentIndex ? "open" : ""}">
                ${buildMedicationList(s, completed)}
            </div>
        `;

        todaySchedule.appendChild(div);
    });
}

// =========================
// MED LIST UI
// =========================

function buildMedicationList(schedule, completed) {

    const log = getTodayLog()[schedule.id] || { meds: {} };

    let html = "";

    schedule.medications.forEach(m => {

        const med = db.medicines.find(x => x.id === m.medicineId);

        const checked = log.meds?.[m.medicineId];

        html += `
            <div class="med-item">
                <div class="med-info">
                    <div class="med-name">${med?.name || "Unknown"}</div>
                    <div class="med-dose">${m.dose}</div>
                </div>

                <input type="checkbox"
                    class="med-check"
                    ${checked ? "checked" : ""}
                    ${completed ? "disabled" : ""}
                    onchange="toggleMedCheck(${schedule.id}, ${m.medicineId})">
            </div>
        `;
    });

    html += `
        <button id="complete-btn-${schedule.id}"
            onclick="completeSchedule(${schedule.id})"
            ${areAllMedsChecked(schedule.id) ? "" : "disabled"}>
            Mark Completed
        </button>
    `;

    return html;
}

// =========================
// COLLAPSE
// =========================

function toggleSchedule(id) {

    const el = document.getElementById(`body-${id}`);

    if (el) el.classList.toggle("open");
}

// =========================
// CLOCK
// =========================

const canvas = document.getElementById("medClock");
const ctx = canvas.getContext("2d");

function resizeCanvas() {

    const size = canvas.parentElement.offsetWidth;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawClock();
}

function timeToClockAngle(hours, minutes) {
    const clockMinutes = (hours % 12) * 60 + minutes;

    return (clockMinutes / 720) * Math.PI * 2 - Math.PI / 2;
}

function drawClock() {

    const log = getTodayLog();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const cx = w / 2;
    const cy = h / 2;

    const radius = Math.min(w, h) / 2 - 24;
    const tickOuterRadius = radius - 6;
    const labelRadius = radius - 34;
    const markerRadius = radius - 62;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 14px Segoe UI, sans-serif";
    ctx.fillStyle = "#475569";

    for (let hour = 1; hour <= 12; hour++) {
        const a = timeToClockAngle(hour, 0);
        const isQuarter = hour % 3 === 0;
        const tickInnerRadius = radius - (isQuarter ? 20 : 14);

        ctx.beginPath();
        ctx.moveTo(
            cx + Math.cos(a) * tickInnerRadius,
            cy + Math.sin(a) * tickInnerRadius
        );
        ctx.lineTo(
            cx + Math.cos(a) * tickOuterRadius,
            cy + Math.sin(a) * tickOuterRadius
        );
        ctx.strokeStyle = isQuarter ? "#64748b" : "#cbd5e1";
        ctx.lineWidth = isQuarter ? 3 : 2;
        ctx.stroke();

        ctx.fillText(
            hour,
            cx + Math.cos(a) * labelRadius,
            cy + Math.sin(a) * labelRadius
        );
    }

    const now = new Date();
    const angle = timeToClockAngle(now.getHours(), now.getMinutes());

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
        cx + Math.cos(angle) * (markerRadius - 16),
        cy + Math.sin(angle) * (markerRadius - 16)
    );
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb";
    ctx.fill();

    db.schedules.forEach((s, i) => {

        const [h, m] = s.time.split(":").map(Number);
        const a = timeToClockAngle(h, m);

        const x = cx + Math.cos(a) * markerRadius;
        const y = cy + Math.sin(a) * markerRadius;

        let color = "#94a3b8";

        if (log[s.id]?.completed) color = "#22c55e";
        else if (i === getCurrentScheduleIndex()) color = "#2563eb";

        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();
    });
}

// =========================
// CURRENT INDEX
// =========================

function getCurrentScheduleIndex() {

    const log = getTodayLog();

    for (let i = 0; i < db.schedules.length; i++) {
        if (!log[db.schedules[i].id]?.completed) return i;
    }

    return -1;
}

// =========================
// CLEANUP OLD DAYS
// =========================

function cleanupOldLogs() {

    const today = todayKey();

    Object.keys(db.dailyLog).forEach(k => {
        if (k !== today) delete db.dailyLog[k];
    });

    saveDatabase();
}

// =========================
// INIT
// =========================

function init() {

    cleanupOldLogs();

    renderMedicines();
    renderMedicineSelector();
    renderSchedules();
    renderTodaySchedule();
    renderHistory();

    resizeCanvas();
    drawClock();
    window.addEventListener("resize", resizeCanvas);
    setInterval(drawClock, 60000);
}

init();