const mysql = require("mysql2/promise");

const dbConfig = {
  host: "localhost",
  port: 3306,
  user: "ati",
  password: "fit2024",
  database: "ati_emails",
};

const connectToDatabase = () => mysql.createPool(dbConfig);

module.exports = connectToDatabase;
