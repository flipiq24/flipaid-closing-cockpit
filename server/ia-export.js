// Fill the MASTER IA xlsx template with live deal numbers WITHOUT corrupting it.
//
// Why not a spreadsheet library:
//   - SheetJS (community) reads cell styles but CANNOT write them -> the export loses all MASTER-IA
//     formatting (blue title, gray bands).
//   - ExcelJS preserves styles but does NOT round-trip this template's extras (5 sheets, 5 drawings,
//     an image, threaded comments) -> it drops drawings 2-5 and re-serializes comments, leaving
//     dangling references, so Excel shows "We found a problem with some content" on open.
//
// So we patch ONLY the IA worksheet's cell values inside the raw .xlsx zip and leave every other
// part byte-for-byte identical. Formatting, drawings, comments, and the other sheets are untouched.
import JSZip from 'jszip';

const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function fillIaTemplate(templateBuf, { values = {}, address = '' } = {}) {
  const zip = await JSZip.loadAsync(templateBuf);

  // Resolve the IA worksheet's XML path (don't hard-code sheet1.xml): workbook.xml maps the sheet
  // name "IA" to an r:id, and workbook.xml.rels maps that r:id to the worksheet file.
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rid = (wbXml.match(/<sheet[^>]*name="IA"[^>]*r:id="([^"]+)"/) || [])[1];
  if (!rid) throw new Error('IA sheet not found in workbook.xml');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = (relsXml.match(new RegExp('<Relationship[^>]*Id="' + rid + '"[^>]*Target="([^"]+)"')) || [])[1];
  if (!target) throw new Error('IA sheet relationship not resolved');
  const sheetPath = 'xl/' + target.replace(/^\/?xl\//, '');

  let xml = await zip.file(sheetPath).async('string');

  const cellRe = ref => new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  const styleOf = attrs => (attrs.match(/\ss="\d+"/) || [''])[0];   // keep the cell's existing style index

  // Numeric write: drop any <f> formula, keep the style, set a static <v>. Excel recomputes any
  // OTHER formulas that reference this cell via fullCalcOnLoad below.
  const setNum = (ref, val) => {
    const n = +val;
    if (val == null || isNaN(n)) return;
    const re = cellRe(ref);
    if (!re.test(xml)) return;
    xml = xml.replace(re, (_m, attrs) => `<c r="${ref}"${styleOf(attrs)}><v>${n}</v></c>`);
  };
  // String write via inline string (avoids touching sharedStrings.xml).
  const setStr = (ref, val) => {
    if (val == null || val === '') return;
    const re = cellRe(ref);
    if (!re.test(xml)) return;
    xml = xml.replace(re, (_m, attrs) => `<c r="${ref}"${styleOf(attrs)} t="inlineStr"><is><t>${escXml(val)}</t></is></c>`);
  };

  if (address) setStr('B2', address);
  for (const [ref, val] of Object.entries(values)) setNum(ref, val);
  zip.file(sheetPath, xml);

  // Force a full recalc on open so any dependent formula we didn't overwrite refreshes from the
  // new inputs (our totals are already injected as static values, so the sheet is correct either way).
  const wb2 = /<calcPr[^>]*\/>/.test(wbXml)
    ? wbXml.replace(/<calcPr([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
    : wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file('xl/workbook.xml', wb2);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
