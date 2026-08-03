import { MockPrinterAdapter } from './adapters/mock.js';
import { MoonrakerAdapter } from './adapters/moonraker.js';
import { OctoPrintAdapter } from './adapters/octoprint.js';
import { UnsupportedPrinterAdapter } from './adapters/unsupported.js';

export class AdapterRegistry {
  constructor({ timeoutMs = 5000, fetchImpl = fetch, mockSnapshots } = {}) {
    this.adapters = new Map([
      ['mock', new MockPrinterAdapter({ snapshots: mockSnapshots })],
      ['moonraker', new MoonrakerAdapter({ timeoutMs, fetchImpl })],
      ['octoprint', new OctoPrintAdapter({ timeoutMs, fetchImpl })],
      ['bambu-lan', new UnsupportedPrinterAdapter('bambu-lan')],
      ['snapmaker-lan', new UnsupportedPrinterAdapter('snapmaker-lan')]
    ]);
  }

  get(kind) {
    return this.adapters.get(kind) || new UnsupportedPrinterAdapter(kind);
  }

  set(kind, adapter) { this.adapters.set(kind, adapter); }
}
