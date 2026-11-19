// Liga a aba do TECH-IVA à aba da Consulta Optantes. Não guarda nada além do
// pedido em andamento (CNPJ e abas), na memória de sessão do navegador.
const URL_RECEITA = "https://consopt.www8.receita.fazenda.gov.br/consultaoptantes";

async function getState() {
  return (await chrome.storage.session.get("estado")).estado ?? {};
}
async function setState(s) {
  await chrome.storage.session.set({ estado: s });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const s = await getState();
    if (msg.tipo === "consultar" && sender.tab) {
      const pedido = { cnpj: String(msg.cnpj), requestId: String(msg.requestId), appTab: sender.tab.id };
      let tabId = s.receitaTab;
      try {
        if (tabId != null) await chrome.tabs.update(tabId, { url: URL_RECEITA, active: true });
        else throw new Error("sem aba");
      } catch {
        const t = await chrome.tabs.create({ url: URL_RECEITA, index: sender.tab.index + 1 });
        tabId = t.id;
      }
      await setState({ receitaTab: tabId, pedido });
      reply({ ok: true });
    } else if (msg.tipo === "pedido" && sender.tab) {
      reply(sender.tab.id === s.receitaTab ? (s.pedido ?? null) : null);
    } else if (msg.tipo === "resultado" && sender.tab && sender.tab.id === s.receitaTab && s.pedido) {
      const p = s.pedido;
      await chrome.tabs.sendMessage(p.appTab, { tipo: "resultado", requestId: p.requestId, cnpj: p.cnpj, texto: msg.texto });
      await setState({ receitaTab: s.receitaTab, pedido: null });
      // Volta para o TECH-IVA; a aba da Receita fica aberta para a próxima consulta.
      await chrome.tabs.update(p.appTab, { active: true }).catch(() => {});
      reply({ ok: true });
    } else {
      reply(null);
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (tabId === s.receitaTab) await setState({});
});
