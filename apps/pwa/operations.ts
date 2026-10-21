// Memory only. A promise resolving locally is never treated as a server acknowledgment.
export class Operations {
  private listeners = new Set<() => void>();
  private state = { connected: false, pending: 0, uncertain: false, frozen: false, failures: 0 };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private change(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  connection(connected: boolean) { this.change({ connected }); }
  freeze() {
    if (this.state.pending || this.state.uncertain) return false;
    this.change({ frozen: true });
    return true;
  }
  resume() { this.change({ frozen: false }); }
  reconcile() {
    if (this.state.pending) throw new Error("Wait for pending operations before reviewing results.");
    this.change({ uncertain: false });
  }
  async run<T>(operation: () => Promise<T>, readOnly = false) {
    if (!this.state.connected || this.state.frozen)
      throw new Error("A confirmed connection is required. Reconnect before changing records.");
    if (this.state.uncertain && !readOnly) throw new Error("Review the unconfirmed result before making another change.");
    this.change({ pending: this.state.pending + 1 });
    try {
      return await operation();
    } catch (error) {
      if (!readOnly) this.change({ failures: this.state.failures + 1 });
      const code = String((error as { code?: string })?.code || "");
      if (!code || /unavailable|deadline|network|internal|cancelled|unknown/.test(code))
        this.change({ connected: false, ...(!readOnly ? { uncertain: true } : {}) });
      throw error;
    } finally {
      this.change({ pending: this.state.pending - 1 });
    }
  }
}
export const operations = new Operations();
