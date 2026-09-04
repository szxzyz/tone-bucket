import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  console.log('Checking promo_codes table...');
  try {
    const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'promo_codes' AND column_name = 'reward_currency'
    `);
    
    if (res.rows.length === 0) {
      console.log('Column reward_currency is missing. Adding it...');
      await pool.query(`ALTER TABLE promo_codes ADD COLUMN reward_currency varchar DEFAULT 'USDT'`);
      console.log('Column added successfully.');
    } else {
      console.log('Column reward_currency already exists.');
    }
  } catch (err) {
    console.error('Error fixing table:', err);
  } finally {
    await pool.end();
  }
}

fix();
