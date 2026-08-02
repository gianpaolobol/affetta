export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters.entries(), ...this.gauges.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  prometheus(): string {
    const lines: string[] = [];
    for (const [name, value] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const metric = sanitize(name);
      lines.push(`# TYPE ${metric} counter`, `${metric} ${value}`);
    }
    for (const [name, value] of [...this.gauges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const metric = sanitize(name);
      lines.push(`# TYPE ${metric} gauge`, `${metric} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function sanitize(value: string): string {
  return `affetta_${value.replace(/[^A-Za-z0-9_:]/g, '_')}`;
}
