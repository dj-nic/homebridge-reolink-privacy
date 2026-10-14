# Homebridge Reolink Privacy Mode

A single HomeKit switch for the Reolink camera's native Privacy Mode. Communication uses only a local outbound TCP connection from Homebridge to the camera's Baichuan port. It does not use an NVR, video stream, RTSP, ONVIF, or an inbound listener.

## Requirements

- Homebridge 1.8 or newer, Node.js 18 or newer
- Python 3.11 or newer available to the Homebridge service
- Camera account with administrator permissions
- Camera reachable on the local network at TCP port 9000

For a manual installation, install the Python dependency into the same Python environment used by the Homebridge service:

```sh
python3 -m pip install -r requirements.txt
```

For Windows, use `py -3.11 -m pip install -r requirements.txt`, then set `pythonPath` to the full path of that Python 3.11 `python.exe` so Homebridge can launch it directly.

## Install the plugin

### Linux (Debian, Ubuntu, Raspberry Pi OS)

Open a terminal on the Homebridge host and run this one command. It installs the plugin into Homebridge's plugin directory, creates a private Python environment for the bridge dependency, and restarts Homebridge:

```sh
sudo hb-service add https://github.com/dj-nic/homebridge-reolink-privacy.git && sudo -u homebridge python3 -m venv /var/lib/homebridge/reolink-privacy-venv && sudo -u homebridge /var/lib/homebridge/reolink-privacy-venv/bin/python -m pip install -r /var/lib/homebridge/node_modules/homebridge-reolink-privacy/requirements.txt && sudo hb-service restart
```

This command is for the standard Homebridge service installation, which uses `/var/lib/homebridge` and the `homebridge` service account. Python 3.11+ and the `python3-venv` package must be available. After installation, the plugin appears under **Plugins → Installed** in Homebridge UI. In the plugin configuration, set **Python 3.11+ executable** to `/var/lib/homebridge/reolink-privacy-venv/bin/python`, then enter the camera IP, username, and password and save. The switch accessory is published after the platform is configured and Homebridge restarts.

On Windows CMD, open an elevated command prompt and run:

```bat
py -3.11 -m pip install reolink-aio==0.21.17 && npm install -g git+https://github.com/dj-nic/homebridge-reolink-privacy.git
```

On Windows, set `pythonPath` in the platform configuration to the full path of the Python 3.11 `python.exe` used by `py -3.11`.

To install from a local checkout instead, run these commands from the project directory:

```sh
npm install
npm run build
npm pack
```

Install the resulting `.tgz` through Homebridge UI's Plugins page, or run `npm install -g ./homebridge-reolink-privacy-0.1.0.tgz` in the Homebridge environment. Restart Homebridge after installation.

Add the example platform block to Homebridge's `config.json`, replacing the password locally. The Homebridge config necessarily stores that password; this plugin never writes or logs it. Keep the file access-restricted.

## Use and check

The external accessory **Reolink E1 Privacy Mode** appears in Apple Home and can be used in automations. On startup and every configured interval, the plugin queries the camera. HomeKit reads also trigger a live status query. Switching the control writes the native Privacy Mode and reads it back before reporting success.

For a first manual check, add/pair the external accessory in Homebridge UI, read its initial state in Apple Home, switch it on, and confirm that the Reolink app shows Privacy Mode enabled. Switch it off again and confirm the app shows it disabled. Then create the desired HomeKit arrival/departure automation.

If Homebridge reports an unavailable status, check that Python 3.11+, `reolink-aio`, the admin credentials, and TCP 9000 are available from the Homebridge host. The bridge retries/reconnects through `reolink-aio`; if its process exits it is started again at the next status or switch request. No port needs to be opened on the router or exposed to the Internet.

## Camera compatibility

The upstream `reolink-aio` implementation documents Baichuan Privacy Mode commands 574 (read) and 575 (write); its implementation reads back the state after a write. Home Assistant's Reolink integration also uses that library's `privacy_mode()` state and registers for the related push events.

The reported hardware version `IPC_MS4NO24MPW` and the E1 / E1 Pro variant are not individually verified here against a live camera or a firmware compatibility list. A successful TCP connection to port 9000 confirms reachability only. The first live status query is the practical compatibility check; use the Reolink app to recover if the camera rejects or behaves unexpectedly.
