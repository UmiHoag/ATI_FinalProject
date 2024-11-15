const fs = require("fs");
const { Parser } = require("json2csv");
const mysql = require("mysql2/promise");

const db = {
  host: "localhost",
  port: 3306,
  user: "ati",
  password: "fit2024",
  database: "ati_emails",
};

async function setupDatabase() {
  const connection = await mysql.createConnection(db);

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ati_emails`);
    await connection.query(`USE ati_emails`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        subject VARCHAR(255),
        body TEXT,
        attachment VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
      );
    `);
    const [columns] = await connection.execute(`
      SHOW COLUMNS FROM emails WHERE Field = 'is_spam';
    `);
    if (columns.length === 0) {
      await connection.query(`
        ALTER TABLE emails ADD COLUMN is_spam TINYINT DEFAULT 0;
      `);
    }
    const [users] = await connection.execute("SELECT * FROM users");
    if (users.length === 0) {
      await connection.query(`
        INSERT INTO users (email, password, name) VALUES
          ('a@a.com', '123', 'John'),
          ('b@b.com', '456', 'Sarah'),
          ('c@c.com', '789', 'Alex');
      `);
    }
    const [emails] = await connection.execute("SELECT * FROM emails");
    if (emails.length === 0) {
      await connection.query(`
        INSERT INTO emails (sender_id, receiver_id, subject, body) VALUES
          (1, 2, 'Hello from John', 'This is a test email to Sarah, im John free iphone for you.'),
          (2, 1, 'Re: Hello from John', 'Thanks for the email John, im Sarah free iphone for you.'),
          (1, 3, 'Hello from John', 'This is a test email to Alex, im John.'),
          (3, 1, 'Re: Hello from John', 'Thanks for the email John, im Alex.'),
          (2, 3, 'Hello from Sarah', 'This is a test email to Alex, im Sarah free iphone for you.'),
          (3, 2, 'Re: Hello from Sarah', 'Thanks for the email Sarah, Im Alex.'),
          (1, 2, 'Hello from John again', 'This is a test email to Sarah, im John again.'),
          (2, 1, 'Re: Hello from John again', 'Thanks for the email John, im Sarah again.'),
          (1, 3, 'Hello from John again', 'This is a test email to Alex, im John again.'),
          (3, 1, 'Re: Hello from John again', 'Thanks for the email John, im Alex again.');
      `);
    }
  } catch (error) {
    console.error("Error occurs:", error);
  } finally {
    await connection.end();
  }
}

async function exportEmailsToCSV() {
  const connection = await mysql.createConnection(db);
  try {
    const [emails] = await connection.query("SELECT id, subject, body FROM emails");

    for (const email of emails) {
      const isSpam = email.body.toLowerCase().includes("win") || email.body.toLowerCase().includes("free");

      await connection.execute(
        "UPDATE emails SET is_spam = ? WHERE id = ?",
        [isSpam ? 1 : 0, email.id]
      );
    }

    const [updatedEmails] = await connection.query("SELECT subject, body, is_spam FROM emails");

    const labeledEmails = updatedEmails.map((email) => ({
      email_body: `${email.subject} ${email.body}`,
      label: email.is_spam, 
    }));

    const parser = new Parser({ fields: ["email_body", "label"] });
    const csv = parser.parse(labeledEmails);

    fs.writeFileSync("emails.csv", csv);
    console.log("Emails exported to emails.csv successfully!");
  } catch (error) {
    console.error("Error exporting emails:", error);
  } finally {
    await connection.end();
  }
}

setupDatabase();
exportEmailsToCSV();

