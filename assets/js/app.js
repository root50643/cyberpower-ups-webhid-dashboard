import {
  ALL_REPORT_IDS,
  closeDevice,
  getCollectionUsageText,
  getFeatureReportIds,
  getGrantedUpsDevices,
  getMonitorReportIds,
  hasPowerUpsCollection,
  hasWebHid,
  hexReportId,
  isUpsDeviceCandidate,
  openDevice,
  readSnapshot,
  requestUpsDevice,
  snapshotFromReportBytes,
  supportsAudibleAlarmWrite,
  writeAudibleAlarm,
} from "./cyberpower-hid.js";

const ALARM_MODE_LABELS = new Map([
  ["disabled", "關閉 disabled"],
  ["enabled", "啟用 enabled"],
  ["muted", "靜音 muted"],
]);

const ALARM_VALUE_TO_MODE = new Map([
  [1, "disabled"],
  [2, "enabled"],
  [3, "muted"],
]);

const elements = {
  supportBadge: document.querySelector("#supportBadge"),
  connectionBadge: document.querySelector("#connectionBadge"),
  deviceSelect: document.querySelector("#deviceSelect"),
  pollInterval: document.querySelector("#pollInterval"),
  relaxedFilter: document.querySelector("#relaxedFilter"),
  grantButton: document.querySelector("#grantButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  readButton: document.querySelector("#readButton"),
  demoButton: document.querySelector("#demoButton"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  exportButton: document.querySelector("#exportButton"),
  batteryFill: document.querySelector("#batteryFill"),
  batteryValue: document.querySelector("#batteryValue"),
  batteryTitle: document.querySelector("#batteryTitle"),
  snapshotTime: document.querySelector("#snapshotTime"),
  runtimeMetric: document.querySelector("#runtimeMetric"),
  inputMetric: document.querySelector("#inputMetric"),
  outputMetric: document.querySelector("#outputMetric"),
  loadMetric: document.querySelector("#loadMetric"),
  wattMetric: document.querySelector("#wattMetric"),
  vaMetric: document.querySelector("#vaMetric"),
  batteryVoltageMetric: document.querySelector("#batteryVoltageMetric"),
  ratingMetric: document.querySelector("#ratingMetric"),
  deviceDetails: document.querySelector("#deviceDetails"),
  flagList: document.querySelector("#flagList"),
  validationPanel: document.querySelector("#validationPanel"),
  reportsTable: document.querySelector("#reportsTable"),
  reportCount: document.querySelector("#reportCount"),
  eventLog: document.querySelector("#eventLog"),
  alarmStatusBadge: document.querySelector("#alarmStatusBadge"),
  currentAlarmValue: document.querySelector("#currentAlarmValue"),
  audibleModeSelect: document.querySelector("#audibleModeSelect"),
  writeConfirm: document.querySelector("#writeConfirm"),
  writeAlarmButton: document.querySelector("#writeAlarmButton"),
  writeResult: document.querySelector("#writeResult"),
};

const state = {
  device: null,
  grantedDevices: [],
  lastSnapshot: null,
  pollingTimer: null,
  reading: false,
  writing: false,
  alarmModeTouched: false,
};

elements.grantButton.addEventListener("click", requestAndOpenDevice);
elements.reconnectButton.addEventListener("click", openSelectedGrantedDevice);
elements.readButton.addEventListener("click", () => readOnce());
elements.demoButton.addEventListener("click", loadDemoSnapshot);
elements.startButton.addEventListener("click", startPolling);
elements.stopButton.addEventListener("click", stopPolling);
elements.exportButton.addEventListener("click", exportSnapshot);
elements.audibleModeSelect.addEventListener("change", () => {
  state.alarmModeTouched = true;
  renderConnection();
});
elements.writeConfirm.addEventListener("change", renderConnection);
elements.writeAlarmButton.addEventListener("click", writeAlarmSetting);

if (hasWebHid()) {
  navigator.hid.addEventListener("connect", async () => {
    await refreshGrantedDevices();
    addLog("偵測到 HID 裝置連線");
  });

  navigator.hid.addEventListener("disconnect", async (event) => {
    if (state.device === event.device) {
      stopPolling();
      state.device = null;
      renderConnection();
      addLog("目前 UPS 已中斷連線");
    }
    await refreshGrantedDevices();
  });
}

init();

async function init() {
  renderSupport();
  renderConnection();
  renderEmptySnapshot();

  if (!hasWebHid()) {
    disableControls();
    addLog("此瀏覽器沒有提供 WebHID");
    if (shouldLoadDemo()) {
      loadDemoSnapshot();
    }
    return;
  }

  await refreshGrantedDevices();
  if (shouldLoadDemo()) {
    loadDemoSnapshot();
  }
}

function renderSupport() {
  if (!hasWebHid()) {
    setBadge(elements.supportBadge, "不支援 WebHID", "error");
    return;
  }

  if (!window.isSecureContext) {
    setBadge(elements.supportBadge, "需要安全來源", "warn");
    return;
  }

  setBadge(elements.supportBadge, "WebHID 可用", "ok");
}

async function refreshGrantedDevices() {
  state.grantedDevices = await getGrantedUpsDevices();
  elements.deviceSelect.replaceChildren();

  if (!state.grantedDevices.length) {
    elements.deviceSelect.append(new Option("尚未取得授權", ""));
    elements.reconnectButton.disabled = true;
    return;
  }

  for (const [index, device] of state.grantedDevices.entries()) {
    const marker = hasPowerUpsCollection(device) ? "UPS" : "Power Device";
    const name = device.productName || `HID ${hex4(device.vendorId)}:${hex4(device.productId)}`;
    elements.deviceSelect.append(new Option(`${marker} - ${name}`, String(index)));
  }

  elements.reconnectButton.disabled = false;
}

async function requestAndOpenDevice() {
  if (!hasWebHid()) {
    addLog("此瀏覽器無法使用 WebHID");
    return;
  }

  try {
    setBusy(true);
    const devices = await requestUpsDevice({ showAllHid: elements.relaxedFilter.checked });
    if (!devices.length) {
      addLog("沒有選取裝置");
      return;
    }
    if (!isUpsDeviceCandidate(devices[0])) {
      addLog("已選取未宣告 UPS usage 的 HID 裝置，將以 raw report 模式嘗試讀取");
    }
    await useDevice(devices[0]);
    await refreshGrantedDevices();
  } catch (error) {
    handleError("連接 UPS 失敗", error);
  } finally {
    setBusy(false);
  }
}

async function openSelectedGrantedDevice() {
  const selectedIndex = Number(elements.deviceSelect.value);
  const device = state.grantedDevices[selectedIndex];
  if (!device) {
    addLog("沒有可開啟的授權裝置");
    return;
  }

  try {
    setBusy(true);
    await useDevice(device);
  } catch (error) {
    handleError("開啟授權裝置失敗", error);
  } finally {
    setBusy(false);
  }
}

async function useDevice(device) {
  if (state.device && state.device !== device) {
    await closeDevice(state.device);
  }

  state.device = await openDevice(device);
  renderConnection();
  renderDeviceDetails(state.device);
  addLog(`已開啟 ${state.device.productName || "UPS HID device"}`);
  await readOnce();
}

async function readOnce(reportIds = null) {
  if (!state.device) {
    addLog("尚未連接 UPS");
    return;
  }

  try {
    state.reading = true;
    setBusy(true);
    const snapshot = await readSnapshot(state.device, reportIds);
    state.lastSnapshot = snapshot;
    renderSnapshot(snapshot);
    addLog(`讀取完成：${Object.keys(snapshot.reports).length} reports`);
  } catch (error) {
    handleError("讀取 UPS 失敗", error);
  } finally {
    state.reading = false;
    setBusy(false);
  }
}

async function writeAlarmSetting() {
  if (!state.device?.opened) {
    addLog("尚未連接 UPS");
    return;
  }

  if (!elements.writeConfirm.checked) {
    addLog("寫入前需要勾選確認");
    return;
  }

  const mode = elements.audibleModeSelect.value;
  const label = ALARM_MODE_LABELS.get(mode) || mode;

  try {
    state.writing = true;
    setBusy(true);
    const report = await writeAudibleAlarm(state.device, mode);
    const readbackMode = alarmModeFromValues(report.decoded);
    const readbackLabel = ALARM_MODE_LABELS.get(readbackMode) || readbackMode || "unknown";

    state.alarmModeTouched = false;
    elements.writeConfirm.checked = false;
    elements.writeResult.textContent = `已寫入 ${label}，讀回 ${readbackLabel}`;
    addLog(`警報設定已寫入：${label}`);
    await readOnce();
  } catch (error) {
    handleError("寫入警報設定失敗", error);
  } finally {
    state.writing = false;
    setBusy(false);
    renderConnection();
  }
}

function startPolling() {
  if (!state.device || state.pollingTimer) {
    return;
  }

  const intervalSeconds = clamp(Number(elements.pollInterval.value) || 2, 1, 60);
  elements.pollInterval.value = String(intervalSeconds);

  readOnce(getMonitorReportIds(state.device));
  state.pollingTimer = window.setInterval(() => {
    if (!state.reading && !state.writing) {
      readOnce(getMonitorReportIds(state.device));
    }
  }, intervalSeconds * 1000);

  renderConnection();
  addLog(`開始輪詢，每 ${intervalSeconds} 秒`);
}

function stopPolling() {
  if (!state.pollingTimer) {
    return;
  }
  window.clearInterval(state.pollingTimer);
  state.pollingTimer = null;
  renderConnection();
  addLog("已停止輪詢");
}

function exportSnapshot() {
  if (!state.lastSnapshot) {
    return;
  }

  const blob = new Blob([JSON.stringify(state.lastSnapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `cyberpower-ups-snapshot-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function loadDemoSnapshot() {
  stopPolling();
  const snapshot = snapshotFromReportBytes(
    new Map([
      [0x05, [1]],
      [0x06, [2]],
      [0x07, [100, 1, 1, 20, 10, 100]],
      [0x08, [96, 0x88, 0x0e, 0x00, 0x00]],
      [0x09, [120, 0x00]],
      [0x0a, [0x82, 0x00]],
      [0x0b, [0x13]],
      [0x0c, [2]],
      [0x0e, [120]],
      [0x0f, [121, 0x00]],
      [0x10, [90, 0x00, 140, 0x00]],
      [0x12, [120, 0x00]],
      [0x13, [18]],
      [0x14, [6]],
      [0x15, [0xff, 0xff]],
      [0x16, [0xff, 0xff]],
      [0x17, [0]],
      [0x18, [0x58, 0x02, 0xe8, 0x03]],
      [0x19, [108, 0x00]],
      [0x1d, [180, 0x00]],
    ]),
  );
  state.lastSnapshot = snapshot;
  renderSnapshot(snapshot);
  addLog("已載入示範資料");
}

function shouldLoadDemo() {
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "1" || params.get("demo") === "true";
}

function renderConnection() {
  const connected = Boolean(state.device?.opened);
  elements.readButton.disabled = !connected;
  elements.startButton.disabled = !connected || Boolean(state.pollingTimer);
  elements.stopButton.disabled = !state.pollingTimer;
  elements.exportButton.disabled = !state.lastSnapshot;
  elements.audibleModeSelect.disabled = !connected;
  elements.writeConfirm.disabled = !connected || !supportsAudibleAlarmWrite(state.device);
  elements.writeAlarmButton.disabled =
    !connected || !supportsAudibleAlarmWrite(state.device) || !elements.writeConfirm.checked;

  if (connected && state.pollingTimer) {
    setBadge(elements.connectionBadge, "輪詢中", "ok");
  } else if (connected) {
    setBadge(elements.connectionBadge, "已連接", "ok");
  } else {
    setBadge(elements.connectionBadge, "未連接", "muted");
  }
}

function disableControls() {
  for (const button of [
    elements.grantButton,
    elements.reconnectButton,
    elements.readButton,
    elements.startButton,
    elements.stopButton,
    elements.exportButton,
    elements.writeAlarmButton,
  ]) {
    button.disabled = true;
  }
  elements.deviceSelect.disabled = true;
  elements.pollInterval.disabled = true;
  elements.relaxedFilter.disabled = true;
  elements.audibleModeSelect.disabled = true;
  elements.writeConfirm.disabled = true;
}

function setBusy(isBusy) {
  const connected = Boolean(state.device?.opened);
  elements.grantButton.disabled = isBusy || !hasWebHid();
  elements.reconnectButton.disabled = isBusy || !state.grantedDevices.length;
  elements.readButton.disabled = isBusy || !connected;
  elements.demoButton.disabled = isBusy;
  elements.startButton.disabled = isBusy || !connected || Boolean(state.pollingTimer);
  elements.stopButton.disabled = isBusy || !state.pollingTimer;
  elements.audibleModeSelect.disabled = isBusy || !connected;
  elements.writeConfirm.disabled = isBusy || !connected || !supportsAudibleAlarmWrite(state.device);
  elements.writeAlarmButton.disabled =
    isBusy || !connected || !supportsAudibleAlarmWrite(state.device) || !elements.writeConfirm.checked;
}

function renderEmptySnapshot() {
  updateBattery(null);
  renderMetric(elements.runtimeMetric, null);
  renderMetric(elements.inputMetric, null);
  renderMetric(elements.outputMetric, null);
  renderMetric(elements.loadMetric, null);
  renderMetric(elements.wattMetric, null);
  renderMetric(elements.vaMetric, null);
  renderMetric(elements.batteryVoltageMetric, null);
  renderMetric(elements.ratingMetric, null);
  renderWritableSettings({});
}

function renderSnapshot(snapshot) {
  const values = snapshot.values;

  updateBattery(values.battery_charge_percent);
  elements.batteryTitle.textContent = batteryTitle(values);
  elements.snapshotTime.textContent = `最後更新 ${new Date(snapshot.timestamp).toLocaleString()}`;

  renderMetric(elements.runtimeMetric, values.battery_runtime_minutes, { digits: 1 });
  renderMetric(elements.inputMetric, values.input_voltage_v);
  renderMetric(elements.outputMetric, values.output_voltage_v);
  renderMetric(elements.loadMetric, values.load_percent);
  renderMetric(elements.wattMetric, values.load_watt);
  renderMetric(elements.vaMetric, values.load_va);
  renderMetric(elements.batteryVoltageMetric, values.battery_voltage_v, { digits: 1 });
  renderMetric(
    elements.ratingMetric,
    values.rating_va && values.rating_w ? `${values.rating_va} / ${values.rating_w}` : null,
  );

  renderDeviceDetails(state.device, snapshot.device);
  renderFlags(values);
  renderValidation(snapshot.validation);
  renderReports(snapshot.reports, snapshot.errors);
  renderWritableSettings(values);
  renderConnection();
}

function renderWritableSettings(values) {
  if (state.device && !supportsAudibleAlarmWrite(state.device)) {
    elements.currentAlarmValue.textContent = "--";
    elements.writeResult.textContent = "此裝置未啟用警報寫入";
    elements.writeConfirm.checked = false;
    setBadge(elements.alarmStatusBadge, "不支援寫入", "muted");
    return;
  }

  const mode = alarmModeFromValues(values);
  const raw = values.audible_alarm_control;

  if (!mode) {
    elements.currentAlarmValue.textContent = "--";
    setBadge(elements.alarmStatusBadge, "尚未讀取", "muted");
    return;
  }

  const label = ALARM_MODE_LABELS.get(mode) || mode;
  elements.currentAlarmValue.textContent =
    raw === undefined || raw === null ? label : `${label} (${raw})`;
  setBadge(elements.alarmStatusBadge, label, "ok");

  if (!state.alarmModeTouched) {
    elements.audibleModeSelect.value = mode;
  }
}

function alarmModeFromValues(values) {
  const raw = Number(values?.audible_alarm_control);
  if (ALARM_VALUE_TO_MODE.has(raw)) {
    return ALARM_VALUE_TO_MODE.get(raw);
  }

  const text = String(values?.audible_alarm_control_text || "").toLowerCase();
  return ALARM_MODE_LABELS.has(text) ? text : null;
}

function updateBattery(value) {
  const percent = Number.isFinite(Number(value)) ? clamp(Number(value), 0, 100) : null;
  elements.batteryFill.classList.remove("warn", "danger");

  if (percent === null) {
    elements.batteryFill.style.height = "0%";
    elements.batteryValue.textContent = "--%";
    return;
  }

  elements.batteryFill.style.height = `${percent}%`;
  elements.batteryValue.textContent = `${Math.round(percent)}%`;

  if (percent <= 20) {
    elements.batteryFill.classList.add("danger");
  } else if (percent <= 50) {
    elements.batteryFill.classList.add("warn");
  }
}

function batteryTitle(values) {
  if (values.overload) {
    return "Overload";
  }
  if (values.discharging) {
    return "Battery Mode";
  }
  if (values.charging) {
    return "Charging";
  }
  if (values.fully_charged) {
    return "Fully Charged";
  }
  if (values.ac_present) {
    return "On Utility Power";
  }
  return "UPS Snapshot";
}

function renderMetric(element, value, options = {}) {
  if (value === null || value === undefined || value === "") {
    element.textContent = "--";
    return;
  }

  if (typeof value === "number") {
    element.textContent = Number.isInteger(value) ? String(value) : value.toFixed(options.digits ?? 1);
    return;
  }

  element.textContent = String(value);
}

function renderDeviceDetails(device, fallbackInfo = null) {
  const info = fallbackInfo || null;
  const details = [
    ["Product", device?.productName || info?.productName || "--"],
    [
      "VID:PID",
      device ? `${hex4(device.vendorId)}:${hex4(device.productId)}` : info?.vidPid || "--",
    ],
    ["Usage", device ? getCollectionUsageText(device) : collectionUsageFromInfo(info)],
    [
      "Feature reports",
      device
        ? getFeatureReportIds(device).map(hexReportId).join(", ") || "--"
        : info?.featureReportIds?.join(", ") || "--",
    ],
  ];

  elements.deviceDetails.replaceChildren(
    ...details.map(([term, description]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description;
      row.append(dt, dd);
      return row;
    }),
  );
}

function collectionUsageFromInfo(info) {
  const collections = info?.collections || [];
  if (!collections.length) {
    return "--";
  }
  return collections
    .slice(0, 4)
    .map((collection) => collection.usageText || `${hex4(collection.usagePage)}:${hex4(collection.usage)}`)
    .join(", ");
}

function renderFlags(values) {
  const flags = [
    ["AC", values.ac_present, "on"],
    ["Charging", values.charging, "on"],
    ["Discharging", values.discharging, "warn"],
    ["Fully Charged", values.fully_charged, "on"],
    ["Low Capacity", values.below_remaining_capacity_limit, "danger"],
    ["Runtime Limit", values.remaining_time_limit_expired, "danger"],
    ["Boost", values.boost, "warn"],
    ["Overload", values.overload, "danger"],
  ];

  elements.flagList.replaceChildren(
    ...flags.map(([label, value, activeClass]) => {
      const chip = document.createElement("span");
      chip.className = "flag-chip";
      if (value === true) {
        chip.classList.add(activeClass);
      } else if (value !== false) {
        chip.classList.add("unknown");
      }
      chip.textContent = label;
      return chip;
    }),
  );
}

function renderValidation(validation) {
  elements.validationPanel.replaceChildren();
  const badge = document.createElement("span");
  setBadge(badge, validation.ok ? "PASS" : "CHECK", validation.ok ? "ok" : "warn");
  elements.validationPanel.append(badge);

  const list = document.createElement("ul");
  list.className = "validation-list";

  for (const note of validation.notes || []) {
    const item = document.createElement("li");
    item.textContent = note;
    list.append(item);
  }

  for (const warning of validation.warnings || []) {
    const item = document.createElement("li");
    item.className = "warn";
    item.textContent = warning;
    list.append(item);
  }

  if (list.children.length) {
    elements.validationPanel.append(list);
  }
}

function renderReports(reports, errors = {}) {
  const reportEntries = Object.entries(reports);
  const errorEntries = Object.entries(errors);
  elements.reportCount.textContent = `${reportEntries.length} reports`;
  elements.reportsTable.replaceChildren();

  if (!reportEntries.length && !errorEntries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-cell";
    cell.textContent = "尚未讀取 HID report";
    row.append(cell);
    elements.reportsTable.append(row);
    return;
  }

  for (const [reportId, report] of reportEntries) {
    const row = document.createElement("tr");
    row.append(
      tableCell(reportId, "mono"),
      tableCell(report.source),
      tableCell(report.dataHex, "mono"),
      tableCell(summarizeDecoded(report.decoded), "mono"),
    );
    elements.reportsTable.append(row);
  }

  for (const [reportId, error] of errorEntries) {
    const row = document.createElement("tr");
    row.append(tableCell(reportId, "mono"), tableCell("error"), tableCell("--"), tableCell(error));
    elements.reportsTable.append(row);
  }
}

function tableCell(text, className = "") {
  const cell = document.createElement("td");
  if (className) {
    cell.className = className;
  }
  cell.textContent = text;
  return cell;
}

function summarizeDecoded(decoded) {
  const entries = Object.entries(decoded || {});
  if (!entries.length) {
    return "raw only";
  }
  const json = JSON.stringify(Object.fromEntries(entries.slice(0, 5)));
  return entries.length > 5 ? `${json.slice(0, -1)}, ...}` : json;
}

function addLog(message) {
  const item = document.createElement("li");
  const time = document.createElement("time");
  const text = document.createElement("span");
  time.textContent = new Date().toLocaleTimeString();
  text.textContent = message;
  item.append(time, text);
  elements.eventLog.prepend(item);

  while (elements.eventLog.children.length > 40) {
    elements.eventLog.lastElementChild.remove();
  }
}

function handleError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  addLog(`${context}: ${message}`);
  setBadge(elements.connectionBadge, "需要檢查", "warn");
}

function setBadge(element, text, kind) {
  element.textContent = text;
  element.className = `badge badge-${kind}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hex4(value) {
  return `0x${Number(value).toString(16).padStart(4, "0").toUpperCase()}`;
}
