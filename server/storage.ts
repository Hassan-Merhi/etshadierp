/**
 * Barrel re-export — assembles `storage` from domain modules.
 * All existing callers use `import { storage } from "./storage"` unchanged.
 */
import * as auth from "./storage/auth";
import * as accounting from "./storage/accounting";
import * as inventory from "./storage/inventory";
import * as stockOps from "./storage/stockOps";
import * as containers from "./storage/containers";
import * as suppliers from "./storage/suppliers";
import * as employees from "./storage/employees";
import * as pos from "./storage/pos";
import * as factory from "./storage/factory";

export const storage = {
  ...auth,
  ...accounting,
  ...inventory,
  ...stockOps,
  ...containers,
  ...suppliers,
  ...employees,
  ...pos,
  ...factory,
};

