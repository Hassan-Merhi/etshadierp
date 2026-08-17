from pathlib import Path

path = Path("server/routes/factory/factoryInsuranceRoutes.ts")
text = path.read_text()
old = '''      res.json({
        voucherId: result.voucher.id,
        voucherNumber: result.voucher.voucherNumber,
        totalAmount,
        membersCount: eligibleMembers.length,
        period: monthLabel,
      });'''
new = '''      const postedVoucher = result.voucher as { id: number; voucherNumber: string };
      res.json({
        voucherId: postedVoucher.id,
        voucherNumber: postedVoucher.voucherNumber,
        totalAmount,
        membersCount: eligibleMembers.length,
        period: monthLabel,
      });'''
if old in text:
    path.write_text(text.replace(old, new, 1))
elif new not in text:
    raise SystemExit("Expected insurance response block was not found")
