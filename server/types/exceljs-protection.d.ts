import "exceljs";

declare module "exceljs" {
  interface Protection {
    hidden: boolean;
  }
}
