import { spawn } from 'node:child_process';
import path from 'node:path';
import type { API, Characteristic, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

const PLUGIN = 'HomebridgeReolinkPrivacy';
type Command = { id: number; action: 'get' | 'set'; enabled?: boolean };
type Reply = { id: number; ok: true; enabled: boolean } | { id: number; ok: false; error: string };

class BaichuanBridge {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (value: boolean) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly config: PlatformConfig, private readonly log: Logger) {}

  request(action: 'get' | 'set', enabled?: boolean): Promise<boolean> {
    this.start();
    const id = ++this.sequence;
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.child?.kill();
        reject(new Error('Baichuan request timed out'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      const command: Command = { id, action, enabled };
      this.child!.stdin.write(`${JSON.stringify(command)}\n`, (err) => {
        if (!err) return;
        const entry = this.pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.reject(new Error('Could not send request to the Reolink bridge'));
        }
      });
    });
  }

  close(): void {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = undefined;
    this.failPending('Reolink bridge stopped');
  }

  private start(): void {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    const bridgePath = path.join(__dirname, '..', 'bridge', 'reolink_bridge.py');
    const pythonPath = String(this.config.pythonPath || 'python3');
    const child = spawn(pythonPath, ['-u', bridgePath], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...process.env,
        HB_REOLINK_HOST: String(this.config.host),
        HB_REOLINK_PORT: String(this.config.port || 9000),
        HB_REOLINK_USERNAME: String(this.config.username),
        HB_REOLINK_PASSWORD: String(this.config.password),
      },
      windowsHide: true,
    });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        this.handleReply(line);
      }
    });
    child.on('error', () => {
      this.log.error('Unable to start the Reolink bridge. Check that Python 3.11+ and reolink-aio are installed.');
      this.failPending('Reolink bridge could not start');
    });
    child.on('exit', () => {
      if (this.child === child) this.child = undefined;
      this.failPending('Reolink bridge disconnected; it will restart on the next request');
    });
  }

  private handleReply(line: string): void {
    let reply: Reply;
    try {
      reply = JSON.parse(line) as Reply;
    } catch {
      this.log.error('Invalid response from the Reolink bridge.');
      return;
    }
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply.enabled);
    else entry.reject(new Error(reply.error));
  }

  private failPending(message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
      this.pending.delete(id);
    }
  }
}

export class ReolinkPrivacyPlatform {
  private readonly bridge: BaichuanBridge;
  private readonly accessory: PlatformAccessory;
  private readonly service: Service;
  private readonly onCharacteristic: Characteristic;
  private currentState = false;
  private poller?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly log: Logger, config: PlatformConfig, private readonly api: API) {
    this.bridge = new BaichuanBridge(config, log);
    const name = String(config.cameraName || 'Reolink Privacy Mode');
    const uuid = api.hap.uuid.generate(`${PLUGIN}:${String(config.host)}:${String(config.port || 9000)}`);
    this.accessory = new api.platformAccessory(name, uuid);
    this.service = this.accessory.getService(api.hap.Service.Switch)
      || this.accessory.addService(api.hap.Service.Switch, name);
    this.onCharacteristic = this.service.getCharacteristic(api.hap.Characteristic.On);
    this.onCharacteristic.onGet(() => this.readState());
    this.onCharacteristic.onSet((value) => this.writeState(Boolean(value)));
    api.publishExternalAccessories(PLUGIN, [this.accessory]);
    const interval = Math.min(300, Math.max(10, Number(config.pollIntervalSeconds) || 30));
    this.poller = setInterval(() => { void this.refresh(); }, interval * 1000);
    api.on('shutdown', () => {
      if (this.poller) clearInterval(this.poller);
      this.bridge.close();
    });
    void this.refresh();
  }

  private async readState(): Promise<boolean> {
    this.currentState = await this.bridge.request('get');
    return this.currentState;
  }

  private async writeState(enabled: boolean): Promise<void> {
    // set_privacy_mode is followed by a real get (574) in reolink-aio; publish only the returned state.
    this.currentState = await this.bridge.request('set', enabled);
    this.onCharacteristic.updateValue(this.currentState);
  }

  private async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.currentState = await this.bridge.request('get');
      this.onCharacteristic.updateValue(this.currentState);
    } catch (error) {
      this.log.error(`Privacy Mode status unavailable (${this.safeError(error)}).`);
    } finally {
      this.busy = false;
    }
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
