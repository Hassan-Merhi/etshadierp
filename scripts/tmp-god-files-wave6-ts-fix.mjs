#!/usr/bin/env node
import fs from "node:fs";

const parent = "client/src/pages/ContainerDetail.tsx";
let p = fs.readFileSync(parent, "utf8");
p = p.replace(
  "const model = useContainerDetailModel();",
  "const model = useContainerDetailModel({ id: idProp, forceErp });"
);
fs.writeFileSync(parent, p);

const erp = "client/src/pages/containerdetail/components/ContainerDetailErpView.tsx";
let e = fs.readFileSync(erp, "utf8");
e = e.replaceAll(
  '"./containerdetail/components/ContainerDetailDialog1"',
  '"./ContainerDetailDialog1"'
);
e = e.replaceAll(
  "'./containerdetail/components/ContainerDetailDialog1'",
  "'./ContainerDetailDialog1'"
);
fs.writeFileSync(erp, e);

console.log("WAVE6_TS_WIRING_FIXED");
