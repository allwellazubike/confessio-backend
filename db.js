const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error("❌ Database connection error:", err.stack);
  }
  console.log("✅ Connected to database successfully!");
  release();
});

module.exports = pool;
