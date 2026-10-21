/**
 * Mutex por aba do Chrome.
 *
 * Garante o isolamento (o "I" de ACID): comandos que atuam na mesma aba são
 * serializados, evitando condições de corrida quando a LLM dispara várias
 * ações concorrentes numa mesma aba (ex: preencher formulário e navegar ao
 * mesmo tempo). Abas diferentes podem ser atendidas concorrentemente.
 */

export class TabMutex {
  private busy = new Set<number>();
  private waiters = new Map<number, Array<() => void>>();

  /** Executa `fn` com exclusão mútua em relação a outras chamadas na mesma `tabId`. */
  async run<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(tabId)) {
      await new Promise<void>((resolve) => {
        const list = this.waiters.get(tabId) ?? [];
        list.push(resolve);
        this.waiters.set(tabId, list);
      });
    }

    this.busy.add(tabId);
    try {
      return await fn();
    } finally {
      this.busy.delete(tabId);
      const list = this.waiters.get(tabId);
      if (list && list.length) {
        const next = list.shift()!;
        this.waiters.set(tabId, list);
        next();
      } else {
        this.waiters.delete(tabId);
      }
    }
  }
}
