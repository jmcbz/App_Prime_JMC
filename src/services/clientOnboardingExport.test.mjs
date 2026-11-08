import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {JSDOM} from 'jsdom';
import ExcelJS from 'exceljs';
import {CLIENT_ONBOARDING_TEMPLATE,createTemplateItems} from './clientOnboardingService.ts';

const outfile = new URL('./.onboarding-export-test.mjs', import.meta.url).pathname;
let buildOnboardingPdf, exportOnboardingPdf, exportOnboardingXlsx;
try {
  await build({entryPoints: [new URL('./clientOnboardingExport.ts', import.meta.url).pathname], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', define: {'import.meta.env.BASE_URL': '"/"'}});
  ({buildOnboardingPdf, exportOnboardingPdf, exportOnboardingXlsx} = await import(outfile));
} finally { await unlink(outfile).catch(() => {}); }

test('PDF abort after font load prevents the final save', async () => {
  const mockFile = new URL('./.onboarding-export-pdf-abort-test.mjs', import.meta.url).pathname;
  await build({entryPoints: [new URL('./clientOnboardingExport.ts', import.meta.url).pathname], outfile: mockFile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', define: {'import.meta.env.BASE_URL': '"/"'},
    plugins: [{name: 'pdf-save-spy', setup(plugin) {
      plugin.onResolve({filter: /^jspdf$/}, () => ({path: 'jspdf', namespace: 'spy'}));
      plugin.onLoad({filter: /.*/, namespace: 'spy'}, () => ({loader: 'js', contents: `export class jsPDF {
        constructor() {this.internal = {pageSize: {getWidth: () => 200, getHeight: () => 280}};}
        addFileToVFS() {} addFont() {} setFont() {} setFontSize() {} splitTextToSize(s) {return [s];}
        text() {} getNumberOfPages() {return 1;} setPage() {} save() {globalThis.__pdfSaves++;}
      }`}));
    }}]});
  const oldFetch = globalThis.fetch;
  const font = await readFile(new URL('../../public/fonts/DejaVuSans.ttf', import.meta.url));
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const abort = new AbortController();
  globalThis.__pdfSaves = 0;
  globalThis.fetch = async () => {await gate; return new Response(font);};
  try {
    const {exportOnboardingPdf: exportPdf} = await import(mockFile);
    const task = exportPdf({client_id: 1, compte_rendu: {}}, [], 'Secret A', abort.signal);
    abort.abort(); release();
    await assert.rejects(task, error => error?.name === 'AbortError');
    assert.equal(globalThis.__pdfSaves, 0);
  } finally {globalThis.fetch = oldFetch; delete globalThis.__pdfSaves; await unlink(mockFile).catch(() => {});}
});

test('Excel abort while writing buffer prevents the final download', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
  const oldDocument = globalThis.document, oldURL = globalThis.URL;
  let release, downloads = 0;
  const gate = new Promise(resolve => {release = resolve;});
  const abort = new AbortController();
  // Workbook instances create their own XLSX object; intercept its shared writer.
  const workbook = new ExcelJS.Workbook();
  const proto = Object.getPrototypeOf(workbook.xlsx);
  const writeBuffer = proto.writeBuffer;
  proto.writeBuffer = async function () {await gate; return new Uint8Array([1, 2, 3]);};
  globalThis.document = dom.window.document;
  globalThis.URL = {createObjectURL: () => {downloads++; return 'blob:test';}, revokeObjectURL: () => {}};
  try {
    const task = exportOnboardingXlsx({client_id: 1, compte_rendu: {}}, [], 'Secret A', abort.signal);
    abort.abort(); release();
    await assert.rejects(task, error => error?.name === 'AbortError');
    assert.equal(downloads, 0);
  } finally {proto.writeBuffer = writeBuffer; globalThis.document = oldDocument; globalThis.URL = oldURL; dom.window.close();}
});

test('PDF conserve les accents français, apostrophes et texte client Unicode extractibles', async () => {
  const previousFetch = globalThis.fetch;
  const font = await readFile(new URL('../../public/fonts/DejaVuSans.ttf', import.meta.url));
  globalThis.fetch = async () => new Response(font, {status: 200});
  const file = join(process.env.TMPDIR || '/root/.hermes/cache/scratch', `onboarding-unicode-${process.pid}.pdf`);
  try {
    const pdf = await buildOnboardingPdf({client_id: 1, technicien_id: 2, titre: 'Évaluation d’accès – Québec', statut: 'À faire', priorite: 'Haute', technicien_nom: 'Élodie Noël', compte_rendu: {resume_executif: 'Réunion à Montréal – confidentialité'}}, [], 'Société Énergie & Œuvres');
    await writeFile(file, Buffer.from(pdf.output('arraybuffer')));
    const extracted = execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', '-sOutputFile=-', file], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    for (const expected of ['Société Énergie & Œuvres', 'Élodie Noël', 'Québec', 'Réunion à Montréal']) assert.ok(extracted.includes(expected), `${expected} absent from ${extracted}`);
  } finally { globalThis.fetch = previousFetch; await unlink(file).catch(() => {}); }
});

test('XLSX and PDF retain the canonical 123-item checklist order',async()=>{
  const items=createTemplateItems();
  assert.equal(items.length,123);
  const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/'});
  const oldDocument=globalThis.document,oldURL=globalThis.URL,oldFetch=globalThis.fetch,oldWindow=globalThis.window;
  globalThis.window=dom.window;
  const font=await readFile(new URL('../../public/fonts/DejaVuSans.ttf',import.meta.url));
  let exported;
  globalThis.document=dom.window.document;
  dom.window.HTMLAnchorElement.prototype.click=()=>{};
  globalThis.URL={createObjectURL:blob=>{exported=blob;return 'blob:test';},revokeObjectURL:()=>{}};
  globalThis.fetch=async()=>new Response(font,{status:200});
  const file=join(process.env.TMPDIR||'/root/.hermes/cache/scratch',`onboarding-order-${process.pid}.pdf`);
  try {
    await exportOnboardingXlsx({client_id:1,compte_rendu:{}},items,'Client');
    assert(exported instanceof Blob);
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    const rows=workbook.getWorksheet('Checklist').getRows(2,123);
    assert.deepEqual(rows.map(row=>[row.getCell(1).value,row.getCell(5).value]),items.map(item=>[item.section_title,item.element]));
    const pdf=await buildOnboardingPdf({client_id:1,compte_rendu:{}},items,'Client');
    await writeFile(file,Buffer.from(pdf.output('arraybuffer')));
    const text=execFileSync('gs',['-q','-dNOPAUSE','-dBATCH','-sDEVICE=txtwrite','-sOutputFile=-',file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const positions=CLIENT_ONBOARDING_TEMPLATE.map(section=>text.indexOf(section.title));
    assert(positions.every(position=>position>=0),`Missing section in PDF: ${positions}`);
    assert(positions.every((position,index)=>index===0||position>positions[index-1]),'PDF sections changed order');
  }finally{
    globalThis.document=oldDocument;globalThis.URL=oldURL;globalThis.fetch=oldFetch;globalThis.window=oldWindow;
    dom.window.close();await unlink(file).catch(()=>{});
  }
});
