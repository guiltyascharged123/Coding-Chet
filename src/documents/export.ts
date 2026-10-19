import type { Cell, Sheet } from 'write-excel-file/universal';

export type Block =
  | { kind: 'heading' | 'paragraph' | 'list' | 'quote' | 'code'; text: string; level?: number }
  | { kind: 'table'; title: string; rows: string[][] };
export function plain(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\\([|*_`])/g, '$1');
}
function tableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((value) => plain(value.trim()));
}
export function parseDocument(content: string): Block[] {
  const lines = content.replace(/\r/g, '').split('\n'),
    blocks: Block[] = [];
  let title = 'Table';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*(?:---+|\*\*\*+)\s*$/.test(line)) continue;
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      title = plain(heading[2]);
      blocks.push({ kind: 'heading', text: title, level: heading[1].length });
      continue;
    }
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1])
    ) {
      const rows = [tableRow(line)];
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim())
        rows.push(tableRow(lines[++i]));
      blocks.push({ kind: 'table', title, rows });
      continue;
    }
    const list = /^\s*(?:[-*+] |\d+\. )(.+)$/.exec(line);
    blocks.push({
      kind: list ? 'list' : line.startsWith('>') ? 'quote' : 'paragraph',
      text: plain(list ? list[1] : line.replace(/^>\s?/, '')),
    });
  }
  return blocks;
}
export function filename(title: string, extension: string) {
  return `${
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'workroom-document'
  }.${extension}`;
}
export async function wordDocument(title: string, content: string): Promise<Blob> {
  const {
    Document,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    HeadingLevel,
    Packer,
    Footer,
    PageNumber,
  } = await import('docx');
  const children = parseDocument(content).map((block) => {
    if (block.kind === 'table')
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row, index) =>
            new TableRow({
              tableHeader: index === 0,
              children: row.map(
                (value) =>
                  new TableCell({
                    shading: index === 0 ? { fill: '344654' } : undefined,
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: value,
                            bold: index === 0,
                            color: index === 0 ? 'FFFFFF' : '26333D',
                            size: 22,
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            }),
        ),
      });
    return new Paragraph({
      ...(block.kind === 'heading'
        ? {
            heading:
              block.level === 1
                ? HeadingLevel.HEADING_1
                : block.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
          }
        : {}),
      ...(block.kind === 'list' ? { bullet: { level: 0 } } : {}),
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: block.text,
          ...(block.kind === 'code' ? { font: 'Consolas', size: 20 } : {}),
          ...(block.kind === 'quote' ? { italics: true, color: '5A6771' } : {}),
        }),
      ],
    });
  });
  return Packer.toBlob(
    new Document({
      title,
      creator: 'Workroom',
      description: 'Editable office document exported from Workroom',
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 24, color: '26333D' },
            paragraph: { spacing: { after: 160 } },
          },
        },
      },
      sections: [
        {
          properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun('Workroom · '),
                    new TextRun({ children: [PageNumber.CURRENT] }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    }),
  );
}
function numericCell(text: string): Cell {
  // Never turn model/user text beginning with '=' into an executable formula.
  // Only strictly numeric values become number cells. IDs and leading zeros stay text.
  const value = text.trim();
  const numeric = /^-?(?:\$\s*)?(?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d+)?$/.test(value);
  if (!numeric) return { value: text, type: String, wrap: true };
  return {
    value: Number(value.replace(/[$,\s]/g, '')),
    type: Number,
    ...(value.includes('$') ? { format: '"$"#,##0.00' } : {}),
    wrap: true,
  };
}
export function workbookSheets(title: string, content: string): Sheet<Blob>[] {
  const blocks = parseDocument(content),
    names = new Set(['read me']);
  const intro: Cell[][] = [
    [{ value: title, fontWeight: 'bold', fontSize: 18, textColor: '#26333D' }],
    ['Exported from Workroom. Validate estimates, assumptions, and approval status before use.'],
    ['Each document table has its own editable sheet. Text beginning with = remains text.'],
    [
      'Budget tables with numeric Quantity and Unit cost have calculated line totals and a total estimate.',
    ],
    [],
  ];
  for (const block of blocks)
    if (block.kind !== 'table')
      intro.push([
        {
          value: block.text,
          wrap: true,
          ...(block.kind === 'heading' ? { fontWeight: 'bold' as const } : {}),
        },
      ]);
  const sheets: Sheet<Blob>[] = [{ sheet: 'Read me', data: intro, columns: [{ width: 110 }] }];
  for (const block of blocks) {
    if (block.kind !== 'table') continue;
    const base =
      block.title
        .replace(/[\\/?*\[\]:]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .trim()
        .slice(0, 27) || 'Table';
    let sheet = base,
      index = 2;
    while (names.has(sheet.toLowerCase())) sheet = `${base.slice(0, 25)} ${index++}`;
    names.add(sheet.toLowerCase());
    const headers = block.rows[0],
      q = headers.findIndex((h) => /^quantity$/i.test(h)),
      u = headers.findIndex((h) => /^unit cost$/i.test(h)),
      t = headers.findIndex((h) => /^estimated total$/i.test(h));
    const col = (n: number) => {
      let name = '';
      for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26))
        name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
      return name;
    };
    const isBudget = q >= 0 && u >= 0 && t >= 0;
    let formulaCount = 0;
    const data: Cell[][] = block.rows.map((row, r) =>
      headers.map((_, c) => {
        if (r === 0)
          return {
            value: row[c] || '',
            fontWeight: 'bold',
            backgroundColor: '#344654',
            textColor: '#FFFFFF',
            wrap: true,
          };
        if (
          isBudget &&
          c === t &&
          typeof (numericCell(row[q] || '') as { value: unknown }).value === 'number' &&
          typeof (numericCell(row[u] || '') as { value: unknown }).value === 'number'
        ) {
          formulaCount++;
          return {
            type: 'Formula',
            value: `${col(q)}${r + 1}*${col(u)}${r + 1}`,
            format: row[u]?.includes('$') ? '"$"#,##0.00' : '#,##0.00',
          };
        }
        return numericCell(row[c] || '');
      }),
    );
    if (isBudget && formulaCount === data.length - 1 && formulaCount > 0) {
      const total: Cell[] = headers.map(() => null);
      total[0] = { value: 'Total estimate', fontWeight: 'bold' };
      total[t] = {
        type: 'Formula',
        value: `SUM(${col(t)}2:${col(t)}${data.length})`,
        fontWeight: 'bold',
        format: block.rows.some((r) => r[u]?.includes('$')) ? '"$"#,##0.00' : '#,##0.00',
      };
      data.push(total);
    }
    sheets.push({
      sheet,
      data,
      columns: headers.map((h) => ({ width: Math.min(65, Math.max(20, h.length + 3)) })),
      stickyRowsCount: 1,
    });
  }
  return sheets;
}
export async function workbookDocument(title: string, content: string): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  return writeExcelFile(workbookSheets(title, content), {
    fontFamily: 'Calibri',
    fontSize: 12,
  }).toBlob();
}
