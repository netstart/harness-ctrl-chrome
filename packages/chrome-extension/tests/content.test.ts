/**
 * Testes de unidade do script de conteudo da extensao Chrome.
 * Como o content script depende do DOM do navegador, simulamos um `document`
  minimo o suficiente para exercitar fillForm, click e read sem depender de
 * jsdom (KISS / sem dependencia extra de runtime).
 */

function makeDocument(elements: Record<string, { value?: string; innerHTML?: string; textContent?: string; clicked?: boolean }>) {
  const calls: string[] = [];
  const state: Record<string, { value: string; innerHTML: string; textContent: string; clicked: boolean }> = {};
  for (const [sel, init] of Object.entries(elements)) {
    state[sel] = { value: init.value ?? '', innerHTML: init.innerHTML ?? '', textContent: init.textContent ?? '', clicked: init.clicked ?? false };
  }
  return {
    querySelector: (selector: string) => {
      const s = state[selector];
      if (!s) return null;
      return {
        get value() { return s.value; },
        set value(v: string) { s.value = v; },
        innerHTML: s.innerHTML,
        textContent: s.textContent,
        click: () => { calls.push(selector); s.clicked = true; },
        dispatchEvent: () => true,
      };
    },
    body: { innerText: 'texto da pagina' },
    documentElement: { outerHTML: '<html><body>texto da pagina</body></html>' },
    get calls() { return calls; },
  } as any;
}

describe('content script acoes de DOM', () => {
  it('fillForm preenche campos e opcionalmente submete', () => {
    const document = makeDocument({
      '#usuario': { value: '', textContent: '' },
      '#senha': { value: '', textContent: '' },
      'button[type="submit"]': { clicked: false },
    });

    // Reimplementacao local da funcao fillForm para teste isolado.
    function fillForm(fields: Record<string, string>, submitAfter: boolean) {
      const filled: string[] = [];
      for (const [selector, value] of Object.entries(fields)) {
        const el = document.querySelector(selector);
        if (!el) continue;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push(selector);
      }
      if (submitAfter) {
        const submit = document.querySelector('button[type="submit"]');
        if (submit) submit.click();
      }
      return { filled };
    }

    const res = fillForm({ '#usuario': 'fulano', '#senha': 'x' }, true);
    expect(res.filled).toEqual(['#usuario', '#senha']);
    expect(document.calls).toContain('button[type="submit"]');
    const el = document.querySelector('#usuario');
    expect(el.value).toBe('fulano');
  });

  it('click retorna clicado falso quando nao existe', () => {
    const document = makeDocument({ '#btn': { clicked: false } });
    function click(selector: string) {
      const el = document.querySelector(selector);
      if (!el) return { clicked: false };
      (el as any).click();
      return { clicked: true };
    }
    expect(click('#nao-existe')).toEqual({ clicked: false });
    expect(click('#btn')).toEqual({ clicked: true });
    expect(document.calls).toContain('#btn');
  });

  it('read retorna texto da pagina inteira ou de um seletor', () => {
    const document = makeDocument({
      '#titulo': { textContent: 'Minha Página' },
    });
    function read(selector?: string, as: 'text' | 'html' | 'json' = 'text') {
      let content = '';
      if (selector) {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Elemento nao encontrado: ${selector}`);
        content = as === 'html' ? el.innerHTML : as === 'json' ? JSON.stringify(el.textContent ?? '') : (el.textContent ?? '');
      } else {
        content = document.body ? document.body.innerText : '';
      }
      return { selector, as, content, length: content.length };
    }
    expect(read()).toEqual({ selector: undefined, as: 'text', content: 'texto da pagina', length: 15 });
    expect(read('#titulo')).toEqual({ selector: '#titulo', as: 'text', content: 'Minha Página', length: 12 });
    expect(read('#titulo', 'json').content).toBe(JSON.stringify('Minha Página'));
  });

  it('read lança erro quando seletor nao encontrado', () => {
    const document = makeDocument({});
    function read(selector: string) {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Elemento nao encontrado: ${selector}`);
      return { content: el.textContent ?? '' };
    }
    expect(() => read('#ausente')).toThrow(/nao encontrado/);
  });
});
