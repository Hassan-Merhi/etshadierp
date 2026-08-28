# Loading scan audit metadata implementation checklist

- Scanner identity continues to come from the authenticated session and remains stored in `scanned_by`.
- New loading-row inserts receive a database-server `scanned_at` timestamp.
- Historical rows with no trustworthy original timestamp remain blank instead of being backfilled.
- Cancelled/restored loading rows preserve their original scan timestamp.
- The detailed loading UI shows scanner, date, and time beneath each bale reference.
- Excel bulk imports use the same audit timestamp path because the database trigger covers every insert into `customer_order_bales`.
