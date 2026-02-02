import ExcelJS from 'exceljs';

export interface ExcelRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export const utils = {
  book_new: () => new ExcelJS.Workbook(),
  
  json_to_sheet: (data: Record<string, any>[]): { data: Record<string, any>[], headers: string[] } => {
    if (data.length === 0) return { data: [], headers: [] };
    const headers = Object.keys(data[0]);
    return { data, headers };
  },
  
  aoa_to_sheet: (data: any[][]): { aoa: any[][] } => {
    return { aoa: data };
  },
  
  decode_range: (range: string): ExcelRange => {
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!match) {
      return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    }
    const colToNum = (col: string) => {
      let num = 0;
      for (let i = 0; i < col.length; i++) {
        num = num * 26 + col.charCodeAt(i) - 64;
      }
      return num - 1;
    };
    return {
      s: { r: parseInt(match[2]) - 1, c: colToNum(match[1]) },
      e: { r: parseInt(match[4]) - 1, c: colToNum(match[3]) }
    };
  },
  
  encode_cell: (cell: { r: number; c: number }): string => {
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
    return numToCol(cell.c) + (cell.r + 1);
  },
  
  book_append_sheet: (workbook: ExcelJS.Workbook, sheetData: any, name: string) => {
    const worksheet = workbook.addWorksheet(name);
    
    if ('aoa' in sheetData) {
      for (const row of sheetData.aoa) {
        worksheet.addRow(row);
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
        if (col?.wch && worksheet.columns[idx]) {
          worksheet.getColumn(idx + 1).width = col.wch;
        }
      });
    }
    
    return worksheet;
  },
  
  sheet_to_json: <T = Record<string, any>>(worksheet: ExcelJS.Worksheet, options?: { header?: number | string }): T[] => {
    const data: any[] = [];
    const headers: string[] = [];
    
    if (options?.header === 1) {
      worksheet.eachRow((row) => {
        const rowData: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let value = cell.value;
          if (value && typeof value === 'object' && 'result' in value) {
            value = value.result;
          }
          if (value && typeof value === 'object' && 'text' in value) {
            value = value.text;
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
            let value = cell.value;
            if (value && typeof value === 'object' && 'result' in value) {
              value = value.result;
            }
            if (value && typeof value === 'object' && 'text' in value) {
              value = value.text;
            }
            rowData[header] = value;
          }
        });
        if (Object.keys(rowData).length > 0) {
          data.push(rowData as T);
        }
      }
    });
    
    return data as T[];
  }
};

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

export async function read(data: ArrayBuffer | Uint8Array | File): Promise<WorkbookData> {
  const workbook = new ExcelJS.Workbook();
  if (data instanceof File) {
    const buffer = await data.arrayBuffer();
    await workbook.xlsx.load(buffer);
  } else {
    await workbook.xlsx.load(data instanceof ArrayBuffer ? data : data.buffer);
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
