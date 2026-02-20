const { Pool } = require("pg");
require("dotenv").config();

// database configuration here
const db = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

module.exports = {
  query: (text, params) => db.query(text, params),
};
