export class MockPrinterAdapter {
  constructor({ snapshots = new Map() } = {}) { this.snapshots = snapshots; }

  setSnapshot(printerId, snapshot) { this.snapshots.set(printerId, snapshot); }

  async probe(printer) {
    const configured = this.snapshots.get(printer.id) || printer.options?.mock_snapshot;
    if (!configured) {
      return {
        connection_status: 'connected', machine_status: 'ready', job_status: 'none',
        phase: 'Mock adapter pronto.', server_dependency: 'not_applicable', raw: { mock: true }
      };
    }
    if (configured.throw) {
      const error = new Error(configured.throw.message || 'Mock non raggiungibile.');
      error.code = configured.throw.code || 'printer_unreachable';
      throw error;
    }
    return structuredClone(configured);
  }
}
