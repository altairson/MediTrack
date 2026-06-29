if (!document.getElementById("medicineName")) {
    console.error("HTML not loaded correctly or wrong page opened");
}

// =========================
// DATABASE
// =========================

const STORAGE_KEY = "mediTrackDB";

let db = loadDatabase();
migrateStockFromHistory();

function loadDatabase() {

    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) return JSON.parse(saved);

    return {
        medicines: [],
        schedules: [],
        dailyLog: {},
        history: [],
        emergencySituations: []
    };
}

function saveDatabase() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function migrateStockFromHistory() {
    if (!db.stockMigratedFromHistory) {
        db.medicines.forEach(med => {
            if (med.currentStock !== null && med.currentStock !== undefined) {
                const medLogs = db.history.filter(h => h.medicine === med.name && h.status === "Taken");
                let totalSpent = 0;
                medLogs.forEach(h => {
                    totalSpent += parseAmountAndUnit(h.dose).amount;
                });
                med.currentStock = formatFloat(Math.max(0, med.currentStock - totalSpent));
            }
        });
        db.stockMigratedFromHistory = true;
        saveDatabase();
    }
    // Backfill emergencySituations if missing (for existing users)
    if (!db.emergencySituations) {
        db.emergencySituations = [];
        saveDatabase();
    }
}

// =========================
// HELPERS
// =========================

function formatLocalDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function generateId() {
    return Date.now() + Math.floor(Math.random() * 1000);
}

function todayKey() {
    return formatLocalDate(new Date());
}

function formatFloat(val) {
    if (val === undefined || val === null || isNaN(val)) return "";
    return parseFloat(Number(val).toFixed(4));
}

function formatDoseHistoryDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDate();
    const month = d.toLocaleDateString(undefined, { month: "short" });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
}

function parseAmountAndUnit(str) {
    if (!str) return { amount: 0, unit: "" };
    const match = str.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
    if (match) {
        return {
            amount: parseFloat(match[1]),
            unit: match[2].trim()
        };
    }
    return { amount: 0, unit: "" };
}

function estimateRunOutDateTime(medId, currentStock) {
    if (currentStock <= 0) return "Empty/Out of Stock";

    const medSchedules = [];
    db.schedules.forEach(s => {
        const medInSched = s.medications.find(m => m.medicineId === medId);
        if (medInSched) {
            const doseAmount = parseAmountAndUnit(medInSched.dose).amount;
            if (doseAmount > 0) {
                medSchedules.push({
                    scheduleId: s.id,
                    time: s.time,
                    dose: doseAmount
                });
            }
        }
    });

    if (medSchedules.length === 0) return "Never (not scheduled)";

    medSchedules.sort((a, b) => a.time.localeCompare(b.time));

    let stock = currentStock;
    let currentSimTime = new Date();

    let steps = 0;
    const maxSteps = 10000;

    while (stock > 0 && steps < maxSteps) {
        steps++;
        let foundNext = false;
        const simDateStr = formatLocalDate(currentSimTime);
        const dailyCompletedLog = db.dailyLog[simDateStr] || {};

        for (let i = 0; i < medSchedules.length; i++) {
            const sched = medSchedules[i];
            const [sh, sm] = sched.time.split(":").map(Number);
            const schedDateTime = new Date(currentSimTime);
            schedDateTime.setHours(sh, sm, 0, 0);

            if (schedDateTime > currentSimTime) {
                if (steps === 1) {
                    const isCompleted = dailyCompletedLog[sched.scheduleId]?.completed === true;
                    if (isCompleted) {
                        continue;
                    }
                }

                stock -= sched.dose;
                currentSimTime = schedDateTime;
                foundNext = true;

                if (stock <= 0) {
                    break;
                }
            }
        }

        if (!foundNext && stock > 0) {
            currentSimTime.setDate(currentSimTime.getDate() + 1);
            currentSimTime.setHours(0, 0, 0, 0);
        }
    }

    if (stock > 0) {
        return "More than a year";
    }

    const dayNum = currentSimTime.getDate();
    const monthLong = currentSimTime.toLocaleDateString(undefined, { month: "short" });
    const yearNum = currentSimTime.getFullYear();
    const timeStr = currentSimTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `${dayNum} ${monthLong} ${yearNum} at ${timeStr}`;
}

function refillStock(medId) {
    const input = document.getElementById(`refill-${medId}`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return alert("Enter amount to refill");

    const parsed = parseAmountAndUnit(val);
    if (parsed.amount <= 0) return alert("Please enter a valid numeric amount to refill");

    const med = db.medicines.find(m => m.id === medId);
    if (med) {
        med.currentStock = parsed.amount;
        med.initialStock = val;
        med.unit = parsed.unit || med.unit || "units";

        saveDatabase();
        renderMedicines();
        renderTodaySchedule();
        renderAnalytics();
        input.value = "";
        toggleRefillForm(medId);
    }
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

function switchSetupSubTab(tabName) {
    const medTab = document.getElementById("setupMedicinesTab");
    const schedTab = document.getElementById("setupSchedulesTab");
    const emergTab = document.getElementById("setupEmergencyTab");
    const btnMed = document.getElementById("btn-setup-medicines");
    const btnSched = document.getElementById("btn-setup-schedules");
    const btnEmerg = document.getElementById("btn-setup-emergency");

    [medTab, schedTab, emergTab].forEach(t => { if (t) t.style.display = "none"; });
    [btnMed, btnSched, btnEmerg].forEach(b => { if (b) b.classList.remove("active"); });

    if (tabName === "medicines") {
        if (medTab) medTab.style.display = "block";
        if (btnMed) btnMed.classList.add("active");
    } else if (tabName === "schedules") {
        if (schedTab) schedTab.style.display = "block";
        if (btnSched) btnSched.classList.add("active");
    } else if (tabName === "emergency") {
        if (emergTab) emergTab.style.display = "block";
        if (btnEmerg) btnEmerg.classList.add("active");
        renderEmergencySituations();
    }
}

window.switchSetupSubTab = switchSetupSubTab;

function toggleAddForm(formId, buttonId) {
    const form = document.getElementById(formId);
    const btn = document.getElementById(buttonId);
    if (!form || !btn) return;

    const isOpen = form.classList.contains("open");
    if (isOpen) {
        closeForm(formId, buttonId);
    } else {
        form.classList.add("open");
        btn.classList.add("open");
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Close';
    }
}

function closeForm(formId, buttonId) {
    const form = document.getElementById(formId);
    const btn = document.getElementById(buttonId);
    if (form) form.classList.remove("open");
    if (btn) {
        btn.classList.remove("open");
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
    }
}

window.toggleAddForm = toggleAddForm;

function toggleRefillForm(medId) {
    const form = document.getElementById(`refill-form-${medId}`);
    const btn = document.getElementById(`refill-btn-${medId}`);
    if (!form || !btn) return;

    const isHidden = form.style.display === "none" || !form.style.display;
    if (isHidden) {
        form.style.display = "flex";
        btn.style.display = "none";
    } else {
        form.style.display = "none";
        btn.style.display = "inline-block";
    }
}

window.toggleRefillForm = toggleRefillForm;

// =========================
// MEDICINES
// =========================

const medicineName = document.getElementById("medicineName");
const medicineDose = document.getElementById("medicineDose");
const addMedicineBtn = document.getElementById("addMedicineBtn");
const medicineList = document.getElementById("medicineList");

addMedicineBtn.addEventListener("click", addMedicine);

const medicineConcentration = document.getElementById("medicineConcentration");
const medicineTargetMg = document.getElementById("medicineTargetMg");

function calculateAddMl() {
    const conc = parseFloat(medicineConcentration.value);
    const mg = parseFloat(medicineTargetMg.value);
    if (conc > 0 && mg > 0) {
        medicineDose.value = formatFloat(mg / conc) + " ml";
    }
}

if (medicineConcentration && medicineTargetMg) {
    medicineConcentration.addEventListener("input", calculateAddMl);
    medicineTargetMg.addEventListener("input", calculateAddMl);
}

function calculateEditMl(medId) {
    const concInput = document.getElementById(`edit-med-concentration-${medId}`);
    const mgInput = document.getElementById(`edit-med-target-mg-${medId}`);
    const doseInput = document.getElementById(`edit-med-dose-${medId}`);
    if (!concInput || !mgInput || !doseInput) return;

    const conc = parseFloat(concInput.value);
    const mg = parseFloat(mgInput.value);
    if (conc > 0 && mg > 0) {
        doseInput.value = formatFloat(mg / conc) + " ml";
    }
}

window.calculateEditMl = calculateEditMl;

function addMedicine() {

    const name = medicineName.value.trim();
    const dose = medicineDose.value.trim();
    const stockInput = document.getElementById("medicineStock");
    const stockVal = stockInput ? stockInput.value.trim() : "";

    const ingredientInput = document.getElementById("medicineIngredient");
    const concentrationInput = document.getElementById("medicineConcentration");
    const targetMgInput = document.getElementById("medicineTargetMg");

    const ingredient = ingredientInput ? ingredientInput.value.trim() : "";
    const concentration = (concentrationInput && concentrationInput.value) ? parseFloat(concentrationInput.value) : null;
    const targetMg = (targetMgInput && targetMgInput.value) ? parseFloat(targetMgInput.value) : null;

    if (!name || !dose) return alert("Fill all fields");

    let currentStock = null;
    let initialStock = null;
    let unit = "";

    if (stockVal) {
        const parsedStock = parseAmountAndUnit(stockVal);
        initialStock = stockVal;
        currentStock = parsedStock.amount;
        unit = parsedStock.unit;
    } else {
        const parsedDose = parseAmountAndUnit(dose);
        unit = parsedDose.unit;
    }

    const isEmergencyInput = document.getElementById("medicineIsEmergency");
    const isEmergency = isEmergencyInput ? isEmergencyInput.checked : false;

    db.medicines.push({
        id: generateId(),
        name,
        ingredient,
        concentration,
        targetMg,
        defaultDose: dose,
        initialStock: initialStock,
        currentStock: currentStock,
        unit: unit,
        isEmergency: isEmergency
    });

    saveDatabase();

    medicineName.value = "";
    medicineDose.value = "";
    if (stockInput) stockInput.value = "";
    if (ingredientInput) ingredientInput.value = "";
    if (concentrationInput) concentrationInput.value = "";
    if (targetMgInput) targetMgInput.value = "";

    if (isEmergencyInput) isEmergencyInput.checked = false;

    renderMedicines();
    renderMedicineSelector();
    renderHistory();
    renderEmergencyButton();
    closeForm("addMedicineForm", "btn-toggle-med-form");
}

function deleteMedicine(id) {

    db.medicines = db.medicines.filter(m => m.id !== id);

    saveDatabase();

    renderMedicines();
    renderMedicineSelector();
    renderHistory();
}

let editingMedicineId = null;

function startEditMedicine(id) {
    editingMedicineId = id;
    renderMedicines();
}

function cancelEditMedicine() {
    editingMedicineId = null;
    renderMedicines();
}

function saveEditMedicine(id) {
    const nameInput = document.getElementById(`edit-med-name-${id}`);
    const doseInput = document.getElementById(`edit-med-dose-${id}`);
    const stockInput = document.getElementById(`edit-med-stock-${id}`);
    const ingredientInput = document.getElementById(`edit-med-ingredient-${id}`);
    const concentrationInput = document.getElementById(`edit-med-concentration-${id}`);
    const targetMgInput = document.getElementById(`edit-med-target-mg-${id}`);

    if (!nameInput || !doseInput) return;

    const newName = nameInput.value.trim();
    const newDose = doseInput.value.trim();
    const newStockStr = stockInput ? stockInput.value.trim() : "";
    const newIngredient = ingredientInput ? ingredientInput.value.trim() : "";
    const newConcentration = (concentrationInput && concentrationInput.value) ? parseFloat(concentrationInput.value) : null;
    const newTargetMg = (targetMgInput && targetMgInput.value) ? parseFloat(targetMgInput.value) : null;

    if (!newName || !newDose) return alert("Name and dose cannot be empty");

    const med = db.medicines.find(m => m.id === id);
    if (med) {
        const oldName = med.name;
        db.history.forEach(h => {
            if (h.medicine === oldName) {
                h.medicine = newName;
            }
        });

        med.name = newName;
        med.defaultDose = newDose;
        med.ingredient = newIngredient;
        med.concentration = newConcentration;
        med.targetMg = newTargetMg;
        const emergencyEditInput = document.getElementById(`edit-med-emergency-${id}`);
        if (emergencyEditInput !== null) med.isEmergency = emergencyEditInput.checked;

        if (newStockStr) {
            const parsedStock = parseAmountAndUnit(newStockStr);
            const isFirstTimeStock = (med.currentStock === null || med.currentStock === undefined);
            med.initialStock = newStockStr;
            med.unit = parsedStock.unit;
            if (isFirstTimeStock) {
                const medLogs = db.history.filter(h => h.medicine === med.name && h.status === "Taken");
                let totalSpent = 0;
                medLogs.forEach(h => {
                    totalSpent += parseAmountAndUnit(h.dose).amount;
                });
                med.currentStock = formatFloat(Math.max(0, parsedStock.amount - totalSpent));
            } else {
                med.currentStock = parsedStock.amount;
            }
        } else {
            med.initialStock = null;
            med.currentStock = null;
            med.unit = parseAmountAndUnit(newDose).unit || "";
        }

        saveDatabase();
        editingMedicineId = null;

        renderMedicines();
        renderMedicineSelector();
        renderTodaySchedule();
        renderHistory();
        renderEmergencyButton();
    }
}

window.startEditMedicine = startEditMedicine;
window.cancelEditMedicine = cancelEditMedicine;
window.saveEditMedicine = saveEditMedicine;

function renderMedicines() {

    medicineList.innerHTML = "";

    db.medicines.forEach(med => {

        const div = document.createElement("div");
        div.className = "list-item";
        div.style.flexDirection = "column";
        div.style.alignItems = "stretch";

        if (med.id === editingMedicineId) {
            const stockVal = (med.currentStock !== null && med.currentStock !== undefined) ? `${med.currentStock} ${med.unit}` : '';
            div.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 0.8rem; font-weight: bold; color: #475569;"><i class="fa-solid fa-pen-to-square"></i> Editing Medicine</div>
                    
                    <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: -6px; display: block;">Medicine Name</label>
                    <input type="text" id="edit-med-name-${med.id}" value="${med.name}" placeholder="Medicine name" style="margin-bottom: 0; padding: 8px 12px;">
                    
                    <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: -6px; display: block;">Target Ingredient</label>
                    <input type="text" id="edit-med-ingredient-${med.id}" value="${med.ingredient || ''}" placeholder="Ingredient (e.g. Nitrazepam) (Optional)" style="margin-bottom: 0; padding: 8px 12px;">
                    
                    <div style="display: flex; gap: 8px; margin-bottom: 0;">
                        <div style="flex: 1;">
                            <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: 2px; display: block;">Conc. (mg/ml)</label>
                            <input type="number" id="edit-med-concentration-${med.id}" value="${med.concentration || ''}" placeholder="e.g. 10" step="any" oninput="calculateEditMl(${med.id})" style="margin-bottom: 0; padding: 8px 12px; width: 100%;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: 2px; display: block;">Target mg</label>
                            <input type="number" id="edit-med-target-mg-${med.id}" value="${med.targetMg || ''}" placeholder="e.g. 2" step="any" oninput="calculateEditMl(${med.id})" style="margin-bottom: 0; padding: 8px 12px; width: 100%;">
                        </div>
                    </div>
                    
                    <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: -6px; display: block;">Default Dose (e.g. 2ml)</label>
                    <input type="text" id="edit-med-dose-${med.id}" value="${med.defaultDose}" placeholder="Default dose" style="margin-bottom: 0; padding: 8px 12px;">
                    
                    <label style="font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: -6px; display: block;">Stock (e.g. 50ml)</label>
                    <input type="text" id="edit-med-stock-${med.id}" value="${stockVal}" placeholder="Stock (Optional)" style="margin-bottom: 0; padding: 8px 12px;">
                    
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; padding: 6px 0;">
                        <input type="checkbox" id="edit-med-emergency-${med.id}" ${med.isEmergency ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #dc2626;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Emergency Medicine (only assignable to emergency situations)
                    </label>
                    
                    <div class="item-actions" style="margin-top: 4px;">
                        <button class="save-btn" onclick="saveEditMedicine(${med.id})"><i class="fa-solid fa-floppy-disk"></i> Save</button>
                        <button class="cancel-btn" onclick="cancelEditMedicine()"><i class="fa-solid fa-xmark"></i> Cancel</button>
                    </div>
                </div>
            `;
        } else {
            const isTracked = med.currentStock !== undefined && med.currentStock !== null;
            const refillBtnText = isTracked ? "Refill Stock" : "Track Stock";
            const refillIcon = isTracked ? "fa-prescription-bottle-medical" : "fa-circle-plus";

            let stockInfoHtml = "";
            if (isTracked) {
                const estimate = estimateRunOutDateTime(med.id, med.currentStock);
                stockInfoHtml = `
                    <div class="med-stock-info" style="font-size: 0.85rem; margin-top: 6px; color: #4b5563; border-top: 1px solid #e2e8f0; padding-top: 6px;">
                        <i class="fa-solid fa-boxes-stacked"></i> Stock: <strong>${med.currentStock} ${med.unit}</strong> / ${med.initialStock}<br>
                        <span style="color: #059669; font-weight: 500;"><i class="fa-solid fa-hourglass-half"></i> Lasts until: ${estimate}</span>
                    </div>
                `;
            } else {
                stockInfoHtml = `
                    <div class="med-stock-info" style="font-size: 0.85rem; margin-top: 6px; color: #94a3b8; font-style: italic; border-top: 1px solid #e2e8f0; padding-top: 6px;">
                        <i class="fa-solid fa-circle-info"></i> Stock tracking not enabled.
                    </div>
                `;
            }

            let detailsHtml = "";
            if (med.ingredient) {
                const concInfo = med.concentration ? `, Conc: ${med.concentration} mg/ml` : "";
                const targetMgInfo = med.targetMg ? `, Target: ${med.targetMg} mg` : "";
                detailsHtml = `
                    <div style="font-size: 0.82rem; color: #64748b; margin-top: 2px;">
                        <i class="fa-solid fa-flask" style="color: var(--primary); margin-right: 4px;"></i> Ingredient: <strong>${med.ingredient}</strong>${concInfo}${targetMgInfo}
                    </div>
                `;
            }

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <strong style="font-size: 1.05rem;"><i class="fa-solid fa-pills" style="color: var(--primary); margin-right: 4px;"></i> ${med.name}</strong>
                        ${med.isEmergency ? '<span style="display: inline-block; margin-left: 6px; font-size: 0.72rem; font-weight: 700; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 20px; padding: 2px 8px; vertical-align: middle;"><i class="fa-solid fa-triangle-exclamation"></i> EMERGENCY</span>' : ''}<br>
                        <span style="font-size: 0.85rem; color: #6b7280;"><i class="fa-solid fa-prescription"></i> Dose: ${med.defaultDose}</span>
                        ${detailsHtml}
                    </div>
                    <div class="item-actions">
                        <button class="edit-btn" onclick="startEditMedicine(${med.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                        <button class="delete-btn" onclick="deleteMedicine(${med.id})"><i class="fa-solid fa-trash"></i> Delete</button>
                    </div>
                </div>
                ${stockInfoHtml}
                <div style="margin-top: 8px;">
                    <button id="refill-btn-${med.id}" style="width: auto; padding: 6px 12px; font-size: 0.8rem; background: #059669; border-radius: 6px;" onclick="toggleRefillForm(${med.id})">
                        <i class="fa-solid ${refillIcon}"></i> ${refillBtnText}
                    </button>
                    <div id="refill-form-${med.id}" style="display: none; gap: 6px; align-items: center; margin-top: 6px;">
                        <input type="text" id="refill-${med.id}" placeholder="Amount (e.g. 50ml)" style="margin-bottom: 0; padding: 6px 10px; font-size: 0.85rem; flex: 1; border-radius: 6px;">
                        <button style="width: auto; padding: 6px 12px; font-size: 0.85rem; background: #059669; border-radius: 6px;" onclick="refillStock(${med.id})"><i class="fa-solid fa-floppy-disk"></i> Save</button>
                        <button style="width: auto; padding: 6px 12px; font-size: 0.85rem; background: #64748b; border-radius: 6px;" onclick="toggleRefillForm(${med.id})"><i class="fa-solid fa-xmark"></i> Cancel</button>
                    </div>
                </div>
            `;
        }

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
        if (med.isEmergency) return;

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

let editingScheduleId = null;

function startEditSchedule(id) {
    editingScheduleId = id;
    const s = db.schedules.find(x => x.id === id);
    if (!s) return;

    const form = document.getElementById("addScheduleForm");
    const btn = document.getElementById("btn-toggle-sched-form");
    if (form && !form.classList.contains("open")) {
        form.classList.add("open");
        if (btn) {
            btn.classList.add("open");
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Close';
        }
    }

    scheduleTime.value = s.time;

    renderMedicineSelector();

    s.medications.forEach(m => {
        const cb = medicineCheckboxes.querySelector(`input[type="checkbox"][value="${m.medicineId}"]`);
        const doseInput = medicineCheckboxes.querySelector(`[data-dose="${m.medicineId}"]`);
        if (cb) cb.checked = true;
        if (doseInput) doseInput.value = m.dose;
    });

    document.getElementById("schedule-form-title").textContent = "Edit Time Schedule";
    document.getElementById("addScheduleBtn").textContent = "Save Changes";
    document.getElementById("cancelScheduleEditBtn").style.display = "block";
}

function cancelScheduleEdit() {
    editingScheduleId = null;

    scheduleTime.value = "";
    renderMedicineSelector();

    document.getElementById("schedule-form-title").textContent = "Add Time Schedule";
    document.getElementById("addScheduleBtn").textContent = "Add Schedule";
    document.getElementById("cancelScheduleEditBtn").style.display = "none";

    closeForm("addScheduleForm", "btn-toggle-sched-form");
}

window.startEditSchedule = startEditSchedule;
window.cancelScheduleEdit = cancelScheduleEdit;

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

    if (editingScheduleId !== null) {
        const existing = db.schedules.find(x => x.id === editingScheduleId);
        if (existing) {
            existing.time = time;
            existing.medications = meds;
        }
        editingScheduleId = null;

        document.getElementById("schedule-form-title").textContent = "Add Time Schedule";
        document.getElementById("addScheduleBtn").textContent = "Add Schedule";
        document.getElementById("cancelScheduleEditBtn").style.display = "none";
    } else {
        db.schedules.push({
            id: generateId(),
            time,
            medications: meds
        });
    }

    db.schedules.sort((a, b) => a.time.localeCompare(b.time));

    saveDatabase();

    scheduleTime.value = "";
    renderMedicineSelector();

    renderSchedules();
    renderTodaySchedule();
    renderHistory();

    closeForm("addScheduleForm", "btn-toggle-sched-form");
}

function renderSchedules() {

    scheduleList.innerHTML = "";

    db.schedules.forEach(s => {

        const div = document.createElement("div");
        div.className = "list-item";
        div.style.flexDirection = "column";
        div.style.alignItems = "stretch";
        div.style.cursor = "pointer";

        let medsListHtml = "";
        s.medications.forEach(m => {
            const med = db.medicines.find(x => x.id === m.medicineId);
            medsListHtml += `
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 4px 0; border-bottom: 1px solid #f1f5f9;">
                    <span><i class="fa-solid fa-pills" style="color: var(--primary); margin-right: 6px;"></i> ${med?.name || "Unknown"}</span>
                    <span style="color: var(--text-secondary); font-weight: 500;">${m.dose}</span>
                </div>
            `;
        });

        div.innerHTML = `
            <div onclick="toggleSetupSchedule(${s.id})" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div>
                    <strong style="font-size: 1.05rem;"><i class="fa-solid fa-clock" style="color: var(--primary); margin-right: 4px;"></i> ${s.time}</strong><br>
                    <span style="font-size: 0.85rem; color: #6b7280;"><i class="fa-solid fa-chevron-down"></i> ${s.medications.length} meds</span>
                </div>

                <div class="item-actions" onclick="event.stopPropagation()">
                    <button class="edit-btn" onclick="startEditSchedule(${s.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                    <button class="delete-btn" onclick="deleteSchedule(${s.id})"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </div>
            
            <div id="setup-sched-body-${s.id}" style="display: none; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
                ${medsListHtml}
            </div>
        `;

        scheduleList.appendChild(div);
    });
}

function toggleSetupSchedule(id) {
    const body = document.getElementById(`setup-sched-body-${id}`);
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
}

window.toggleSetupSchedule = toggleSetupSchedule;

function deleteSchedule(id) {

    if (id === editingScheduleId) {
        cancelScheduleEdit();
    }

    db.schedules = db.schedules.filter(x => x.id !== id);

    saveDatabase();

    renderSchedules();
    renderTodaySchedule();
    renderHistory();
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

    if (!schedule) return false;
    if (!log) return false;

    return schedule.medications.every(m => {
        const completed = log.completed === true;
        if (log.meds && log.meds[m.medicineId] !== undefined) {
            return log.meds[m.medicineId] === true;
        }
        return completed ? true : false;
    });
}

// =========================
// TOGGLE MED
// =========================

function toggleMedCheck(scheduleId, medId) {

    const log = getTodayLog();

    if (!log[scheduleId]) {
        log[scheduleId] = { completed: false, meds: {} };
    }
    if (!log[scheduleId].meds) {
        log[scheduleId].meds = {};
    }

    const completed = log[scheduleId].completed === true;
    let current = log[scheduleId].meds[medId];
    if (current === undefined) {
        current = completed ? true : false;
    }

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

    const log = getTodayLog();
    const completed = log[scheduleId]?.completed === true;

    if (completed) {
        btn.disabled = false;
    } else {
        btn.disabled = !areAllMedsChecked(scheduleId);
    }
}

// =========================
// COMPLETE SCHEDULE
// =========================

function completeSchedule(id) {

    const log = getTodayLog();
    const isEditing = log[id]?.completed === true;

    if (!isEditing && !areAllMedsChecked(id)) {
        alert("Check all medications first");
        return;
    }

    const schedule = db.schedules.find(x => x.id === id);
    if (schedule) {
        log[id] = log[id] || { completed: false, meds: {} };
        const prevMeds = { ...log[id].meds };

        schedule.medications.forEach(m => {
            const med = db.medicines.find(x => x.id === m.medicineId);
            if (med && med.currentStock !== undefined && med.currentStock !== null) {
                const doseAmt = parseAmountAndUnit(m.dose).amount;
                const wasTakenAndSaved = isEditing && (prevMeds[m.medicineId] === true);
                const isTaken = log[id].meds?.[m.medicineId] === true;

                if (isTaken && !wasTakenAndSaved) {
                    med.currentStock = formatFloat(Math.max(0, med.currentStock - doseAmt));
                } else if (!isTaken && wasTakenAndSaved) {
                    med.currentStock = formatFloat(med.currentStock + doseAmt);
                }
            }
        });

        // Delete existing history logs for this date and time
        db.history = db.history.filter(h => !(h.date === todayKey() && h.time === schedule.time));
    }

    addHistoryEntry(id);

    log[id] = log[id] || {};
    log[id].completed = true;
    log[id].completedAt = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    saveDatabase();

    renderTodaySchedule();
    renderHistory();
    renderMedicines();
    renderAnalytics();
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

    const container = document.getElementById("historyContainer");

    if (!container) return;

    const activeHistory = db.history.filter(h => h.status !== "Missed" && h.status !== "Emergency (Not Given)");

    if (activeHistory.length === 0) {
        container.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon"><i class="fa-solid fa-notes-medical" style="color: #cbd5e1;"></i></div>
                <p>No medication history yet.</p>
                <small>Complete a schedule to see your log here.</small>
            </div>
        `;
        return;
    }

    // Collect and sort unique dates descending
    const grouped = {};
    activeHistory.forEach(h => {
        if (!grouped[h.date]) grouped[h.date] = [];
        grouped[h.date].push(h);
    });

    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    let html = "";
    let lastMonthKey = null;

    sortedDates.forEach(date => {

        const entries = grouped[date];
        const d = new Date(date + "T00:00:00");
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        const monthLabel = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

        // Month separator between months
        if (monthKey !== lastMonthKey) {
            if (lastMonthKey !== null) html += `</div>`; // close prev month block
            html += `
                <div class="history-month-block">
                <div class="history-month-separator">
                    <span class="history-month-label">${monthLabel}</span>
                </div>
            `;
            lastMonthKey = monthKey;
        }

        const takenCount = entries.filter(e => e.status === "Taken").length;
        const total = entries.length;
        const dayNum = d.getDate();
        const monthLong = d.toLocaleDateString(undefined, { month: "long" });
        const yearNum = d.getFullYear();
        const weekdayLong = d.toLocaleDateString(undefined, { weekday: "long" });
        const dateLabel = `${dayNum} ${monthLong} ${yearNum}, ${weekdayLong}`;
        const dayId = `hday-${date.replace(/-/g, "")}`;

        // Build the time-grouped body
        const byTime = {};
        entries.forEach(e => {
            if (!byTime[e.time]) byTime[e.time] = [];
            byTime[e.time].push(e);
        });
        const sortedTimes = Object.keys(byTime).sort();

        let bodyHtml = "";
        sortedTimes.forEach(time => {
            bodyHtml += `<div class="history-slot"><span class="history-time"><i class="fa-solid fa-clock" style="margin-right: 4px; color: var(--primary);"></i> ${time}</span>`;
            byTime[time].forEach(m => {
                const isTaken = m.status === "Taken";
                const isEmergency = m.status === "Emergency";
                const isEmergencyMissed = m.status === "Emergency (Not Given)";

                let entryClass = isTaken ? "entry-taken" : "entry-missed";
                let icon = isTaken
                    ? '<i class="fa-solid fa-circle-check" style="color: var(--success);"></i>'
                    : '<i class="fa-solid fa-circle-xmark" style="color: var(--danger);"></i>';
                let statusClass = isTaken ? "status-done" : "status-missed";

                if (isEmergency) {
                    entryClass = "entry-emergency";
                    icon = '<i class="fa-solid fa-triangle-exclamation" style="color: #dc2626;"></i>';
                    statusClass = "status-emergency";
                } else if (isEmergencyMissed) {
                    entryClass = "entry-emergency-missed";
                    icon = '<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i>';
                    statusClass = "status-emergency-missed";
                }

                const emergLabel = m.emergencyTitle ? `<span style="font-size: 0.72rem; color: #dc2626; font-weight: 600; margin-left: 4px;">⚑ ${m.emergencyTitle}</span>` : "";

                bodyHtml += `
                    <div class="history-entry ${entryClass}">
                        <span class="entry-icon">${icon}</span>
                        <span class="entry-name">${m.medicine}${emergLabel}</span>
                        <span class="entry-dose">${m.dose}</span>
                        <span class="entry-status ${statusClass}">${m.status}</span>
                    </div>
                `;
            });
            bodyHtml += `</div>`;
        });

        html += `
            <div class="history-day">
                <div class="history-day-header" onclick="toggleHistoryDay('${dayId}')">
                    <span class="history-day-label">${dateLabel}</span>
                    <div class="history-day-right">
                        <span class="history-day-badge ${takenCount === total ? "badge-all" : "badge-partial"}">
                            ${takenCount}/${total} taken
                        </span>
                        <span class="history-chevron" id="chevron-${dayId}">▼</span>
                    </div>
                </div>
                <div class="history-day-body" id="${dayId}">
                    ${bodyHtml}
                </div>
            </div>
        `;
    });

    if (lastMonthKey !== null) html += `</div>`; // close last month block

    container.innerHTML = html;
    renderAnalytics();
}

function switchHistorySubTab(tabName) {
    const logTab = document.getElementById("historyLogTab");
    const analyticsTab = document.getElementById("historyAnalyticsTab");
    const btnLog = document.getElementById("btn-history-log");
    const btnAnalytics = document.getElementById("btn-history-analytics");

    if (!logTab || !analyticsTab || !btnLog || !btnAnalytics) return;

    if (tabName === "log") {
        logTab.style.display = "block";
        analyticsTab.style.display = "none";
        btnLog.classList.add("active");
        btnAnalytics.classList.remove("active");
    } else if (tabName === "analytics") {
        logTab.style.display = "none";
        analyticsTab.style.display = "block";
        btnLog.classList.remove("active");
        btnAnalytics.classList.add("active");
        renderAnalytics();
    }
}

window.switchHistorySubTab = switchHistorySubTab;

function renderAnalytics() {
    const container = document.getElementById("analyticsContainer");
    if (!container) return;

    if (db.medicines.length === 0) {
        container.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon"><i class="fa-solid fa-chart-line" style="color: #cbd5e1;"></i></div>
                <p>No medicines configured yet.</p>
                <small>Go to the Setup page to add medicines.</small>
            </div>
        `;
        return;
    }

    let html = "";

    const uniqueHistoryDates = new Set(db.history.map(h => h.date));
    const totalDaysCount = Math.max(1, uniqueHistoryDates.size);

    db.medicines.forEach(med => {
        let dailyScheduledCount = 0;
        let dailyScheduledAmount = 0;

        db.schedules.forEach(s => {
            const medInSched = s.medications.find(m => m.medicineId === med.id);
            if (medInSched) {
                dailyScheduledCount++;
                dailyScheduledAmount += parseAmountAndUnit(medInSched.dose).amount;
            }
        });
        dailyScheduledAmount = formatFloat(dailyScheduledAmount);

        const medLogs = db.history.filter(h => h.medicine === med.name);
        const totalLogs = medLogs.length;
        const takenLogs = medLogs.filter(h => h.status === "Taken").length;
        const missedLogs = medLogs.filter(h => h.status === "Missed").length;

        const adherence = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : 100;
        let adherenceColor = "#22c55e";
        if (adherence < 70) {
            adherenceColor = "#ef4444";
        } else if (adherence < 90) {
            adherenceColor = "#f59e0b";
        }

        let totalTakenAmount = 0;
        medLogs.forEach(h => {
            if (h.status === "Taken") {
                totalTakenAmount += parseAmountAndUnit(h.dose).amount;
            }
        });
        const averageIntake = formatFloat(totalTakenAmount / totalDaysCount);

        // Detect dose changes chronologically from history
        const sortedLogs = [...medLogs].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        const doseSegments = [];
        if (sortedLogs.length > 0) {
            let currentDose = sortedLogs[0].dose;
            let startDate = sortedLogs[0].date;
            let lastDate = sortedLogs[0].date;

            for (let i = 1; i < sortedLogs.length; i++) {
                const log = sortedLogs[i];
                if (log.dose !== currentDose) {
                    doseSegments.push({
                        dose: currentDose,
                        start: startDate,
                        end: lastDate
                    });
                    currentDose = log.dose;
                    startDate = log.date;
                }
                lastDate = log.date;
            }
            doseSegments.push({
                dose: currentDose,
                start: startDate,
                end: null
            });
        }

        let doseHistoryHtml = "";
        if (doseSegments.length > 1) {
            let listItems = "";
            doseSegments.forEach(seg => {
                const dateRange = seg.end
                    ? `until ${formatDoseHistoryDate(seg.end)}`
                    : `since ${formatDoseHistoryDate(seg.start)}`;
                listItems += `
                    <li style="margin-bottom: 4px;">
                        <strong>${seg.dose}</strong> <span style="color: #64748b;">(${dateRange})</span>
                    </li>
                `;
            });
            doseHistoryHtml = `
                <div style="margin-top: 10px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: #475569; margin-bottom: 6px;">
                        <i class="fa-solid fa-timeline"></i> Dose History
                    </div>
                    <ul style="font-size: 0.8rem; padding-left: 20px; color: var(--text); margin-bottom: 0; text-align: left; list-style-type: disc;">
                        ${listItems}
                    </ul>
                </div>
            `;
        }

        let activeIngredientHtml = "";
        if (med.ingredient) {
            const concInfo = med.concentration ? `, Conc: ${med.concentration} mg/ml` : "";
            const targetMgInfo = med.targetMg ? `, Target: ${med.targetMg} mg` : "";
            activeIngredientHtml = `
                <div style="font-size: 0.85rem; color: #475569; margin-top: 4px; margin-bottom: 12px; font-weight: 500; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
                    <i class="fa-solid fa-flask" style="color: var(--primary); margin-right: 4px;"></i> Active Ingredient: <strong>${med.ingredient}</strong>${concInfo}${targetMgInfo}
                </div>
            `;
        }

        const dailyScheduledMgStr = (med.concentration && dailyScheduledAmount > 0) ? ` (${formatFloat(dailyScheduledAmount * med.concentration)} mg)` : "";
        const avgSubstanceMgStr = med.concentration ? ` (${formatFloat(averageIntake * med.concentration)} mg)` : "";
        const totalSubstanceMgStr = med.concentration ? ` (${formatFloat(totalTakenAmount * med.concentration)} mg)` : "";

        let stockHtml = "";
        if (med.currentStock !== undefined && med.currentStock !== null) {
            const initialAmount = parseAmountAndUnit(med.initialStock).amount || 1;
            const percentage = Math.min(100, Math.max(0, (med.currentStock / initialAmount) * 100));
            const estimate = estimateRunOutDateTime(med.id, med.currentStock);

            let stockColor = "#22c55e";
            if (med.currentStock <= 0) {
                stockColor = "#ef4444";
            } else if (med.currentStock < (parseAmountAndUnit(med.defaultDose).amount * 3)) {
                stockColor = "#f59e0b";
            }

            stockHtml = `
                <div style="margin-top: 10px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: #64748b;">
                        <span><i class="fa-solid fa-boxes-stacked"></i> Stock Remaining</span>
                        <span>${med.currentStock} ${med.unit} left</span>
                    </div>
                    <div style="background: #e2e8f0; height: 6px; border-radius: 3px; margin: 4px 0 6px; overflow: hidden;">
                        <div style="background: ${stockColor}; width: ${percentage}%; height: 100%; border-radius: 3px;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #64748b; margin-top: 4px;">
                        <span><i class="fa-solid fa-hourglass-half"></i> Lasts until: <strong style="color: #475569;">${estimate}</strong></span>
                        <span>Total Spent: <strong style="color: #475569;">${formatFloat(totalTakenAmount)} ${med.unit || ""}${totalSubstanceMgStr}</strong></span>
                    </div>
                </div>
            `;
        } else {
            stockHtml = `
                <div style="margin-top: 10px; border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; justify-content: space-between; font-size: 0.78rem; color: #64748b;">
                    <span><i class="fa-solid fa-circle-info"></i> Stock tracking not enabled.</span>
                    <span>Total Spent: <strong style="color: #475569;">${formatFloat(totalTakenAmount)} ${med.unit || ""}${totalSubstanceMgStr}</strong></span>
                </div>
            `;
        }

        html += `
            <div class="analytics-card">
                <h3>
                    <span><i class="fa-solid fa-pills" style="color: var(--primary); margin-right: 6px;"></i> ${med.name}</span>
                    <span style="font-size: 0.8rem; background: ${adherenceColor}15; color: ${adherenceColor}; padding: 3px 8px; border-radius: 20px; border: 1px solid ${adherenceColor}30;">
                        ${adherence}% Adherence
                    </span>
                </h3>
                
                ${activeIngredientHtml}
                
                <div class="analytics-grid">
                    <div class="analytics-stat-box">
                        <div class="analytics-stat-label"><i class="fa-solid fa-calendar-day"></i> Daily Schedule</div>
                        <div class="analytics-stat-value">
                            ${dailyScheduledCount > 0 ? `${dailyScheduledCount}x (${dailyScheduledAmount} ${med.unit || ""})${dailyScheduledMgStr}` : "Not scheduled"}
                        </div>
                    </div>
                    <div class="analytics-stat-box">
                        <div class="analytics-stat-label"><i class="fa-solid fa-droplet"></i> Avg Daily Intake</div>
                        <div class="analytics-stat-value">
                            ${averageIntake} ${med.unit || ""}${avgSubstanceMgStr}
                        </div>
                    </div>
                    <div class="analytics-stat-box" style="grid-column: span 2;">
                        <div class="analytics-stat-label"><i class="fa-solid fa-circle-check" style="color: var(--success);"></i> Taken Logs</div>
                        <div class="analytics-stat-value">${takenLogs} times</div>
                    </div>
                </div>

                ${stockHtml}
                ${doseHistoryHtml}
            </div>
        `;
    });

    container.innerHTML = html;
}

function toggleHistoryDay(id) {

    const body = document.getElementById(id);
    const chevron = document.getElementById(`chevron-${id}`);
    if (!body) return;

    const isOpen = body.classList.contains("open");

    // Close every open day first (accordion behaviour)
    document.querySelectorAll(".history-day-body.open").forEach(el => {
        el.classList.remove("open");
    });
    document.querySelectorAll(".history-chevron").forEach(el => {
        el.textContent = "▼";
    });

    // If it was closed, open it now; if it was already open, leave it closed
    if (!isOpen) {
        body.classList.add("open");
        if (chevron) chevron.textContent = "▲";
    }
}

// =========================
// SEED HISTORY RANGE (Jun 19 → yesterday)
// =========================

function seedHistoryRange() {

    // Use today's history entries as the template
    const todayEntries = db.history.filter(h => h.date === todayKey());

    if (todayEntries.length === 0) return; // nothing to copy yet

    // Build list of all dates from 2026-06-19 up to (not including) today
    const start = new Date("2026-06-19T00:00:00");
    const end = new Date(todayKey() + "T00:00:00");

    const datesToSeed = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        datesToSeed.push(formatLocalDate(d));
    }

    // For each missing date, inject copies of today's entries marked Taken
    let added = false;
    const existingDates = new Set(db.history.map(h => h.date));

    datesToSeed.forEach(date => {
        if (existingDates.has(date)) return; // already seeded
        todayEntries.forEach(h => {
            db.history.push({
                date,
                time: h.time,
                medicine: h.medicine,
                dose: h.dose,
                status: "Taken"
            });
        });
        added = true;
    });

    if (added) saveDatabase();
}

// =========================
// PATCH GABA-LIQUID DOSES
// =========================

function patchGabaLiquidDoses() {

    let changed = false;

    db.history.forEach(h => {

        if (h.medicine !== "Gaba-Liquid") return;

        const expectedDose = h.date < "2026-06-24" ? "1.3 ml" : "1.6 ml";

        if (h.dose !== expectedDose) {
            h.dose = expectedDose;
            changed = true;
        }
    });

    if (changed) saveDatabase();
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

        let checked = false;
        if (completed) {
            if (log.meds && log.meds[m.medicineId] !== undefined) {
                checked = log.meds[m.medicineId] === true;
            } else {
                checked = true;
            }
        } else {
            checked = log.meds?.[m.medicineId] === true;
        }

        let stockText = "";
        if (med && med.currentStock !== undefined && med.currentStock !== null) {
            const doseAmt = parseAmountAndUnit(m.dose).amount;
            const lowStockThreshold = doseAmt * 3;
            let stockColor = "#059669";
            if (med.currentStock <= 0) {
                stockColor = "#dc2626";
            } else if (med.currentStock < lowStockThreshold) {
                stockColor = "#d97706";
            }
            stockText = `<div class="med-stock-tag" style="font-size: 0.8rem; color: ${stockColor}; font-weight: 600; margin-top: 2px;">
                <i class="fa-solid fa-boxes-stacked"></i> ${med.currentStock <= 0 ? "OUT OF STOCK" : `${med.currentStock} ${med.unit} left`}
            </div>`;
        }

        html += `
            <div class="med-item">
                <div class="med-info">
                    <div class="med-name"><i class="fa-solid fa-pills" style="color: var(--primary); margin-right: 6px;"></i> ${med?.name || "Unknown"}</div>
                    <div class="med-dose"><i class="fa-solid fa-prescription"></i> Dose: ${m.dose}</div>
                    ${stockText}
                </div>

                <input type="checkbox"
                    class="med-check"
                    ${checked ? "checked" : ""}
                    onchange="toggleMedCheck(${schedule.id}, ${m.medicineId})">
            </div>
        `;
    });

    const btnText = completed ? "Save Changes" : "Mark Completed";
    const btnDisabled = completed ? "" : (areAllMedsChecked(schedule.id) ? "" : "disabled");

    html += `
        <button id="complete-btn-${schedule.id}"
            onclick="completeSchedule(${schedule.id})"
            ${btnDisabled}>
            <i class="fa-solid fa-circle-check"></i> ${btnText}
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
    if (radius <= 0) return;

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
// PATCH JUNE DATA
// =========================

function patchJuneData() {

    let changed = false;

    // Remove June 18 data
    const lengthBefore = db.history.length;
    db.history = db.history.filter(h => h.date !== "2026-06-18");

    if (db.history.length !== lengthBefore) {
        changed = true;
    }

    if (changed) saveDatabase();
}

// =========================
// INIT
// =========================

function init() {

    cleanupOldLogs();
    patchJuneData();
    seedHistoryRange();
    patchGabaLiquidDoses();

    renderMedicines();
    renderMedicineSelector();
    renderSchedules();
    renderTodaySchedule();
    renderHistory();
    renderEmergencyButton();

    resizeCanvas();
    drawClock();
    window.addEventListener("resize", resizeCanvas);
    setInterval(drawClock, 60000);
}

// =========================
// EMERGENCY SYSTEM
// =========================

// --- Emergency Situations CRUD ---

function renderEmergencyMedSelector() {
    const container = document.getElementById("emergencyMedCheckboxes");
    if (!container) return;
    container.innerHTML = "";
    db.medicines.forEach(med => {
        const label = document.createElement("label");
        label.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; cursor: pointer;";
        label.innerHTML = `
            <input type="checkbox" value="${med.id}" class="emerg-med-checkbox" style="width: 16px; height: 16px; accent-color: var(--primary);">
            <span>
                <strong>${med.name}</strong>
                ${med.isEmergency ? '<span style="font-size: 0.7rem; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 20px; padding: 1px 6px; margin-left: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> EMERGENCY</span>' : ''}
                <span style="color: #64748b; font-size: 0.82rem; margin-left: 4px;">— ${med.defaultDose}</span>
            </span>
        `;
        container.appendChild(label);
    });
}

function addEmergencySituation() {
    const title = document.getElementById("emergSituTitle")?.value.trim();
    const description = document.getElementById("emergSituDesc")?.value.trim();
    const checks = document.querySelectorAll(".emerg-med-checkbox:checked");
    const medications = Array.from(checks).map(c => parseInt(c.value));

    if (!title) return alert("Please enter a situation title.");
    if (medications.length === 0) return alert("Please select at least one medication.");

    db.emergencySituations.push({
        id: generateId(),
        title,
        description: description || "",
        medications
    });
    saveDatabase();

    document.getElementById("emergSituTitle").value = "";
    document.getElementById("emergSituDesc").value = "";
    document.querySelectorAll(".emerg-med-checkbox").forEach(c => c.checked = false);

    renderEmergencySituations();
    renderEmergencyButton();
    closeForm("addEmergencyForm", "btn-toggle-emerg-form");
}

function deleteEmergencySituation(id) {
    db.emergencySituations = db.emergencySituations.filter(s => s.id !== id);
    saveDatabase();
    renderEmergencySituations();
    renderEmergencyButton();
}

function renderEmergencySituations() {
    const list = document.getElementById("emergencySituationList");
    if (!list) return;
    list.innerHTML = "";

    if (db.emergencySituations.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 24px; font-style: italic;"><i class="fa-solid fa-shield-heart" style="font-size: 2rem; margin-bottom: 8px; display: block;"></i>No emergency situations configured.</div>`;
        return;
    }

    db.emergencySituations.forEach(situ => {
        const div = document.createElement("div");
        div.className = "list-item";
        div.style.cssText = "flex-direction: column; align-items: stretch; border-left: 4px solid #ef4444;";

        const medNames = situ.medications.map(id => {
            const m = db.medicines.find(x => x.id === id);
            return m ? `<span style="display: inline-block; background: #f1f5f9; border: 1px solid var(--border); border-radius: 20px; padding: 1px 8px; font-size: 0.78rem; margin: 2px;">${m.name} (${m.defaultDose})</span>` : "";
        }).join(" ");

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <strong style="font-size: 1rem; color: #dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ${situ.title}</strong>
                    ${situ.description ? `<div style="font-size: 0.85rem; color: #64748b; margin-top: 2px;">${situ.description}</div>` : ""}
                    <div style="margin-top: 6px;">${medNames}</div>
                </div>
                <button class="delete-btn" onclick="deleteEmergencySituation(${situ.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- Emergency Button on Home ---

function renderEmergencyButton() {
    const btn = document.getElementById("emergencyBtn");
    if (!btn) return;
    btn.style.display = db.emergencySituations && db.emergencySituations.length > 0 ? "flex" : "none";
}

// --- Emergency Modal ---

// Stores per-situation checked state during the modal session
let emergencyChecks = {};

function openEmergencyModal() {
    emergencyChecks = {};
    const modal = document.getElementById("emergencyModal");
    if (!modal) return;

    const body = document.getElementById("emergencyModalBody");
    let html = "";

    db.emergencySituations.forEach(situ => {
        emergencyChecks[situ.id] = {};
        situ.medications.forEach(medId => { emergencyChecks[situ.id][medId] = false; });

        const medRows = situ.medications.map(medId => {
            const med = db.medicines.find(x => x.id === medId);
            if (!med) return "";
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div>
                        <div style="font-weight: 600;">${med.name}</div>
                        <div style="font-size: 0.82rem; opacity: 0.8;"><i class="fa-solid fa-prescription"></i> ${med.defaultDose}</div>
                    </div>
                    <input type="checkbox" class="emerg-check"
                        onchange="toggleEmergencyMedCheck(${situ.id}, ${medId}, this.checked)"
                        style="width: 22px; height: 22px; accent-color: #fbbf24;">
                </div>
            `;
        }).join("");

        html += `
            <div class="emergency-situation-block">
                <div class="emergency-situ-title"><i class="fa-solid fa-triangle-exclamation"></i> ${situ.title}</div>
                ${situ.description ? `<div class="emergency-situ-desc">${situ.description}</div>` : ""}
                <div class="emergency-med-list">${medRows}</div>
                <button class="emergency-log-btn" onclick="logEmergency(${situ.id})">
                    <i class="fa-solid fa-circle-check"></i> Log as Administered
                </button>
            </div>
        `;
    });

    body.innerHTML = html;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
}

function closeEmergencyModal() {
    const modal = document.getElementById("emergencyModal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
}

function toggleEmergencyMedCheck(situId, medId, checked) {
    if (!emergencyChecks[situId]) emergencyChecks[situId] = {};
    emergencyChecks[situId][medId] = checked;
}

function logEmergency(situId) {
    const situ = db.emergencySituations.find(s => s.id === situId);
    if (!situ) return;

    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const date = todayKey();

    let anyLogged = false;
    situ.medications.forEach(medId => {
        const med = db.medicines.find(x => x.id === medId);
        const taken = emergencyChecks[situId]?.[medId] === true;

        db.history.push({
            date,
            time,
            medicine: med?.name || "Unknown",
            dose: med?.defaultDose || "—",
            status: taken ? "Emergency" : "Emergency (Not Given)",
            emergencyTitle: situ.title
        });

        // Deduct stock if taken
        if (taken && med && med.currentStock !== null && med.currentStock !== undefined) {
            const doseAmt = parseAmountAndUnit(med.defaultDose).amount;
            med.currentStock = formatFloat(Math.max(0, med.currentStock - doseAmt));
        }
        anyLogged = true;
    });

    if (anyLogged) {
        saveDatabase();
        renderHistory();
        renderMedicines();
        renderAnalytics();
    }

    closeEmergencyModal();
    alert(`Emergency logged: "${situ.title}"`);
}

// =========================
// EXPORT HELPERS
// =========================

function downloadCSV(filename, rows) {
    const csvContent = rows.map(r =>
        r.map(cell => {
            const str = String(cell == null ? "" : cell);
            return str.includes(",") || str.includes("\"") || str.includes("\n")
                ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(",")
    ).join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// =========================
// EXPORT: HISTORY LOG
// =========================

function exportHistoryLog() {
    const rows = [
        ["Date", "Time", "Medicine", "Dose", "Status"]
    ];

    const sorted = [...db.history].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.time.localeCompare(b.time);
    });

    sorted.forEach(h => {
        if (h.status === "Missed" || h.status === "Emergency (Not Given)") return;
        rows.push([h.date, h.time, h.medicine, h.dose, h.status]);
    });

    downloadCSV("medina_history_log.csv", rows);
}

// =========================
// EXPORT: ANALYTICS
// =========================

function exportAnalytics() {
    const rows = [
        [
            "Medicine", "Active Ingredient", "Concentration (mg/ml)", "Target mg",
            "Adherence %", "Total Taken Logs",
            "Total Volume Taken", "Total Active Substance (mg)",
            "Avg Daily Intake (volume)", "Avg Daily Intake (mg)",
            "Daily Scheduled Doses", "Daily Scheduled Volume", "Daily Scheduled (mg)",
            "Current Stock", "Initial Stock", "Unit", "Stock %"
        ]
    ];

    const uniqueDates = new Set(db.history.map(h => h.date));
    const totalDays = Math.max(1, uniqueDates.size);

    db.medicines.forEach(med => {
        const medLogs = db.history.filter(h => h.medicine === med.name);
        const taken = medLogs.filter(h => h.status === "Taken");

        let totalVolume = 0;
        taken.forEach(h => { totalVolume += parseAmountAndUnit(h.dose).amount; });
        const avgDaily = formatFloat(totalVolume / totalDays);

        let dailyCount = 0;
        let dailyVolume = 0;
        db.schedules.forEach(s => {
            const entry = s.medications.find(m => m.medicineId === med.id);
            if (entry) {
                dailyCount++;
                dailyVolume += parseAmountAndUnit(entry.dose).amount;
            }
        });
        dailyVolume = formatFloat(dailyVolume);

        const adherence = medLogs.length > 0 ? Math.round((taken.length / medLogs.length) * 100) : 100;
        const stockPercent = (med.currentStock != null && med.initialStock)
            ? formatFloat((med.currentStock / (parseAmountAndUnit(med.initialStock).amount || 1)) * 100) : "";

        rows.push([
            med.name,
            med.ingredient || "",
            med.concentration || "",
            med.targetMg || "",
            adherence,
            taken.length,
            `${formatFloat(totalVolume)} ${med.unit || ""}`,
            med.concentration ? formatFloat(totalVolume * med.concentration) : "",
            `${avgDaily} ${med.unit || ""}`,
            med.concentration ? formatFloat(avgDaily * med.concentration) : "",
            dailyCount,
            dailyCount > 0 ? `${dailyVolume} ${med.unit || ""}` : "",
            (dailyCount > 0 && med.concentration) ? formatFloat(dailyVolume * med.concentration) : "",
            med.currentStock != null ? med.currentStock : "",
            med.initialStock || "",
            med.unit || "",
            stockPercent !== "" ? `${stockPercent}%` : ""
        ]);
    });

    downloadCSV("medina_analytics.csv", rows);
}

// =========================
// EXPORT: MEDICINES
// =========================

function exportMedicines() {
    const rows = [
        [
            "Medicine Name", "Active Ingredient", "Concentration (mg/ml)", "Target Amount (mg)",
            "Default Dose", "Unit",
            "Initial Stock", "Current Stock", "Stock %"
        ]
    ];

    db.medicines.forEach(med => {
        const stockPercent = (med.currentStock != null && med.initialStock)
            ? formatFloat((med.currentStock / (parseAmountAndUnit(med.initialStock).amount || 1)) * 100) : "";

        rows.push([
            med.name,
            med.ingredient || "",
            med.concentration || "",
            med.targetMg || "",
            med.defaultDose,
            med.unit || "",
            med.initialStock || "",
            med.currentStock != null ? med.currentStock : "",
            stockPercent !== "" ? `${stockPercent}%` : ""
        ]);
    });

    downloadCSV("medina_medicines.csv", rows);
}

// =========================
// EXPORT: SCHEDULES
// =========================

function exportSchedules() {
    const rows = [
        ["Schedule Time", "Medicine", "Active Ingredient", "Concentration (mg/ml)", "Target mg", "Dose"]
    ];

    db.schedules.forEach(s => {
        s.medications.forEach(m => {
            const med = db.medicines.find(x => x.id === m.medicineId);
            rows.push([
                s.time,
                med?.name || "Unknown",
                med?.ingredient || "",
                med?.concentration || "",
                med?.targetMg || "",
                m.dose
            ]);
        });
    });

    downloadCSV("medina_schedules.csv", rows);
}

// =========================
// DATA BACKUP & RESTORE
// =========================

function exportJSONBackup() {
    const dataStr = JSON.stringify(db, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'medina_backup.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function triggerImportBackup() {
    const input = document.getElementById('importBackupInput');
    if (input) input.click();
}

function importJSONBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedDb = JSON.parse(e.target.result);
            
            // Validate that we have a valid object
            if (importedDb && typeof importedDb === 'object') {
                // Backfill any missing fields to avoid breaking the app
                if (!importedDb.medicines) importedDb.medicines = [];
                if (!importedDb.schedules) importedDb.schedules = [];
                if (!importedDb.dailyLog) importedDb.dailyLog = {};
                if (!importedDb.history) importedDb.history = [];
                if (!importedDb.emergencySituations) importedDb.emergencySituations = [];

                db = importedDb;
                saveDatabase();
                alert("Backup imported successfully! The application will now reload.");
                location.reload();
            } else {
                alert("Invalid backup file. Could not parse database.");
            }
        } catch (err) {
            alert("Error parsing backup file: " + err.message);
        }
    };
    reader.readAsText(file);
    // Reset file input value to allow importing the same file again if needed
    event.target.value = "";
}

window.exportJSONBackup = exportJSONBackup;
window.triggerImportBackup = triggerImportBackup;
window.importJSONBackup = importJSONBackup;

init();