import { Pool } from 'pg';

// Try without SSL first (for local postgres pointing), then with SSL
async function makePool(ssl: boolean) {
  return new Pool({
    connectionString: process.env.RENDER_DATABASE_URL,
    ssl: ssl ? { rejectUnauthorized: false } : false,
  });
}

async function main() {
  let pool: Pool;
  let client: any;

  for (const ssl of [false, true]) {
    try {
      pool = await makePool(ssl);
      client = await pool.connect();
      console.log(`✅ Connected (ssl=${ssl})`);
      break;
    } catch (e: any) {
      console.log(`ssl=${ssl} failed: ${e.message}`);
      await pool!.end().catch(() => {});
    }
  }
  if (!client) { console.error('❌ Could not connect'); process.exit(1); }

  try {
    const companies = await client.query(
      `SELECT id, code, name, company_type FROM companies WHERE id IN (12,22,23) ORDER BY id`
    );
    console.log('\n=== Companies on this DB ===');
    companies.rows.forEach((r: any) => console.log(`  ${r.id}: ${r.code} - ${r.name} (${r.company_type})`));

    const dates = await client.query(`
      SELECT 'bales_c12'     t, COUNT(*) n, MAX(created_at)::date mx    FROM factory_bales WHERE company_id=12
      UNION ALL SELECT 'bales_c23',     COUNT(*), MAX(created_at)::date    FROM factory_bales WHERE company_id=23
      UNION ALL SELECT 'attend_c12',    COUNT(*), MAX(attendance_date)::date FROM factory_attendance WHERE company_id=12
      UNION ALL SELECT 'attend_c23',    COUNT(*), MAX(attendance_date)::date FROM factory_attendance WHERE company_id=23
      UNION ALL SELECT 'daybook_c12',   COUNT(*), MAX(tx_date)::date        FROM factory_daybook_entries WHERE company_id=12
      UNION ALL SELECT 'daybook_c23',   COUNT(*), MAX(tx_date)::date        FROM factory_daybook_entries WHERE company_id=23
      UNION ALL SELECT 'mixbatch_c12',  COUNT(*), MAX(batch_date)::date     FROM factory_mix_batches WHERE company_id=12
      UNION ALL SELECT 'mixbatch_c23',  COUNT(*), MAX(batch_date)::date     FROM factory_mix_batches WHERE company_id=23
      UNION ALL SELECT 'advances_c12',  COUNT(*), MAX(advance_date)::date   FROM factory_worker_advances WHERE company_id=12
      UNION ALL SELECT 'advances_c23',  COUNT(*), MAX(advance_date)::date   FROM factory_worker_advances WHERE company_id=23
      UNION ALL SELECT 'payroll_c12',   COUNT(*), MAX(period_start)::date   FROM factory_payrolls WHERE company_id=12
      UNION ALL SELECT 'payroll_c23',   COUNT(*), MAX(period_start)::date   FROM factory_payrolls WHERE company_id=23
      UNION ALL SELECT 'containers_c12',COUNT(*), MAX(created_at)::date     FROM factory_containers WHERE company_id=12
      UNION ALL SELECT 'containers_c23',COUNT(*), MAX(created_at)::date     FROM factory_containers WHERE company_id=23
      UNION ALL SELECT 'raw_stock_c12', COUNT(*), MAX(created_at)::date     FROM factory_raw_stock WHERE company_id=12
      UNION ALL SELECT 'raw_stock_c23', COUNT(*), MAX(created_at)::date     FROM factory_raw_stock WHERE company_id=23
      UNION ALL SELECT 'mbs_c12', COUNT(*), MAX(mbs.created_at)::date FROM factory_mix_batch_sources mbs JOIN factory_mix_batches mb ON mb.id=mbs.mix_batch_id WHERE mb.company_id=12
      UNION ALL SELECT 'mbs_c23', COUNT(*), MAX(mbs.created_at)::date FROM factory_mix_batch_sources mbs JOIN factory_mix_batches mb ON mb.id=mbs.mix_batch_id WHERE mb.company_id=23
    `);
    console.log('\n=== Date ranges ===');
    console.log('table           | count  | latest');
    dates.rows.forEach((r: any) =>
      console.log(`${r.t.padEnd(15)} | ${String(r.n).padStart(6)} | ${r.mx ?? 'null'}`)
    );
  } finally {
    client.release();
    await pool!.end();
  }
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
