# UPS WebHID Dashboard

This is a frontend-only static web project. It reads UPS USB HID feature reports directly through the browser WebHID API and displays battery, voltage, load, status flags, and raw report data in a dashboard. By default it looks for HID Power Device / UPS usage instead of locking to one vendor ID or `0764:0501`.

Chinese documentation is available in [README.md](README.md).

## Highlights

- Static frontend only. No Python, Node.js, backend service, or build step is required.
- Reads UPS data with WebHID `receiveFeatureReport()` and prefers the feature report IDs declared by the selected device.
- Defaults to HID Usage Page `0x0084` / Usage `0x0004`, so different UPS vendors and models can be selected.
- Known compatible CyberPower devices can write `AudibleAlarmControl` with `disabled`, `enabled`, and `muted` modes.
- Ready for GitHub Pages or any static file host.
- Includes `示範資料` sample data mode for checking the UI without hardware.
- Icons are embedded SVGs, so no third-party frontend package or CDN is required.

## Compatibility

- Default filter: HID Usage Page `0x0084` Power Device + Usage `0x0004` UPS
- If a device does not expose the UPS usage correctly, tick `顯示所有 HID` and select it manually; the app will try raw report mode.
- Tested hardware: CyberPower `CP1000AVRLCDa`, VID:PID `0764:0501`
- Different UPS models may use different report IDs and byte layouts; this tool shows readable raw reports and decodes known fields when they match.

## Features

- Request browser permission for a UPS HID device
- Reopen previously granted devices
- Read one snapshot or poll at a fixed interval
- Show battery percentage, runtime, input/output voltage, load, watts, VA, battery voltage, and rated capacity
- Show AC, charging, discharging, fully charged, low capacity, runtime limit, boost, and overload flags
- Write the UPS audible alarm mode on known compatible devices and verify the readback
- Show raw HID report bytes and decoded fields
- Export the current snapshot as JSON

## Screenshots

Desktop:

![UPS WebHID desktop dashboard](docs/assets/img/dashboard-desktop.png)

## Usage

There is no install or build step. Open the page in a WebHID-capable Chromium browser, such as Chrome or Edge, from a secure origin:

- GitHub Pages over `https://`
- Any static file server on `localhost`

Click `連接 UPS`, choose the UPS, and read the values. If the device does not appear, tick `顯示所有 HID` and try again. To change the alarm setting, use a known compatible device, choose a mode, tick the confirmation checkbox, and click `寫入警報設定`. To preview the UI without hardware, click `示範資料` to load a locally generated sample snapshot.

You can also open sample mode directly with:

```text
docs/?demo=1
```

## GitHub Pages

This repository's GitHub Pages configuration:

- Source: `Deploy from a branch`
- Branch: `gh-pages`
- Folder: `/`

The source static page on `main` lives at `docs/index.html`; the deployment branch `gh-pages` contains the same static site at the branch root.

## Privacy and Safety

- WebHID permission is managed by the browser, and the user must explicitly select the device.
- The dashboard has no backend service; read data stays in the current browser page.
- The write path is enabled only for known compatible CyberPower-style `AudibleAlarmControl` reports and requires an explicit on-screen confirmation.
- `示範資料` is a locally generated sample snapshot and does not access hardware.
- `.editorconfig` and `.gitattributes` define UTF-8 text and LF line endings so the Chinese README renders consistently on GitHub and across editors.

## Known CyberPower HID Report Mapping

| Report ID | Data |
| --------: | ---- |
| `0x05` | Rechargeable flag |
| `0x06` | Battery capacity mode |
| `0x07` | Design capacity, full charge capacity, capacity limits |
| `0x08` | Battery capacity and runtime |
| `0x09` | Configured voltage |
| `0x0A` | Battery voltage |
| `0x0B` | UPS status flags |
| `0x0C` | Audible alarm setting, readable/writable |
| `0x0E` | Input configured voltage |
| `0x0F` | Input voltage |
| `0x10` | Low/high transfer voltage |
| `0x12` | Output voltage |
| `0x13` | Load percent |
| `0x14` | Self-test status |
| `0x15` | Shutdown delay countdown |
| `0x16` | Startup delay countdown |
| `0x17` | Boost and overload status |
| `0x18` | Rated power |
| `0x19` | Load watts |
| `0x1D` | Load VA |

## Project Layout

```text
.editorconfig
.gitattributes
docs/
  index.html
  assets/css/styles.css
  assets/img/dashboard-desktop.png
  assets/js/app.js
  assets/js/cyberpower-hid.js
README.md
README.en.md
```

## Windows Troubleshooting

If the UPS cannot be found or opened:

1. Close PowerPanel or any other app that may be using the UPS.
2. Replug the USB cable and confirm Windows Device Manager can see the UPS.
3. Reload the page in Chrome or Edge and click `連接 UPS` again.
4. If the device still does not appear, confirm the page is opened from `https://` or `localhost`.

## References

- [MDN WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API)
- [MDN HID.requestDevice()](https://developer.mozilla.org/en-US/docs/Web/API/HID/requestDevice)
- [MDN HIDDevice.receiveFeatureReport()](https://developer.mozilla.org/en-US/docs/Web/API/HIDDevice/receiveFeatureReport)
- [Chrome for Developers: Connect to uncommon HID devices](https://developer.chrome.com/docs/capabilities/hid)
