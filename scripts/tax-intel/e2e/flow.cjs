const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2]; const FILE = process.argv[3];
const T = '3e4bce55-607a-4211-9521-ccc2fe2c66e1';
const B = 'http://127.0.0.1:3000';
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/websocket|realtime|WebSocket/i.test(m.text())) errs.push(m.text()); });
  p.on('response', r => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 160)); });
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  const shot = async (name, full = true) => { await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); log('shot', name); };
  await p.goto(B + '/login', { waitUntil: 'networkidle' });
  await p.fill('input[type=email]', 'dono@beta.teste');
  await p.fill('input[type=password]', 'Teste@123456');
  await p.click('button[type=submit]');
  await p.waitForURL(u => !/login/.test(u.toString()), { timeout: 20000 }); await p.waitForTimeout(1500);
  // 1. painel vazio
  await p.goto(`${B}/t/${T}/tributario`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await shot('01-painel-vazio');
  // 2. importação: arquivo
  await p.goto(`${B}/t/${T}/tributario/importacoes`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await shot('02-importacao-arquivo');
  await p.setInputFiles('input[type=file]', FILE);
  await p.getByText('Qualidade da base').waitFor({ timeout: 30000 }); await p.waitForTimeout(900);
  await shot('03-importacao-validacao');
  // 3. processamento
  const t0 = Date.now();
  await p.getByRole('button', { name: /^Importar .* linhas$/ }).click();
  await p.getByText('Enviar as linhas').waitFor();
  await p.waitForTimeout(700);
  await shot('04-processamento');
  await p.getByText('Importação concluída', { exact: true }).waitFor({ timeout: 300000 });
  log('importação concluída em', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await p.waitForTimeout(900);
  await shot('05-resultado');
  // 4. detalhe da importação
  await p.getByRole('button', { name: 'Ver linhas' }).click();
  await p.getByText('Situação da linha').waitFor(); await p.waitForTimeout(1200);
  await shot('06-detalhe-importacao', false);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  // 5. carteira
  await p.goto(`${B}/t/${T}/tributario/carteira`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await shot('07-carteira');
  const metaTotal = await p.locator('text=relacionamentos').first().innerText();
  log('carteira meta:', metaTotal);
  // busca por CNPJ parcial com máscara
  await p.fill('input[aria-label="Buscar por CNPJ ou nome"]', '90.000.01');
  await p.waitForTimeout(1500);
  log('busca cnpj ->', await p.locator('tbody tr').count(), 'linhas;', await p.locator('text=relacionamentos').first().innerText());
  await p.fill('input[aria-label="Buscar por CNPJ ou nome"]', 'Teste 0042');
  await p.waitForTimeout(1500);
  log('busca nome ->', await p.locator('tbody tr').count(), 'linhas');
  await shot('08-carteira-busca', false);
  await p.fill('input[aria-label="Buscar por CNPJ ou nome"]', '');
  await p.waitForTimeout(1200);
  // filtros
  await p.getByRole('button', { name: 'Fornecedores' }).click(); await p.waitForTimeout(1200);
  log('fornecedores ->', await p.locator('text=relacionamentos').first().innerText());
  await p.getByRole('switch', { name: 'Só CNPJs alfanuméricos' }).click(); await p.waitForTimeout(1200);
  log('fornecedores+alfa ->', await p.locator('text=relacionamentos').first().innerText());
  await shot('09-carteira-filtros', false);
  await p.getByRole('button', { name: 'Limpar filtros' }).first().click(); await p.waitForTimeout(1200);
  // ordenação
  await p.getByRole('button', { name: /^CNPJ/ }).click(); await p.waitForTimeout(1200);
  const first = await p.locator('tbody tr').first().locator('td').nth(1).innerText();
  log('ordenado por CNPJ, primeira linha:', first.replace(/\n/g,' '));
  // seleção em lote
  await p.getByRole('checkbox', { name: 'Selecionar a página' }).click(); await p.waitForTimeout(600);
  await shot('10-carteira-selecao', false);
  const [dl1] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exportar seleção' }).click()]);
  await dl1.saveAs(`${OUT}/export-selecao.xlsx`); log('download seleção', dl1.suggestedFilename());
  await p.getByRole('button', { name: 'Limpar seleção' }).click();
  // exportação do filtro inteiro
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.getByRole('button', { name: 'Exportar Excel' }).click()]);
  await dl2.saveAs(`${OUT}/export-carteira.xlsx`); log('download carteira', dl2.suggestedFilename());
  // detalhe do CNPJ
  await p.locator('tbody tr').nth(2).click();
  await p.getByText('Estrutura do CNPJ').waitFor(); await p.waitForTimeout(1200);
  await shot('11-detalhe-cnpj', false);
  await p.getByRole('tab', { name: 'Consultas' }).click(); await p.waitForTimeout(500);
  await shot('12-detalhe-cnpj-consultas', false);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  // painel preenchido
  await p.goto(`${B}/t/${T}/tributario`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await shot('13-painel');
  // histórico
  await p.goto(`${B}/t/${T}/tributario/importacoes`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await shot('14-historico');
  // tablet e celular
  for (const [w, h, tag] of [[820, 1180, 'tablet'], [390, 844, 'celular']]) {
    await p.setViewportSize({ width: w, height: h });
    for (const [path, name] of [['', 'painel'], ['/carteira', 'carteira'], ['/importacoes', 'importacoes']]) {
      await p.goto(`${B}/t/${T}/tributario${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      log(tag, name, 'overflow horizontal px:', overflow);
      await shot(`15-${tag}-${name}`);
    }
  }
  log('erros de console:', errs.length ? errs.join('\n') : 'nenhum');
  await b.close();
})().catch(e => { console.error('FALHA', e); process.exit(1); });
