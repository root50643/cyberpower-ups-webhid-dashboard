export const KNOWN_CYBERPOWER_VENDOR_ID = 0x0764;
export const KNOWN_CYBERPOWER_PRODUCT_ID = 0x0501;
export const POWER_DEVICE_USAGE_PAGE = 0x0084;
export const BATTERY_SYSTEM_USAGE_PAGE = 0x0085;
export const UPS_USAGE = 0x0004;

export const REPORT_LENGTHS = new Map([
  [0x01, 2],
  [0x02, 2],
  [0x03, 2],
  [0x04, 2],
  [0x05, 2],
  [0x06, 2],
  [0x07, 7],
  [0x08, 6],
  [0x09, 3],
  [0x0a, 3],
  [0x0b, 2],
  [0x0c, 2],
  [0x0d, 2],
  [0x0e, 2],
  [0x0f, 3],
  [0x10, 5],
  [0x12, 3],
  [0x13, 2],
  [0x14, 2],
  [0x15, 3],
  [0x16, 3],
  [0x17, 2],
  [0x18, 5],
  [0x19, 3],
  [0x1a, 2],
  [0x1b, 2],
  [0x1c, 6],
  [0x1d, 3],
]);

export const ALL_REPORT_IDS = [...REPORT_LENGTHS.keys()].sort((a, b) => a - b);

export const MONITOR_REPORT_IDS = [
  0x08, 0x0a, 0x0b, 0x0f, 0x12, 0x13, 0x18, 0x19, 0x1d, 0x17,
];

const CAPACITY_MODE_NAMES = new Map([
  [0, "mAh"],
  [1, "mWh"],
  [2, "percent"],
  [3, "boolean"],
]);

export const AUDIBLE_ALARM_MODES = Object.freeze({
  disabled: 1,
  enabled: 2,
  muted: 3,
});

const AUDIBLE_ALARM_NAMES = new Map(
  Object.entries(AUDIBLE_ALARM_MODES).map(([name, value]) => [value, name]),
);

const SELF_TEST_NAMES = new Map([
  [1, "done_passed"],
  [2, "done_warning"],
  [3, "done_error"],
  [4, "aborted"],
  [5, "in_progress"],
  [6, "no_test_initiated"],
]);

export function hasWebHid() {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export function buildDeviceFilters({ showAllHid = false } = {}) {
  if (showAllHid) {
    return [];
  }

  return [
    {
      usagePage: POWER_DEVICE_USAGE_PAGE,
      usage: UPS_USAGE,
    },
  ];
}

export async function requestUpsDevice(options = {}) {
  const devices = await navigator.hid.requestDevice({
    filters: buildDeviceFilters(options),
  });
  return sortPreferredDevices(devices);
}

export async function getGrantedUpsDevices() {
  const devices = await navigator.hid.getDevices();
  const upsDevices = devices.filter(isUpsDeviceCandidate);
  return sortPreferredDevices(upsDevices.length ? upsDevices : devices);
}

export function isKnownCyberPowerDevice(device) {
  return device?.vendorId === KNOWN_CYBERPOWER_VENDOR_ID;
}

export function isUpsDeviceCandidate(device) {
  return hasPowerUpsCollection(device) || hasPowerDeviceCollection(device) || looksLikeUps(device);
}

export function hasPowerUpsCollection(device) {
  return findCollection(
    device,
    (collection) =>
      collection.usagePage === POWER_DEVICE_USAGE_PAGE && collection.usage === UPS_USAGE,
  );
}

export function hasPowerDeviceCollection(device) {
  return findCollection(
    device,
    (collection) =>
      collection.usagePage === POWER_DEVICE_USAGE_PAGE ||
      collection.usagePage === BATTERY_SYSTEM_USAGE_PAGE,
  );
}

export function sortPreferredDevices(devices) {
  return [...devices].sort((left, right) => {
    const leftPower = hasPowerUpsCollection(left) ? 1 : 0;
    const rightPower = hasPowerUpsCollection(right) ? 1 : 0;
    if (leftPower !== rightPower) {
      return rightPower - leftPower;
    }
    return String(left.productName || "").localeCompare(String(right.productName || ""));
  });
}

export async function openDevice(device) {
  if (!device.opened) {
    await device.open();
  }
  return device;
}

export async function closeDevice(device) {
  if (device?.opened) {
    await device.close();
  }
}

export async function readFeatureReport(device, reportId) {
  const dataView = await device.receiveFeatureReport(reportId);
  const expectedLength = REPORT_LENGTHS.get(reportId);
  let data = normalizeReport(reportId, dataViewToBytes(dataView), expectedLength);
  if (expectedLength && data.length > expectedLength) {
    data = data.slice(0, expectedLength);
  }
  return {
    reportId,
    reportIdHex: hexReportId(reportId),
    source: "feature",
    data,
    dataHex: hexBytes(data),
    decoded: decodeReport(data),
  };
}

export async function writeAudibleAlarm(device, mode) {
  const value = audibleAlarmValue(mode);

  if (!device?.opened) {
    await openDevice(device);
  }

  if (!supportsAudibleAlarmWrite(device)) {
    throw new Error("Audible alarm write is enabled only for known compatible CyberPower UPS reports.");
  }

  if (typeof device.sendFeatureReport !== "function") {
    throw new Error("This browser or device does not expose sendFeatureReport().");
  }

  await device.sendFeatureReport(0x0c, new Uint8Array([value]));
  await wait(75);

  const report = await readFeatureReport(device, 0x0c);
  const readback = report.decoded.audible_alarm_control;
  if (readback !== value) {
    throw new Error(
      `Audible alarm readback mismatch: expected ${value}, got ${readback ?? "unknown"}.`,
    );
  }
  return report;
}

export function audibleAlarmValue(mode) {
  if (typeof mode === "string") {
    const key = mode.trim().toLowerCase().replace(/[-_\s]/g, "");
    const aliases = new Map([
      ["disable", "disabled"],
      ["disabled", "disabled"],
      ["off", "disabled"],
      ["enable", "enabled"],
      ["enabled", "enabled"],
      ["on", "enabled"],
      ["mute", "muted"],
      ["muted", "muted"],
    ]);
    const normalized = aliases.get(key);
    if (!normalized) {
      throw new Error(`Unknown audible alarm mode: ${mode}`);
    }
    return AUDIBLE_ALARM_MODES[normalized];
  }

  const value = Number(mode);
  if (!Object.values(AUDIBLE_ALARM_MODES).includes(value)) {
    throw new Error(`Audible alarm value must be 1, 2, or 3; got ${mode}.`);
  }
  return value;
}

export async function readReports(device, reportIds = null, { delayMs = 15 } = {}) {
  const idsToRead = resolveReportIds(device, reportIds);
  const reports = new Map();
  const errors = new Map();

  for (const reportId of idsToRead) {
    try {
      const report = await readFeatureReport(device, reportId);
      reports.set(reportId, report);
    } catch (error) {
      errors.set(reportId, error instanceof Error ? error.message : String(error));
    }

    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  return { reports, errors };
}

export async function readSnapshot(device, reportIds = null, options = {}) {
  const { reports, errors } = await readReports(device, reportIds, options);
  const values = mergeDecoded(reports);
  return {
    timestamp: new Date().toISOString(),
    device: deviceToInfo(device),
    values,
    reports: reportsToObject(reports),
    errors: errorsToObject(errors),
    validation: validateValues(values),
  };
}

export function dataViewToBytes(dataView) {
  return [...new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)];
}

export function normalizeReport(reportId, bytesLike, expectedLength = REPORT_LENGTHS.get(reportId)) {
  const bytes = [...bytesLike].map((byte) => Number(byte) & 0xff);
  if (bytes.length === 0) {
    return bytes;
  }
  if (expectedLength && bytes.length === expectedLength - 1) {
    return [reportId, ...bytes];
  }
  if (bytes[0] === reportId) {
    return bytes;
  }
  return [reportId, ...bytes];
}

export function decodeReport(data) {
  if (!data.length) {
    return {};
  }

  const reportId = data[0];
  const out = {};

  if (reportId === 0x01 && data.length >= 2) {
    out.product_string_index = data[1];
  } else if (reportId === 0x02 && data.length >= 2) {
    out.serial_number_string_index = data[1];
  } else if (reportId === 0x03 && data.length >= 2) {
    out.battery_chemistry_string_index = data[1];
  } else if (reportId === 0x04 && data.length >= 2) {
    out.oem_information_string_index = data[1];
  } else if (reportId === 0x05 && data.length >= 2) {
    out.battery_rechargeable = Boolean(data[1]);
    out.battery_rechargeable_raw = data[1];
  } else if (reportId === 0x06 && data.length >= 2) {
    out.battery_capacity_mode = data[1];
    out.battery_capacity_mode_text = enumText(data[1], CAPACITY_MODE_NAMES);
  } else if (reportId === 0x07 && data.length >= 7) {
    out.battery_design_capacity = data[1];
    out.battery_capacity_granularity_1 = data[2];
    out.battery_capacity_granularity_2 = data[3];
    out.battery_warning_capacity_limit = data[4];
    out.battery_remaining_capacity_limit = data[5];
    out.battery_full_charge_capacity = data[6];
  } else if (reportId === 0x08 && data.length >= 6) {
    out.battery_charge_percent = data[1];
    out.battery_runtime_seconds = u16le(data, 2);
    if (out.battery_runtime_seconds !== null) {
      out.battery_runtime_minutes = round(out.battery_runtime_seconds / 60, 1);
    }
    out.report08_extra_u16 = u16le(data, 4);
  } else if (reportId === 0x09 && data.length >= 3) {
    out.config_voltage_v = u16le(data, 1);
  } else if (reportId === 0x0a && data.length >= 3) {
    const raw = u16le(data, 1);
    if (raw !== null) {
      out.power_summary_voltage_v = raw / 10;
      out.battery_voltage_v = raw / 10;
      out.battery_voltage_raw = raw;
    }
  } else if (reportId === 0x0b && data.length >= 2) {
    const flags = data[1];
    out.status_raw = `0x${flags.toString(16).padStart(2, "0").toUpperCase()}`;
    out.ac_present = Boolean(flags & 0x01);
    out.charging = Boolean(flags & 0x02);
    out.discharging = Boolean(flags & 0x04);
    out.below_remaining_capacity_limit = Boolean(flags & 0x08);
    out.fully_charged = Boolean(flags & 0x10);
    out.remaining_time_limit_expired = Boolean(flags & 0x20);
  } else if (reportId === 0x0c && data.length >= 2) {
    out.audible_alarm_control = data[1];
    out.audible_alarm_control_text = enumText(data[1], AUDIBLE_ALARM_NAMES);
  } else if (reportId === 0x0d && data.length >= 2) {
    out.manufacturer_string_index = data[1];
  } else if (reportId === 0x0e && data.length >= 2) {
    out.input_config_voltage_v = data[1];
  } else if (reportId === 0x0f && data.length >= 3) {
    out.input_voltage_v = u16le(data, 1);
  } else if (reportId === 0x10 && data.length >= 5) {
    out.low_voltage_transfer_v = u16le(data, 1);
    out.high_voltage_transfer_v = u16le(data, 3);
  } else if (reportId === 0x12 && data.length >= 3) {
    out.output_voltage_v = u16le(data, 1);
  } else if (reportId === 0x13 && data.length >= 2) {
    out.load_percent = data[1];
  } else if (reportId === 0x14 && data.length >= 2) {
    out.self_test_result = data[1];
    out.self_test_result_text = enumText(data[1], SELF_TEST_NAMES);
  } else if (reportId === 0x15 && data.length >= 3) {
    out.delay_before_shutdown_seconds = i16le(data, 1);
    out.shutdown_countdown_active =
      out.delay_before_shutdown_seconds !== null && out.delay_before_shutdown_seconds >= 0;
  } else if (reportId === 0x16 && data.length >= 3) {
    out.delay_before_startup_seconds = i16le(data, 1);
    out.startup_countdown_active =
      out.delay_before_startup_seconds !== null && out.delay_before_startup_seconds >= 0;
  } else if (reportId === 0x17 && data.length >= 2) {
    const flags = data[1];
    out.output_status_raw = `0x${flags.toString(16).padStart(2, "0").toUpperCase()}`;
    out.boost = Boolean(flags & 0x01);
    out.overload = Boolean(flags & 0x02);
  } else if (reportId === 0x18 && data.length >= 5) {
    out.rating_w = u16le(data, 1);
    out.rating_va = u16le(data, 3);
  } else if (reportId === 0x19 && data.length >= 3) {
    out.load_watt = u16le(data, 1);
  } else if (reportId === 0x1a && data.length >= 2) {
    out.vendor_output_mode = data[1];
  } else if (reportId === 0x1b && data.length >= 2) {
    out.vendor_string_index = data[1];
  } else if (reportId === 0x1c && data.length >= 6) {
    out.vendor_output_load_u16 = u16le(data, 1);
    out.vendor_output_load_u8 = data[3];
    out.vendor_output_load_extra_u16 = u16le(data, 4);
  } else if (reportId === 0x1d && data.length >= 3) {
    out.load_va = u16le(data, 1);
  }

  return out;
}

export function mergeDecoded(reports) {
  const values = {};
  const entries = [...reports.entries()].sort(([left], [right]) => left - right);
  for (const [, report] of entries) {
    Object.assign(values, report.decoded);
  }
  return values;
}

export function validateValues(values) {
  const notes = [];
  const warnings = [];
  let ok = true;

  const has = (name) => Object.prototype.hasOwnProperty.call(values, name) && values[name] !== null;

  if (has("battery_charge_percent")) {
    const value = Number(values.battery_charge_percent);
    if (value < 0 || value > 100) {
      ok = false;
      warnings.push(`battery_charge_percent out of range: ${formatNumber(value)}`);
    } else {
      notes.push(`Battery charge OK: ${formatNumber(value)}%`);
    }
  } else {
    ok = false;
    warnings.push("Missing battery_charge_percent");
  }

  let voltageSeen = false;
  for (const name of ["input_voltage_v", "output_voltage_v"]) {
    if (has(name)) {
      voltageSeen = true;
      const value = Number(values[name]);
      if (value < 80 || value > 260) {
        warnings.push(`${name} unusual: ${formatNumber(value)}`);
      } else {
        notes.push(`${name} OK: ${formatNumber(value)} V`);
      }
    }
  }

  if (!voltageSeen) {
    ok = false;
    warnings.push("Missing input/output voltage");
  }

  if (has("load_percent")) {
    const value = Number(values.load_percent);
    if (value < 0 || value > 150) {
      warnings.push(`load_percent unusual: ${formatNumber(value)}`);
    } else {
      notes.push(`Load OK: ${formatNumber(value)}%`);
    }
  } else {
    warnings.push("Missing load_percent");
  }

  if (has("rating_w") && has("rating_va")) {
    notes.push(`Rating: ${values.rating_va} VA / ${values.rating_w} W`);
  }

  if (has("battery_runtime_minutes")) {
    notes.push(`Runtime: ${values.battery_runtime_minutes} min`);
  }

  return { ok, notes, warnings };
}

export function deviceToInfo(device) {
  const collections = device.collections || [];
  return {
    productName: device.productName || null,
    vendorId: device.vendorId,
    productId: device.productId,
    vidPid: `${hex4(device.vendorId)}:${hex4(device.productId)}`,
    opened: Boolean(device.opened),
    isUpsCandidate: isUpsDeviceCandidate(device),
    isKnownCyberPower: isKnownCyberPowerDevice(device),
    hasPowerUpsCollection: hasPowerUpsCollection(device),
    hasPowerDeviceCollection: hasPowerDeviceCollection(device),
    collections: collections.map(collectionToInfo),
    featureReportIds: getFeatureReportIds(device).map(hexReportId),
    writableSettings: {
      audibleAlarm: supportsAudibleAlarmWrite(device),
    },
  };
}

export function getFeatureReportIds(device) {
  const ids = new Set();
  for (const collection of device.collections || []) {
    collectReportIds(collection, "featureReports", ids);
  }
  return [...ids].sort((a, b) => a - b);
}

export function resolveReportIds(device, requestedReportIds = null) {
  const declaredIds = getFeatureReportIds(device);
  const fallbackIds = declaredIds.length ? declaredIds : ALL_REPORT_IDS;

  if (!requestedReportIds) {
    return fallbackIds;
  }

  const requested = [...requestedReportIds].sort((a, b) => a - b);
  if (!declaredIds.length) {
    return requested;
  }

  const declared = new Set(declaredIds);
  const filtered = requested.filter((reportId) => declared.has(reportId));
  return filtered.length ? filtered : fallbackIds;
}

export function getMonitorReportIds(device) {
  return resolveReportIds(device, MONITOR_REPORT_IDS);
}

export function supportsAudibleAlarmWrite(device) {
  if (!isKnownCyberPowerDevice(device)) {
    return false;
  }

  const featureIds = getFeatureReportIds(device);
  return featureIds.length === 0 || featureIds.includes(0x0c);
}

export function getCollectionUsageText(device) {
  const collections = device.collections || [];
  if (!collections.length) {
    return "--";
  }
  return collections
    .slice(0, 4)
    .map((collection) => `${hex4(collection.usagePage)}:${hex4(collection.usage)}`)
    .join(", ");
}

export function reportsToObject(reports) {
  return Object.fromEntries(
    [...reports.entries()]
      .sort(([left], [right]) => left - right)
      .map(([reportId, report]) => [hexReportId(reportId), report]),
  );
}

export function snapshotFromReportBytes(reportBytes, deviceInfo = {}) {
  const entries = reportBytes instanceof Map ? reportBytes.entries() : Object.entries(reportBytes);
  const reports = new Map();

  for (const [key, rawBytes] of entries) {
    const reportId = Number(key);
    const expectedLength = REPORT_LENGTHS.get(reportId);
    let data = normalizeReport(reportId, rawBytes, expectedLength);
    if (expectedLength && data.length > expectedLength) {
      data = data.slice(0, expectedLength);
    }
    reports.set(reportId, {
      reportId,
      reportIdHex: hexReportId(reportId),
      source: "sample",
      data,
      dataHex: hexBytes(data),
      decoded: decodeReport(data),
    });
  }

  const values = mergeDecoded(reports);
  return {
    timestamp: new Date().toISOString(),
    device: {
      productName: "CyberPower CP1000AVRLCDa",
      vendorId: KNOWN_CYBERPOWER_VENDOR_ID,
      productId: KNOWN_CYBERPOWER_PRODUCT_ID,
      vidPid: `${hex4(KNOWN_CYBERPOWER_VENDOR_ID)}:${hex4(KNOWN_CYBERPOWER_PRODUCT_ID)}`,
      opened: false,
      isUpsCandidate: true,
      isKnownCyberPower: true,
      hasPowerUpsCollection: true,
      hasPowerDeviceCollection: true,
      collections: [
        {
          usagePage: POWER_DEVICE_USAGE_PAGE,
          usage: UPS_USAGE,
          usageText: `${hex4(POWER_DEVICE_USAGE_PAGE)}:${hex4(UPS_USAGE)}`,
          inputReportIds: [],
          outputReportIds: [],
          featureReportIds: ALL_REPORT_IDS.map(hexReportId),
          children: [],
        },
      ],
      featureReportIds: ALL_REPORT_IDS.map(hexReportId),
      writableSettings: {
        audibleAlarm: true,
      },
      ...deviceInfo,
    },
    values,
    reports: reportsToObject(reports),
    errors: {},
    validation: validateValues(values),
  };
}

export function errorsToObject(errors) {
  return Object.fromEntries(
    [...errors.entries()]
      .sort(([left], [right]) => left - right)
      .map(([reportId, error]) => [hexReportId(reportId), error]),
  );
}

export function hexBytes(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function hexReportId(reportId) {
  return `0x${reportId.toString(16).padStart(2, "0").toUpperCase()}`;
}

function collectReportIds(collection, key, ids) {
  for (const report of collection[key] || []) {
    ids.add(report.reportId);
  }
  for (const child of collection.children || []) {
    collectReportIds(child, key, ids);
  }
}

function findCollection(device, predicate) {
  for (const collection of device?.collections || []) {
    const found = findCollectionInTree(collection, predicate);
    if (found) {
      return true;
    }
  }
  return false;
}

function findCollectionInTree(collection, predicate) {
  if (predicate(collection)) {
    return true;
  }
  return (collection.children || []).some((child) => findCollectionInTree(child, predicate));
}

function looksLikeUps(device) {
  const name = String(device?.productName || "").toLowerCase();
  return /\b(ups|uninterruptible|battery backup|power device)\b/.test(name);
}

function collectionToInfo(collection) {
  return {
    usagePage: collection.usagePage,
    usage: collection.usage,
    usageText: `${hex4(collection.usagePage)}:${hex4(collection.usage)}`,
    inputReportIds: (collection.inputReports || []).map((report) => hexReportId(report.reportId)),
    outputReportIds: (collection.outputReports || []).map((report) => hexReportId(report.reportId)),
    featureReportIds: (collection.featureReports || []).map((report) => hexReportId(report.reportId)),
    children: (collection.children || []).map(collectionToInfo),
  };
}

function u16le(data, offset) {
  if (data.length < offset + 2) {
    return null;
  }
  return data[offset] | (data[offset + 1] << 8);
}

function i16le(data, offset) {
  const value = u16le(data, offset);
  if (value === null) {
    return null;
  }
  return value & 0x8000 ? value - 0x10000 : value;
}

function enumText(value, names) {
  return names.get(value) || `unknown(${value})`;
}

function hex4(value) {
  return `0x${Number(value).toString(16).padStart(4, "0").toUpperCase()}`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
