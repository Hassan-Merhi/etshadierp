from pathlib import Path

path = Path("server/services/immutableStockTransferRevisionLifecycle.ts")
text = path.read_text()
marker = """    await tx.execute(sql`\n      UPDATE stock_transfer_revisions\n      SET status = 'approved', optional = false, reviewed_at = now(), reviewed_by = ${reviewerId}\n      WHERE id = ${revisionId} AND status = 'pending'\n    `);\n\n    return {"""
insert = """    await tx.execute(sql`\n      UPDATE stock_transfer_revisions\n      SET status = 'approved', optional = false, reviewed_at = now(), reviewed_by = ${reviewerId}\n      WHERE id = ${revisionId} AND status = 'pending'\n    `);\n    await tx.execute(sql`\n      UPDATE stock_transfer_revisions\n      SET\n        status = 'superseded',\n        optional = false,\n        reviewed_at = now(),\n        reviewed_by = ${reviewerId},\n        superseded_by_revision_id = ${revisionId}\n      WHERE transfer_id = ${transferId}\n        AND id <> ${revisionId}\n        AND status = 'pending'\n    `);\n\n    return {"""
if marker not in text:
    raise SystemExit("approval transition block not found")
path.write_text(text.replace(marker, insert, 1))
