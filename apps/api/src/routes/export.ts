import { Router } from 'express';
import ExcelJS from 'exceljs';
import { asyncHandler } from '../lib/errors.js';
import { requireAuthenticated } from '../middleware/session.js';
import { filteredRows, parseFilters } from '../services/listings.js';

export const exportRouter = Router();
exportRouter.use(requireAuthenticated);

const safe = (value: unknown): unknown => typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
const stamp = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

exportRouter.get('/export.xlsx', asyncHandler(async (req, res) => {
  const accountId = req.appSession!.accountId!;
  let rows = await filteredRows(accountId, parseFilters(req.query as Record<string, unknown>));
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
  if (ids.length) rows = rows.filter((row) => ids.includes(row.mlItemId));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MarketSync';
  const main = workbook.addWorksheet('Anúncios', { views: [{ state: 'frozen', ySplit: 1 }] });
  const columns: Array<[string, number]> = [
    ['ID', 20], ['Título', 46], ['SKU', 20], ['Status', 14], ['Preço', 14], ['Preço original', 16], ['Desconto (%)', 14],
    ['Estoque', 12], ['Vendidos', 12], ['Catálogo', 12], ['Categoria', 18], ['Condição', 14], ['Criado em', 20], ['Atualizado em', 20], ['URL', 45], ['Thumbnail', 45],
  ];
  main.columns = columns.map(([header, width]) => ({ header, key: header, width }));
  const variations = workbook.addWorksheet('Variações'); variations.addRow(['ID anúncio', 'ID variação', 'SKU', 'Preço', 'Estoque', 'Vendidos']);
  const attributes = workbook.addWorksheet('Atributos'); attributes.addRow(['ID anúncio', 'ID atributo', 'Nome', 'Valor']);
  const unavailable = workbook.addWorksheet('Indisponibilidades'); unavailable.addRow(['Campo', 'Motivo']);
  unavailable.addRow(['Pix por anúncio', 'Pix pertence ao pagamento/campanha oficial, não é propriedade geral do anúncio.']);
  unavailable.addRow(['Posição orgânica', 'Não há campo geral oficial para a posição individual.']);
  for (const row of rows) {
    main.addRow([safe(row.mlItemId), safe(row.title), safe(row.sku), row.status, row.price, row.originalPrice, row.discountPercent, row.availableQuantity, row.soldQuantity, row.catalogListing ? 'Sim' : 'Não', row.categoryId, row.condition, row.startTime, row.lastUpdated, safe(row.permalink), safe(row.thumbnail)]);
    const vars = JSON.parse(row.variationsJson) as Array<Record<string, any>>;
    vars.forEach((v) => variations.addRow([safe(row.mlItemId), safe(v.id), safe(v.seller_custom_field), v.price, v.available_quantity, v.sold_quantity]));
    const attrs = JSON.parse(row.attributesJson) as Array<Record<string, any>>;
    attrs.forEach((a) => attributes.addRow([safe(row.mlItemId), safe(a.id), safe(a.name), safe(a.value_name)]));
  }
  main.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; main.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF202A37' } };
  main.autoFilter = { from: 'A1', to: 'P1' };
  const info = workbook.addWorksheet('Exportação');
  info.addRows([['Gerado em', new Date()], ['Quantidade', rows.length], ['Conta', 'Somente anúncios da conta autenticada'], ['Observação', 'Dados pesados são exportados como texto/URLs; células potencialmente interpretadas como fórmula foram neutralizadas.']]);
  const filename = `anuncios-mercado-livre-${stamp()}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}));
