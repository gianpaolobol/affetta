export class UnsupportedPrinterAdapter {
  constructor(kind) { this.kind = kind; }
  async probe() {
    throw Object.assign(new Error(`Adattatore ${this.kind} non ancora implementato in P4.3.`), {
      code: 'adapter_not_implemented'
    });
  }
}
