import { lazy, Suspense, type ComponentProps } from "react";

const VoucherDetailsDialogPanel = lazy(() =>
  import("@/pages/daybook/VoucherDetailsDialog").then((module) => ({
    default: module.VoucherDetailsDialog,
  })),
);

const VoucherEditDialogPanel = lazy(() =>
  import("@/pages/daybook/VoucherEditDialog").then((module) => ({
    default: module.VoucherEditDialog,
  })),
);

type VoucherDetailsDialogProps = ComponentProps<typeof VoucherDetailsDialogPanel>;
type VoucherEditDialogProps = ComponentProps<typeof VoucherEditDialogPanel>;

export function VoucherDetailsDialog(props: VoucherDetailsDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <VoucherDetailsDialogPanel {...props} />
    </Suspense>
  );
}

export function VoucherEditDialog(props: VoucherEditDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <VoucherEditDialogPanel {...props} />
    </Suspense>
  );
}
