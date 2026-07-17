// O pdf-parse não publica tipos próprios; declaro o mínimo que uso no ai.ts
declare module "pdf-parse" {
  type ResultadoPdf = { text?: string; numpages?: number; info?: Record<string, unknown> };
  function pdfParse(dados: Buffer | Uint8Array, opcoes?: Record<string, unknown>): Promise<ResultadoPdf>;
  export default pdfParse;
}
