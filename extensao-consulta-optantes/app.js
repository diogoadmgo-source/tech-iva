// No TECH-IVA: avisa a página que a extensão está instalada e faz a ponte das
// mensagens (pedido de consulta → extensão; resultado → página).
const ORIGEM_APP = "techiva-app";
const ORIGEM_EXT = "techiva-consulta-optantes";

function anunciar() {
  window.postMessage({ source: ORIGEM_EXT, tipo: "pronta", versao: chrome.runtime.getManifest().version }, location.origin);
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== ORIGEM_APP) return;
  if (m.tipo === "ping") anunciar();
  if (m.tipo === "consultar" && typeof m.cnpj === "string" && /^[0-9A-Z]{14}$/.test(m.cnpj))
    chrome.runtime.sendMessage({ tipo: "consultar", cnpj: m.cnpj, requestId: String(m.requestId) });
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.tipo === "resultado")
    window.postMessage(
      { source: ORIGEM_EXT, tipo: "resultado", requestId: m.requestId, cnpj: m.cnpj, texto: m.texto },
      location.origin,
    );
});

anunciar();
