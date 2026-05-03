import ExcelJS from 'exceljs';

export interface ExcelWorkbook {
  workbook: ExcelJS.Workbook;
  SheetNames: string[];
  Sheets: Record<string, ExcelJS.Worksheet>;
}

export async function readExcel(buffer: Buffer): Promise<ExcelWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  
  const SheetNames: string[] = [];
  const Sheets: Record<string, ExcelJS.Worksheet> = {};
  
  workbook.eachSheet((worksheet) => {
    SheetNames.push(worksheet.name);
    Sheets[worksheet.name] = worksheet;
  });
  
  return { workbook, SheetNames, Sheets };
}

export function sheetToJson<T = Record<string, any>>(worksheet: ExcelJS.Worksheet): T[] {
  const data: T[] = [];
  const headers: string[] = [];
  
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
      if (Object.keys(rowData).length > 0) {
        data.push(rowData as T);
      }
    }
  });
  
  return data;
}

export function createWorkbook(): ExcelJS.Workbook {
  return new ExcelJS.Workbook();
}

export function jsonToSheet(workbook: ExcelJS.Workbook, data: Record<string, any>[], sheetName: string): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(sheetName);
  
  if (data.length === 0) {
    return worksheet;
  }
  
  const headers = Object.keys(data[0]);
  worksheet.addRow(headers);
  
  for (const item of data) {
    const row: any[] = [];
    for (const header of headers) {
      row.push(item[header] ?? '');
    }
    worksheet.addRow(row);
  }
  
  return worksheet;
}

export function aoaToSheet(workbook: ExcelJS.Workbook, data: any[][], sheetName: string): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(sheetName);
  
  for (const row of data) {
    worksheet.addRow(row);
  }
  
  return worksheet;
}

export async function writeWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
