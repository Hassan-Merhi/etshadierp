import ExcelJS from 'exceljs';

export interface ExcelRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

const colToNum = (col: string): number => {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + col.charCodeAt(i) - 64;
  }
  return num - 1;
};

const numToCol = (num: number): string => {
  let col = '';
  num++;
  while (num > 0) {
    num--;
    col = String.fromCharCode(65 + (num % 26)) + col;
    num = Math.floor(num / 26);
  }
  return col;
};

const parseOrigin = (origin: string | { r: number; c: number } | undefined): { r: number; c: number } => {
  if (!origin) return { r: 0, c: 0 };
  if (typeof origin === 'object') return origin;
  const m = origin.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { r: 0, c: 0 };
  return { r: parseInt(m[2]) - 1, c: colToNum(m[1]) };
};

export const utils = {
  book_new: () => new ExcelJS.Workbook(),
  
  json_to_sheet: (
    data: Record<string, any>[],
    options?: { header?: string[] }
  ): { data: Record<string, any>[], headers: string[], [key: string]: any } => {
    if (!data || data.length === 0) {
      return { data: [], headers: options?.header ?? [] };
    }
    const headers = options?.header ?? Object.keys(data[0]);
    return { data, headers };
  },
  
  aoa_to_sheet: (data: any[][]): { aoa: any[][], [key: string]: any } => {
    return { aoa: data ?? [] };
  },

  sheet_add_aoa: (
    sheet: { aoa?: any[][] } & Record<string, any>,
    rows: any[][],
    options?: { origin?: string | { r: number; c: number } }
  ) => {
    if (!sheet.aoa) sheet.aoa = [];
    const { r: r0, c: c0 } = parseOrigin(options?.origin);
    rows.forEach((row, ri) => {
      const target = r0 + ri;
      if (!sheet.aoa![target]) sheet.aoa![target] = [];
      row.forEach((val, ci) => {
        sheet.aoa![target][c0 + ci] = val;
      });
    });
    return sheet;
  },

  encode_col: (c: number): string => numToCol(c),

  encode_range: (range: ExcelRange): string => {
    return `${numToCol(range.s.c)}${range.s.r + 1}:${numToCol(range.e.c)}${range.e.r + 1}`;
  },

  decode_range: (range: string): ExcelRange => {
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!match) {
      return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    }
    return {
      s: { r: parseInt(match[2]) - 1, c: colToNum(match[1]) },
      e: { r: parseInt(match[4]) - 1, c: colToNum(match[3]) }
    };
  },
  
  encode_cell: (cell: { r: number; c: number }): string => {
    return numToCol(cell.c) + (cell.r + 1);
  },
  
  book_append_sheet: (workbook: ExcelJS.Workbook, sheetData: any, name: string) => {
    const worksheet = workbook.addWorksheet(name);
    
    if ('aoa' in sheetData) {
      for (const row of sheetData.aoa as any[][]) {
        worksheet.addRow(row || []);
      }
    } else if ('data' in sheetData && 'headers' in sheetData) {
      worksheet.addRow(sheetData.headers);
      for (const item of sheetData.data) {
        const row: any[] = [];
        for (const header of sheetData.headers) {
          row.push(item[header] ?? '');
        }
        worksheet.addRow(row);
      }
    }
    
    if (sheetData['!cols']) {
      sheetData['!cols'].forEach((col: { wch?: number }, idx: number) => {
        if (col?.wch) {
          worksheet.getColumn(idx + 1).width = col.wch;
        }
      });
    }

    if (sheetData['!freeze']) {
      const fz = sheetData['!freeze'];
      worksheet.views = [{
        state: 'frozen',
        xSplit: fz.xSplit ?? 0,
        ySplit: fz.ySplit ?? 0,
      }];
    }
    
    return worksheet;
  },
  
  sheet_to_json: <T = Record<string, any>>(
    worksheet: ExcelJS.Worksheet,
    options?: { header?: number | string; defval?: any }
  ): T[] => {
    const data: any[] = [];
    const headers: string[] = [];
    const defval = options?.defval;
    
    if (options?.header === 1) {
      worksheet.eachRow((row) => {
        const rowData: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let value: any = cell.value;
          if (value && typeof value === 'object' && 'result' in value) {
            value = (value as any).result;
          }
          if (value && typeof value === 'object' && 'text' in value) {
            value = (value as any).text;
          }
          rowData[colNumber - 1] = value;
        });
        data.push(rowData);
      });
      return data as T[];
    }
    
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell, colNumber) => {
          headers[colNumber - 1] = String(cell.value || '');
        });
      } else {
        const rowData: Record<string, any> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            let value: any = cell.value;
            if (value && typeof value === 'object' && 'result' in value) {
              value = (value as any).result;
            }
            if (value && typeof value === 'object' && 'text' in value) {
              value = (value as any).text;
            }
            rowData[header] = value;
          }
        });
        if (defval !== undefined) {
          for (const h of headers) {
            if (h && rowData[h] === undefined) rowData[h] = defval;
          }
        }
        if (Object.keys(rowData).length > 0) {
          data.push(rowData as T);
        }
      }
    });
    
    return data as T[];
  }
};

function binaryStringToArrayBuffer(s: string): ArrayBuffer {
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
  return buf;
}

export async function writeFile(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readFile(file: File): Promise<ExcelJS.Workbook> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

export async function readFromBuffer(data: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data instanceof ArrayBuffer ? data : data.buffer);
  return workbook;
}

export interface WorkbookData {
  workbook: ExcelJS.Workbook;
  SheetNames: string[];
  Sheets: Record<string, ExcelJS.Worksheet>;
}

export async function read(
  data: ArrayBuffer | Uint8Array | File | string | null | undefined,
  _options?: { type?: 'array' | 'binary' | 'buffer' | 'string' }
): Promise<WorkbookData> {
  const workbook = new ExcelJS.Workbook();
  if (data == null) {
    throw new Error('read: no data provided');
  }
  if (typeof File !== 'undefined' && data instanceof File) {
    const buffer = await data.arrayBuffer();
    await workbook.xlsx.load(buffer);
  } else if (typeof data === 'string') {
    await workbook.xlsx.load(binaryStringToArrayBuffer(data));
  } else if (data instanceof ArrayBuffer) {
    await workbook.xlsx.load(data);
  } else {
    await workbook.xlsx.load((data as Uint8Array).buffer as ArrayBuffer);
  }
  
  const SheetNames: string[] = [];
  const Sheets: Record<string, ExcelJS.Worksheet> = {};
  
  workbook.eachSheet((worksheet) => {
    SheetNames.push(worksheet.name);
    Sheets[worksheet.name] = worksheet;
  });
  
  return { workbook, SheetNames, Sheets };
}

export { ExcelJS };
