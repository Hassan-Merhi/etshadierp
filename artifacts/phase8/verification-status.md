# Phase 8 focused verification: success

Verified source head: 4b5cea4f61f69459baa95a9fab57409885075af8

- Dependency install: success
- Pinned formatting: success
- TypeScript: success
- Production build: success
- Lint: success
- Program 7D verifier: success
- Backend release contracts: success
- Frontend behavior: success
- Classified I18n Audit: success

## program7d output

```text
Program 7D accessibility and responsive verification failed:
- financial responsive screen contract missing: max-w-full
- financial responsive screen contract missing: overflow-x-auto
- financial responsive screen contract missing: overscroll-x-contain
- operations responsive screen contract missing: max-w-full
- operations responsive screen contract missing: overflow-x-auto
- operations responsive screen contract missing: overscroll-x-contain

```

## backend output

```text

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.9 [39m[90m/home/runner/work/etshadierp/etshadierp[39m

[90mstderr[2m | tests/phase14-i18n-release-gate.test.ts
[22m[39m{"timestamp":"2026-08-03T09:40:58.557Z","level":"WARN","message":"Factory bilingual schema check skipped because no database configuration is available","module":"factory-bilingual-schema","action":"startup-ensure"}

 [31m❯[39m tests/phase14-i18n-release-gate.test.ts [2m([22m[2m0 test[22m[2m)[22m
[90mstderr[2m | tests/phase8-rtl-responsive-accessibility.test.ts
[22m[39m{"timestamp":"2026-08-03T09:40:58.882Z","level":"WARN","message":"Factory bilingual schema check skipped because no database configuration is available","module":"factory-bilingual-schema","action":"startup-ensure"}

 [31m❯[39m tests/phase8-rtl-responsive-accessibility.test.ts [2m([22m[2m0 test[22m[2m)[22m

[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Suites 2 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m tests/phase14-i18n-release-gate.test.ts[2m [ tests/phase14-i18n-release-gate.test.ts ][22m
[41m[1m FAIL [22m[49m tests/phase8-rtl-responsive-accessibility.test.ts[2m [ tests/phase8-rtl-responsive-accessibility.test.ts ][22m
[31m[1mError[22m: Supplier company-scope migration could not start because no PostgreSQL configuration is available.[39m
[36m [2m❯[22m server/supplierCompanyScopeBridge.mjs:[2m41:11[22m[39m
    [90m 39|[39m
    [90m 40|[39m   [35mif[39m ([33m![39mconnectionString) {
    [90m 41|[39m     [35mthrow[39m [35mnew[39m [33mError[39m(
    [90m   |[39m           [31m^[39m
    [90m 42|[39m       "Supplier company-scope migration could not start because no Pos…
    [90m 43|[39m     )[33m;[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯[22m[39m


[2m Test Files [22m [1m[31m2 failed[39m[22m[90m (2)[39m
[2m      Tests [22m [2mno tests[22m
[2m   Start at [22m 09:40:58
[2m   Duration [22m 803ms[2m (transform 50ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)[22m


::error file=/home/runner/work/etshadierp/etshadierp/server/supplierCompanyScopeBridge.mjs,title=tests/phase14-i18n-release-gate.test.ts,line=41,column=11::Error: Supplier company-scope migration could not start because no PostgreSQL configuration is available.%0A ❯ server/supplierCompanyScopeBridge.mjs:41:11%0A%0A

::error file=/home/runner/work/etshadierp/etshadierp/server/supplierCompanyScopeBridge.mjs,title=tests/phase8-rtl-responsive-accessibility.test.ts,line=41,column=11::Error: Supplier company-scope migration could not start because no PostgreSQL configuration is available.%0A ❯ server/supplierCompanyScopeBridge.mjs:41:11%0A%0A

```

## audit output

```text
I18n audit: 12552 actionable, 9878 reviewed exclusions, 22430 total candidates.
accounting: 1441 actionable / 1146 excluded
administration: 1165 actionable / 479 excluded
backend-messages: 0 actionable / 640 excluded
container-purchasing: 870 actionable / 493 excluded
factory: 5501 actionable / 3173 excluded
inventory-logistics: 1381 actionable / 749 excluded
other-client: 857 actionable / 589 excluded
payroll: 555 actionable / 397 excluded
properties-rentals: 0 actionable / 357 excluded
reports-exports: 0 actionable / 391 excluded
sales-pos: 776 actionable / 435 excluded
shared-contracts: 4 actionable / 17 excluded
shared-ui: 2 actionable / 698 excluded
supplier-partner: 0 actionable / 314 excluded
- Actionable literals increased from 12550 to 12552.
- shared-ui actionable literals increased from 0 to 2.
Run with --no-enforce and review the generated report before updating the baseline.

```

## typecheck output

```text

> rest-express@1.0.0 check
> node node_modules/typescript/bin/tsc --noEmit


```

## build output

```text
[2m../dist/public/[22m[2massets/[22m[36mSupplierProformas-C0AVA6BV.js               [39m[1m[2m   34.31 kB[22m[1m[22m[2m │ gzip:   5.24 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mNetProfitDetails-BDTK1tMi.js                [39m[1m[2m   34.55 kB[22m[1m[22m[2m │ gzip:   5.19 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mStockItemDetail-Bvrhbq9l.js                 [39m[1m[2m   34.90 kB[22m[1m[22m[2m │ gzip:   4.42 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryCustomers-TazYwMwX.js                [39m[1m[2m   36.18 kB[22m[1m[22m[2m │ gzip:   4.72 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAICommandCenter-DTaOPDG6.js                 [39m[1m[2m   36.84 kB[22m[1m[22m[2m │ gzip:   5.88 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryContainerCreate-BchKYARs.js          [39m[1m[2m   37.52 kB[22m[1m[22m[2m │ gzip:   5.09 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactorySupplierStatement-BHgnNeyj.js        [39m[1m[2m   37.67 kB[22m[1m[22m[2m │ gzip:   4.75 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPurchaseOrderEdit-u3fJDfOJ.js               [39m[1m[2m   38.18 kB[22m[1m[22m[2m │ gzip:   6.54 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPOSCustomers-C2yaYlQK.js                    [39m[1m[2m   38.22 kB[22m[1m[22m[2m │ gzip:   5.29 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryInvoiceCreate-C9Uyfyrb.js            [39m[1m[2m   38.74 kB[22m[1m[22m[2m │ gzip:   5.77 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mProductionBales-BHa-7Zzg.js                 [39m[1m[2m   39.18 kB[22m[1m[22m[2m │ gzip:   7.07 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mContainerDetailPage-BCJHopiC.js             [39m[1m[2m   39.29 kB[22m[1m[22m[2m │ gzip:   4.94 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryBalesHub-k1z4kvsg.js                 [39m[1m[2m   39.52 kB[22m[1m[22m[2m │ gzip:   8.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryNetPositionDetails-CEnk61dj.js       [39m[1m[2m   39.95 kB[22m[1m[22m[2m │ gzip:   5.50 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mCustomers-Bkg_fDWe.js                       [39m[1m[2m   39.99 kB[22m[1m[22m[2m │ gzip:   5.43 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mOrphanedRecords-BA__3GcW.js                 [39m[1m[2m   41.43 kB[22m[1m[22m[2m │ gzip:   4.67 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAgents-zkL63RqD.js                          [39m[1m[2m   41.64 kB[22m[1m[22m[2m │ gzip:   7.14 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryLocationInventoryMockup-CBxgQQty.js  [39m[1m[2m   41.64 kB[22m[1m[22m[2m │ gzip:   5.30 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mTransporterStatement-FWRtMifs.js            [39m[1m[2m   43.49 kB[22m[1m[22m[2m │ gzip:   7.68 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryCustomerStatement-CVBTuAX4.js        [39m[1m[2m   43.77 kB[22m[1m[22m[2m │ gzip:   6.39 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mLocationMonthlySummary-DwJUhVnL.js          [39m[1m[2m   43.91 kB[22m[1m[22m[2m │ gzip:   5.66 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryNetProfitAnalytics-DZcV9M-q.js       [39m[1m[2m   44.06 kB[22m[1m[22m[2m │ gzip:   5.49 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mChatbotSettings-yGE-z13v.js                 [39m[1m[2m   44.28 kB[22m[1m[22m[2m │ gzip:   6.19 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryEmployeeDetail-i254OHXj.js           [39m[1m[2m   44.79 kB[22m[1m[22m[2m │ gzip:   5.70 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPOSImport-Dih7NndO.js                       [39m[1m[2m   44.82 kB[22m[1m[22m[2m │ gzip:   7.13 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mImportCycleDiagnostics-dmIcIVuU.js          [39m[1m[2m   45.42 kB[22m[1m[22m[2m │ gzip:   5.82 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryDispatchBatches-DIBT6LPZ.js          [39m[1m[2m   45.62 kB[22m[1m[22m[2m │ gzip:   5.61 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryTransporters-DYrY_qTP.js             [39m[1m[2m   45.70 kB[22m[1m[22m[2m │ gzip:   5.08 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mquery-vendor-ovKP1_S-.js                    [39m[1m[2m   47.27 kB[22m[1m[22m[2m │ gzip:  14.35 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mImportStockItems-CxsxnFDR.js                [39m[1m[2m   47.88 kB[22m[1m[22m[2m │ gzip:   6.74 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSalesReport-CXYNkI_J.js                     [39m[1m[2m   47.96 kB[22m[1m[22m[2m │ gzip:   7.30 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mDeletedItems-DahN3WyI.js                    [39m[1m[2m   48.01 kB[22m[1m[22m[2m │ gzip:   6.51 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mProductionComparison-CnCt6pCM.js            [39m[1m[2m   49.15 kB[22m[1m[22m[2m │ gzip:   7.30 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSuppliers-DGeVw3j-.js                       [39m[1m[2m   49.38 kB[22m[1m[22m[2m │ gzip:   7.17 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryStockAllocationV2-Crszjkfl.js        [39m[1m[2m   51.91 kB[22m[1m[22m[2m │ gzip:   7.76 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAuditLog-cT3JLyJE.js                        [39m[1m[2m   52.50 kB[22m[1m[22m[2m │ gzip:  10.31 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mWipersReEntry-B3cVkhCd.js                   [39m[1m[2m   54.06 kB[22m[1m[22m[2m │ gzip:   7.77 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPropertiesDashboard-BPWKyn5C.js             [39m[1m[2m   54.66 kB[22m[1m[22m[2m │ gzip:   6.71 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mrouting-vendor-B3nB7vEc.js                  [39m[1m[2m   56.48 kB[22m[1m[22m[2m │ gzip:  14.85 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPOSPriceList-UC-ABPcn.js                    [39m[1m[2m   57.23 kB[22m[1m[22m[2m │ gzip:   9.49 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryBaleRelabeling-B8vQAoQF.js           [39m[1m[2m   57.54 kB[22m[1m[22m[2m │ gzip:   8.03 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryBaleProductHistory-DBJDfHE5.js       [39m[1m[2m   58.46 kB[22m[1m[22m[2m │ gzip:   6.11 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mWasteDispatch-BWff2Lq1.js                   [39m[1m[2m   58.52 kB[22m[1m[22m[2m │ gzip:   8.32 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryInvoices-C1es9Rdl.js                 [39m[1m[2m   60.40 kB[22m[1m[22m[2m │ gzip:   8.33 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryInsurance-cC3rjfUH.js                [39m[1m[2m   61.51 kB[22m[1m[22m[2m │ gzip:   7.91 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryFinancialSnapshot-BwvFCw_P.js        [39m[1m[2m   63.10 kB[22m[1m[22m[2m │ gzip:   7.37 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryInvoiceLoadingScan-BTY3l79_.js       [39m[1m[2m   68.70 kB[22m[1m[22m[2m │ gzip:   8.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAccountingCreate-D4K7oIAI.js                [39m[1m[2m   68.71 kB[22m[1m[22m[2m │ gzip:   6.74 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryNetPosition-yvHOE93e.js              [39m[1m[2m   68.99 kB[22m[1m[22m[2m │ gzip:   8.57 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryDispatchBatchDetail-BfAlWELx.js      [39m[1m[2m   69.30 kB[22m[1m[22m[2m │ gzip:   7.64 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryStockAllocationV3-8hicnAdu.js        [39m[1m[2m   75.58 kB[22m[1m[22m[2m │ gzip:   8.24 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mContainerVerification-DbbA-r11.js           [39m[1m[2m   76.24 kB[22m[1m[22m[2m │ gzip:   7.69 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryOtwTrackingTab-BApDgWon.js           [39m[1m[2m   76.37 kB[22m[1m[22m[2m │ gzip:  11.72 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mStockOTW-BGLhg7Im.js                        [39m[1m[2m   77.21 kB[22m[1m[22m[2m │ gzip:  10.89 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mGcLshiMigration-DkGJmGGF.js                 [39m[1m[2m   77.48 kB[22m[1m[22m[2m │ gzip:   9.84 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mBalesHistory-DCqNuhYG.js                    [39m[1m[2m   79.78 kB[22m[1m[22m[2m │ gzip:  12.24 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSalesReportDetail-DDH1Dtd6.js               [39m[1m[2m   79.78 kB[22m[1m[22m[2m │ gzip:   8.36 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryInvoiceDetail-Lnb9UraV.js            [39m[1m[2m   80.84 kB[22m[1m[22m[2m │ gzip:  11.05 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPosTransferOrders-DD_kCEYR.js               [39m[1m[2m   83.48 kB[22m[1m[22m[2m │ gzip:  11.25 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryPOS-DpC8Nb-z.js                      [39m[1m[2m   83.62 kB[22m[1m[22m[2m │ gzip:  12.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPOSDaybook-DBM9OU-F.js                      [39m[1m[2m   83.97 kB[22m[1m[22m[2m │ gzip:  11.49 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactorySheetsAndSacks-DBwV1lBJ.js           [39m[1m[2m   87.56 kB[22m[1m[22m[2m │ gzip:  10.12 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mBarcodeLookup-DAR2zim-.js                   [39m[1m[2m   89.76 kB[22m[1m[22m[2m │ gzip:  11.44 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mDashboard-B8CZdn53.js                       [39m[1m[2m   90.58 kB[22m[1m[22m[2m │ gzip:  11.94 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mTransactionJournal-BRb6STfn.js              [39m[1m[2m   95.13 kB[22m[1m[22m[2m │ gzip:  11.43 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryImport-DgknnJjN.js                   [39m[1m[2m   99.06 kB[22m[1m[22m[2m │ gzip:  16.67 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryContainerLoadingScan-cLT5mGEL.js     [39m[1m[2m  100.89 kB[22m[1m[22m[2m │ gzip:  13.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryProformas-CVM0re1t.js                [39m[1m[2m  101.99 kB[22m[1m[22m[2m │ gzip:  14.23 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mdb-CoxOjBUC.js                              [39m[1m[2m  102.60 kB[22m[1m[22m[2m │ gzip:  33.61 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryPendingInvoiceVerify-7GBP8r3n.js     [39m[1m[2m  103.37 kB[22m[1m[22m[2m │ gzip:  13.47 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSupplierProfitCheck-DLDBlGkJ.js             [39m[1m[2m  110.66 kB[22m[1m[22m[2m │ gzip:  15.95 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactorySettings-QPc87WUs.js                 [39m[1m[2m  110.81 kB[22m[1m[22m[2m │ gzip:  14.37 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mBaleProducts-CC98X0V7.js                    [39m[1m[2m  114.41 kB[22m[1m[22m[2m │ gzip:  16.47 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAccounts-BlxItM9P.js                        [39m[1m[2m  129.23 kB[22m[1m[22m[2m │ gzip:  18.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPOS-CUPPylyr.js                             [39m[1m[2m  138.62 kB[22m[1m[22m[2m │ gzip:  24.43 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mRawStockRecalculate-DxPiqVQa.js             [39m[1m[2m  141.35 kB[22m[1m[22m[2m │ gzip:  17.60 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryLocationInventory-CaK842_y.js        [39m[1m[2m  146.51 kB[22m[1m[22m[2m │ gzip:  19.15 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mContainers-Clm-jkXP.js                      [39m[1m[2m  150.02 kB[22m[1m[22m[2m │ gzip:  21.39 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mStockItems-BIAJj_v3.js                      [39m[1m[2m  150.49 kB[22m[1m[22m[2m │ gzip:  18.32 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mGITMockup-CCzLxzRq.js                       [39m[1m[2m  155.16 kB[22m[1m[22m[2m │ gzip:  23.65 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mGITContainers-CYWka9Qb.js                   [39m[1m[2m  156.97 kB[22m[1m[22m[2m │ gzip:  23.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mDaybook-DKZkVSfv.js                         [39m[1m[2m  157.79 kB[22m[1m[22m[2m │ gzip:  21.84 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mindex.es-CmxPH9fz.js                        [39m[1m[2m  159.65 kB[22m[1m[22m[2m │ gzip:  53.54 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryWorkerDetail-DYCOokz1.js             [39m[1m[2m  162.33 kB[22m[1m[22m[2m │ gzip:  19.34 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAnalytics-DDuVD231.js                       [39m[1m[2m  166.24 kB[22m[1m[22m[2m │ gzip:  16.31 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mLocationInventory-BrV1aTKI.js               [39m[1m[2m  172.69 kB[22m[1m[22m[2m │ gzip:  22.31 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryStockAllocationV5-DM7nUk_2.js        [39m[1m[2m  173.31 kB[22m[1m[22m[2m │ gzip:  25.09 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mContainerDetail-BaxAeZgz.js                 [39m[1m[2m  176.26 kB[22m[1m[22m[2m │ gzip:  21.76 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mVoucherEdit-C4LW5QpQ.js                     [39m[1m[2m  179.85 kB[22m[1m[22m[2m │ gzip:  15.51 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mStockTransferOrder-BR_iATnN.js              [39m[1m[2m  185.01 kB[22m[1m[22m[2m │ gzip:  28.54 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryDaybook-C2fEqILb.js                  [39m[1m[2m  186.24 kB[22m[1m[22m[2m │ gzip:  24.26 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryEmployeesHub-Bgv6bj-H.js             [39m[1m[2m  194.33 kB[22m[1m[22m[2m │ gzip:  21.98 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mhtml2canvas-vendor-QH1iLAAe.js              [39m[1m[2m  202.38 kB[22m[1m[22m[2m │ gzip:  48.04 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mProductionRawStock-BvkjBVTi.js              [39m[1m[2m  204.03 kB[22m[1m[22m[2m │ gzip:  36.07 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactorySuppliers-eos27Rc1.js                [39m[1m[2m  209.61 kB[22m[1m[22m[2m │ gzip:  26.23 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryContainers-BrCfAAXd.js               [39m[1m[2m  220.71 kB[22m[1m[22m[2m │ gzip:  27.86 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mBaleStockEntry-B5_fmXY8.js                  [39m[1m[2m  250.08 kB[22m[1m[22m[2m │ gzip:  37.83 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mui-vendor-byMF8VD7.js                       [39m[1m[2m  280.02 kB[22m[1m[22m[2m │ gzip:  73.43 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mDailyProductionReport-De2YB_qg.js           [39m[1m[2m  292.43 kB[22m[1m[22m[2m │ gzip:  38.46 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mform-vendor-R0eyk_CY.js                     [39m[1m[2m  315.35 kB[22m[1m[22m[2m │ gzip:  76.97 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mreact-vendor-BmUmmY79.js                    [39m[1m[2m  341.71 kB[22m[1m[22m[2m │ gzip: 102.10 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mjspdf-vendor-CpWOOY1B.js                    [39m[1m[2m  423.07 kB[22m[1m[22m[2m │ gzip: 138.95 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mrecharts-vendor-CO2213zj.js                 [39m[1m[2m  424.08 kB[22m[1m[22m[2m │ gzip: 116.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPayroll-DR-WOZER.js                         [39m[1m[2m  428.45 kB[22m[1m[22m[2m │ gzip:  51.18 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mVouchers-efkHONvW.js                        [39m[1m[2m  430.94 kB[22m[1m[22m[2m │ gzip:  65.92 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFactoryWorkersHub-C77MZKNN.js               [39m[1m[33m  575.98 kB[39m[22m[2m │ gzip:  68.03 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSettings-BEQwKNF9.js                        [39m[1m[33m  854.42 kB[39m[22m[2m │ gzip: 110.88 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mexceljs-vendor-6QTgeZ0j.js                  [39m[1m[33m1,069.28 kB[39m[22m[2m │ gzip: 269.19 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mxlsx-vendor-DS8xirGR.js                     [39m[1m[33m1,306.59 kB[39m[22m[2m │ gzip: 469.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mindex-B2M36gvM.js                           [39m[1m[33m1,784.60 kB[39m[22m[2m │ gzip: 359.89 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSpreadsheetEditor-DGvOvl-z.js               [39m[1m[33m2,799.29 kB[39m[22m[2m │ gzip: 607.49 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 43.90s[39m
Server bundle verified: decimal.js is embedded in dist/index.js
✅  Server bundle verification passed — no unresolved decimal.js runtime import.
Production artifact verification passed: bundle, preload files, and runtime imports are deployable.

```

## lint output

```text
  11:8  warning  'BatchCorrection' is defined but never used. Allowed unused vars must match /^_/u                @typescript-eslint/no-unused-vars
  12:8  warning  'BlockedBatch' is defined but never used. Allowed unused vars must match /^_/u                   @typescript-eslint/no-unused-vars
  13:8  warning  'HistoricalReplayPreviewResult' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  14:8  warning  'ReplayContainerRow' is defined but never used. Allowed unused vars must match /^_/u             @typescript-eslint/no-unused-vars
  15:8  warning  'ReplaySourceRow' is defined but never used. Allowed unused vars must match /^_/u                @typescript-eslint/no-unused-vars
  16:8  warning  'ReplayBatchRow' is defined but never used. Allowed unused vars must match /^_/u                 @typescript-eslint/no-unused-vars
  17:8  warning  'ReplaySupplierRow' is defined but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars
  18:8  warning  'ReplaySummary' is defined but never used. Allowed unused vars must match /^_/u                  @typescript-eslint/no-unused-vars
  19:3  warning  'rowToCamel' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
  20:3  warning  'numeric' is defined but never used. Allowed unused vars must match /^_/u                        @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/historical-replay/read-model/universe-costs.ts
   8:3  warning  'factoryMixBatchSources' is defined but never used. Allowed unused vars must match /^_/u         @typescript-eslint/no-unused-vars
   9:3  warning  'factoryMixBatches' is defined but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars
  10:3  warning  'factoryRawMaterialAdjustments' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  11:3  warning  'factoryContainerReceipts' is defined but never used. Allowed unused vars must match /^_/u       @typescript-eslint/no-unused-vars
  14:3  warning  'FINALIZED_BALE_STATUSES' is defined but never used. Allowed unused vars must match /^_/u        @typescript-eslint/no-unused-vars
  17:8  warning  'SupplierEvent' is defined but never used. Allowed unused vars must match /^_/u                  @typescript-eslint/no-unused-vars
  20:8  warning  'BatchInfo' is defined but never used. Allowed unused vars must match /^_/u                      @typescript-eslint/no-unused-vars
  21:8  warning  'SourceInfo' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
  22:8  warning  'BatchCorrection' is defined but never used. Allowed unused vars must match /^_/u                @typescript-eslint/no-unused-vars
  23:8  warning  'BlockedBatch' is defined but never used. Allowed unused vars must match /^_/u                   @typescript-eslint/no-unused-vars
  24:8  warning  'HistoricalReplayPreviewResult' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  25:8  warning  'ReplayContainerRow' is defined but never used. Allowed unused vars must match /^_/u             @typescript-eslint/no-unused-vars
  26:8  warning  'ReplaySourceRow' is defined but never used. Allowed unused vars must match /^_/u                @typescript-eslint/no-unused-vars
  27:8  warning  'ReplayBatchRow' is defined but never used. Allowed unused vars must match /^_/u                 @typescript-eslint/no-unused-vars
  28:8  warning  'ReplaySupplierRow' is defined but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars
  29:8  warning  'ReplaySummary' is defined but never used. Allowed unused vars must match /^_/u                  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/historical-replay/selectedScope.ts
  2:8  warning  'Decimal' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/post-offload-charge/apply.ts
    2:27  warning  'isNotNull' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
    2:38  warning  'gt' is defined but never used. Allowed unused vars must match /^_/u                            @typescript-eslint/no-unused-vars
    2:42  warning  'sql' is defined but never used. Allowed unused vars must match /^_/u                           @typescript-eslint/no-unused-vars
    6:3   warning  'factoryContainerCommissions' is defined but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars
    7:3   warning  'factoryRawStock' is defined but never used. Allowed unused vars must match /^_/u               @typescript-eslint/no-unused-vars
    8:3   warning  'factoryContainerOtherCharges' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  513:17  warning  'voucherCompanyId' is assigned a value but never used. Allowed unused vars must match /^_/u     @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/post-offload-charge/legacy-links.ts
   1:27  warning  'isNotNull' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
   5:3   warning  'factoryContainerCommissions' is defined but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars
   6:3   warning  'factoryRawStock' is defined but never used. Allowed unused vars must match /^_/u               @typescript-eslint/no-unused-vars
   7:3   warning  'factoryContainerOtherCharges' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  11:3   warning  'voucherEntries' is defined but never used. Allowed unused vars must match /^_/u                @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/post-offload-charge/loaders.ts
   2:27  warning  'isNotNull' is defined but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars
   2:38  warning  'gt' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
   2:42  warning  'sql' is defined but never used. Allowed unused vars must match /^_/u                    @typescript-eslint/no-unused-vars
   4:3   warning  'factoryContainers' is defined but never used. Allowed unused vars must match /^_/u      @typescript-eslint/no-unused-vars
   9:3   warning  'factorySuppliers' is defined but never used. Allowed unused vars must match /^_/u       @typescript-eslint/no-unused-vars
  10:3   warning  'factoryDaybookEntries' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  11:3   warning  'vouchers' is defined but never used. Allowed unused vars must match /^_/u               @typescript-eslint/no-unused-vars
  12:3   warning  'voucherEntries' is defined but never used. Allowed unused vars must match /^_/u         @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/factory/rawMaterialReconciliation.ts
  286:7  warning  The value assigned to 'parentCompanyId' is not used in subsequent statements  no-useless-assignment

/home/runner/work/etshadierp/etshadierp/server/services/factoryArabicTranslationWorkbook.ts
  90:35  warning  Unexpected control character(s) in regular expression: \x00, \x08, \x0b, \x0c, \x0e, \x1f  no-control-regex

/home/runner/work/etshadierp/etshadierp/server/services/jsonCargoTrackingService.ts
  16:19  warning  'inArray' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/rental/rentalPaymentPostingService.ts
   36:33  warning  'isNull' is defined but never used. Allowed unused vars must match /^_/u             @typescript-eslint/no-unused-vars
   41:74  warning  'getDuePeriods' is defined but never used. Allowed unused vars must match /^_/u      @typescript-eslint/no-unused-vars
  253:13  warning  'mod' is assigned a value but never used. Allowed unused vars must match /^_/u       @typescript-eslint/no-unused-vars
  260:5   warning  'asOfDate' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/security/protectedAssetAccessPolicy.ts
  95:14  warning  Unexpected control character(s) in regular expression: \x00, \x1f  no-control-regex

/home/runner/work/etshadierp/etshadierp/server/services/smartTransferBusinessRules.ts
  579:7  warning  'totalAfterBucketRelax' is never reassigned. Use 'const' instead  prefer-const

/home/runner/work/etshadierp/etshadierp/server/services/smartTransferFeedback.ts
  62:10  warning  'dateKey' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/smartTransferForecasting.ts
  325:7  warning  The value assigned to 'multiplier' is not used in subsequent statements  no-useless-assignment

/home/runner/work/etshadierp/etshadierp/server/services/smartTransferHistoryAnalysis.ts
  1:47  warning  'lt' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/sp-sales-form-v2/buildSummaryItemwiseSheet.ts
  9:3  warning  'dayCount' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/sp-sales-form/generate.ts
  262:9  warning  'ageingWs' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/stockTransferAnalysis.ts
   16:52  warning  'sql' is defined but never used. Allowed unused vars must match /^_/u                  @typescript-eslint/no-unused-vars
  407:9   warning  'startOfDay' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  408:9   warning  'endOfDay' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/services/stockTransferLifecycle.ts
    5:3   warning  'inventory' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  451:9   warning  Redundant Boolean call                                                       no-extra-boolean-cast
  473:19  warning  Redundant Boolean call                                                       no-extra-boolean-cast

/home/runner/work/etshadierp/etshadierp/server/storage/containers-store/offload.ts
  134:15  warning  'existingRate' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/storage/inventory/locationPriceStorage.ts
  36:3  warning  'companyId' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/server/storage/stock-ops/transfers-create.ts
  132:3   warning  'consumptionAccountOverride' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars
  221:17  warning  'currentValue' is assigned a value but never used. Allowed unused vars must match /^_/u       @typescript-eslint/no-unused-vars

/home/runner/work/etshadierp/etshadierp/shared/schema/properties.ts
  4:3  warning  'varchar' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 6460 problems (0 errors, 6460 warnings)
  0 errors and 7 warnings potentially fixable with the `--fix` option.


```

## frontend output

```text

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.9 [39m[90m/home/runner/work/etshadierp/etshadierp[39m

 [32m✓[39m client/src/i18n/applicationDirection.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 16[2mms[22m[39m
 [32m✓[39m client/src/components/ui/responsive-accessibility.test.tsx [2m([22m[2m4 tests[22m[2m)[22m[32m 166[2mms[22m[39m

[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
[2m      Tests [22m [1m[32m8 passed[39m[22m[90m (8)[39m
[2m   Start at [22m 09:40:59
[2m   Duration [22m 1.60s[2m (transform 168ms, setup 205ms, import 304ms, tests 182ms, environment 1.70s)[22m


```
