// Na Consulta Optantes: preenche o CNPJ pedido pelo TECH-IVA e, quando a
// página mostra o resultado, devolve o texto ao app. Não clica em Consultar e
// não interage com o captcha: a consulta é feita pela pessoa.
(async () => {
  const pedido = await chrome.runtime.sendMessage({ tipo: "pedido" });
  if (!pedido) return;
  const texto = document.body.innerText || "";
  const ehResultado = /Data da consulta:/i.test(texto) && /Regime Regular/i.test(texto);
  const bloqueio = /Impedido por prote[çc][ãa]o Captcha|Informe um CNPJ v[áa]lido/i.test(texto);

  if (ehResultado || bloqueio) {
    await chrome.runtime.sendMessage({ tipo: "resultado", texto });
    if (bloqueio) aviso("O resultado não veio. O TECH-IVA recebeu o aviso; consulte de novo pelo app.");
    return;
  }

  const campo = document.querySelector('input[name="Cnpj"], input#Cnpj, input[type="text"]');
  if (!campo) return aviso("Não encontrei o campo de CNPJ nesta página.");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(campo, pedido.cnpj);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  campo.dispatchEvent(new Event("change", { bubbles: true }));
  const botao = [...document.querySelectorAll("button, input[type=submit]")].find((b) =>
    /consultar/i.test(b.textContent || b.value || ""),
  );
  botao?.focus();
  aviso(`TECH-IVA: CNPJ ${pedido.cnpj} preenchido. Clique em Consultar.`);

  function aviso(t) {
    const d = document.createElement("div");
    d.textContent = t;
    d.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:2147483647;background:#0f172a;color:#fff;" +
      "padding:10px 14px;border-radius:8px;font:14px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.25)";
    document.body.appendChild(d);
  }
})();
