'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const PLUGIN = 'HomebridgeReolinkPrivacy';

class BaichuanBridge {
  constructor(config, log) { this.config = config; this.log = log; this.pending = new Map(); this.sequence = 0; }
  request(action, enabled) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.child?.kill(); reject(new Error('Baichuan request timed out')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, action, enabled })}\n`, (err) => {
        if (!err) return;
        const entry = this.pending.get(id);
        if (entry) { clearTimeout(entry.timer); this.pending.delete(id); entry.reject(new Error('Could not send request to the Reolink bridge')); }
      });
    });
  }
  close() { this.child?.stdin.end(); this.child?.kill(); this.child = undefined; this.failPending('Reolink bridge stopped'); }
  start() {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    const bridgePath = path.join(__dirname, '..', 'bridge', 'reolink_bridge.py');
    const child = spawn(String(this.config.pythonPath || 'python3'), ['-u', bridgePath], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, HB_REOLINK_HOST: String(this.config.host), HB_REOLINK_PORT: String(this.config.port || 9000), HB_REOLINK_USERNAME: String(this.config.username), HB_REOLINK_PASSWORD: String(this.config.password) },
      windowsHide: true,
    });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (;;) { const newline = buffer.indexOf('\n'); if (newline < 0) break; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); this.handleReply(line); }
    });
    child.on('error', () => {
      if (this.child === child) this.child = undefined;
      this.log.error('Unable to start the Reolink bridge. Check that Python 3.11+ and reolink-aio are installed.');
      this.failPending('Reolink bridge could not start');
    });
    child.on('exit', () => { if (this.child === child) this.child = undefined; this.failPending('Reolink bridge disconnected; it will restart on the next request'); });
  }
  handleReply(line) {
    let reply;
    try { reply = JSON.parse(line); } catch { this.log.error('Invalid response from the Reolink bridge.'); return; }
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    clearTimeout(entry.timer); this.pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply.enabled); else entry.reject(new Error(reply.error));
  }
  failPending(message) {
    for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error(message)); this.pending.delete(id); }
  }
}

class ReolinkPrivacyPlatform {
  constructor(log, config, api) {
    this.log = log; this.config = config; this.api = api; this.bridge = new BaichuanBridge(config, log); this.currentState = false; this.busy = false;
    const name = String(config.cameraName || 'Reolink Privacy Mode');
    const uuid = api.hap.uuid.generate(`HomebridgeReolinkPrivacy:${String(config.host)}:${String(config.port || 9000)}`);
    this.accessory = new api.platformAccessory(name, uuid);
    this.service = this.accessory.getService(api.hap.Service.Switch) || this.accessory.addService(api.hap.Service.Switch, name);
    this.onCharacteristic = this.service.getCharacteristic(api.hap.Characteristic.On);
    this.onCharacteristic.onGet(() => this.readState());
    this.onCharacteristic.onSet((value) => this.writeState(Boolean(value)));
    api.publishExternalAccessories('HomebridgeReolinkPrivacy', [this.accessory]);
    const interval = Math.min(300, Math.max(10, Number(config.pollIntervalSeconds) || 30));
    this.poller = setInterval(() => { void this.refresh(); }, interval * 1000);
    api.on('shutdown', () => { clearInterval(this.poller); this.bridge.close(); });
    void this.refresh();
  }
  async readState() { this.currentState = await this.bridge.request('get'); return this.currentState; }
  async writeState(enabled) { this.currentState = await this.bridge.request('set', enabled); this.onCharacteristic.updateValue(this.currentState); }
  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try { this.currentState = await this.bridge.request('get'); this.onCharacteristic.updateValue(this.currentState); }
    catch (error) { this.log.error(`Privacy Mode status unavailable (${error instanceof Error ? error.message : 'unknown error'}).`); }
    finally { this.busy = false; }
  }
}
module.exports = { ReolinkPrivacyPlatform };
