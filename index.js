const express = require("express");
const mysql = require("mysql2/promise");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const upload = require("multer")({ dest: "uploads/" });
const connectToDatabase = require("./db");
const natural = require("natural");
const fs = require("fs");
const csv = require("csv-parser");
const LogisticRegression = require("ml-logistic-regression");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));
app.set("view engine", "ejs");

const PORT = 8000;
const db = {
  host: "localhost",
  port: 3306,
  user: "ati",
  password: "fit2024",
  database: "ati_emails",
};

const vectorizer = new natural.TfIdf();

async function loadTrainingData(filePath) {
  const emails = [];
  const labels = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        emails.push(row.email_body);
        labels.push(parseInt(row.label));
      })
      .on("end", () => {
        resolve({ emails, labels });
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

async function trainModel() {
  const { emails, labels } = await loadTrainingData(
    path.join(__dirname, "emails.csv")
  );

  emails.forEach((email) => {
    vectorizer.addDocument(email);
  });

  const featureVectors = emails.map((email) => {
    const vector = [];
    vectorizer.tfidfs(email, (i, measure) => {
      vector[i] = measure;
    });
    return vector;
  });

  const lr = new LogisticRegression({
    numSteps: 1000,
    learningRate: 5e-3,
    batchSize: 10,
  });

  lr.train(featureVectors, labels);

  return lr;
}

async function classifyEmail(subject, body, model) {
  const emailText = `${subject} ${body}`;
  const emailVector = [];

  vectorizer.tfidfs(emailText, (i, measure) => {
    emailVector[i] = measure;
  });

  const prediction = model.predict([emailVector]);

  return prediction[0] === 1;
}

let model;
trainModel()
  .then((trainedModel) => {
    model = trainedModel;
    console.log("Logistic Regression model trained successfully!");
  })
  .catch((error) => {
    console.error("Error training the model:", error);
  });

async function isLogin(req, res, next) {
  const userId = req.cookies.userId;

  if (!userId) {
    return res.status(403).render("403");
  }

  const connection = await connectToDatabase();
  try {
    const [users] = await connection.execute(
      "SELECT name FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0) {
      req.user = users[0];
      return next();
    }

    res.status(403).render("403");
  } finally {
    await connection.end();
  }
}

async function isLogin(req, res, next) {
  const userId = req.cookies.userId;

  if (!userId) {
    return res.status(403).render("403");
  }

  const connection = await connectToDatabase();
  try {
    const [users] = await connection.execute(
      "SELECT name FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0) {
      req.user = users[0];
      return next();
    }

    res.status(403).render("403");
  } finally {
    await connection.end();
  }
}

app.get("/", async (req, res) => {
  if (req.cookies.userId) {
    res.redirect("/inbox");
  } else {
    res.render("signin", { error: null });
  }
});

//get spam
app.get("/spam", isLogin, async (req, res) => {
  const userId = req.cookies.userId;
  const connection = await connectToDatabase();

  try {
    const [spamEmails] = await connection.execute(
      `SELECT e.id, e.subject, e.created_at, u.name AS sender_name
       FROM emails e
       JOIN users u ON e.sender_id = u.id
       WHERE e.receiver_id = ? AND e.is_spam = 1
       ORDER BY e.created_at DESC`,
      [userId]
    );
    res.render("spam", { emails: spamEmails, user: req.user });
  } catch (error) {
    console.error("Error fetching spam emails:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});
// end get spam

// post signin
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  const connection = await connectToDatabase();

  try {
    const [users] = await connection.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (users.length > 0 && users[0].password === password) {
      res.cookie("userId", users[0].id, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      });
      return res.redirect("/inbox");
    } else {
      return res.render("signin", { error: "Invalid email or password" });
    }
  } catch (error) {
    console.error("Error signing in:", error);
    return res.render("signin", {
      error: "An error occurred. Please try again.",
    });
  } finally {
    await connection.end();
  }
});
//end post signin

// get signup
app.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});
// end get signup

// post signup
app.post("/signup", async (req, res) => {
  const { name, email, password, confirmpassword } = req.body;
  const connection = await connectToDatabase();

  if (!name || !email || !password || !confirmpassword) {
    res.render("signup", { error: "Please fill in all fields" });
  } else if (password !== confirmpassword) {
    res.render("signup", { error: "Passwords do not match" });
  } else if (password.length < 3) {
    res.render("signup", { error: "Password is too short" });
  }

  try {
    const [existingUser] = await connection.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUser.length > 0) {
      return res.render("signup", { error: "Email is already in use." });
    }

    await connection.execute(
      "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
      [email, password, name]
    );

    res.render("welcome", { name });
  } catch (error) {
    console.error("Error signing up:", error);
    return res.render("signup", {
      error: "An error occurred. Please try again.",
    });
  } finally {
    await connection.end();
  }
});
//end post signup

// get inbox
app.get("/inbox", isLogin, async (req, res) => {
  const userId = req.cookies.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  const connection = await connectToDatabase();
  try {
    const [emails] = await connection.execute(
      `SELECT e.id, u.name AS sender_name, e.subject, e.created_at
       FROM emails e
       JOIN users u ON e.sender_id = u.id
       WHERE e.receiver_id = ?
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const [count] = await connection.execute(
      `SELECT COUNT(*) AS count FROM emails WHERE receiver_id = ?`,
      [userId]
    );
    const totalPages = Math.ceil(count[0].count / limit);

    res.render("inbox", { emails, totalPages, page, user: req.user });
  } catch (error) {
    console.error("Error fetching inbox emails:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});

// end get inbox

// get outbox
app.get("/outbox", isLogin, async (req, res) => {
  const userId = req.cookies.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  const connection = await connectToDatabase();
  try {
    const [emails] = await connection.execute(
      `
      SELECT e.id, u.name as recipient_name, e.subject, e.created_at 
      FROM emails e
      JOIN users u ON e.receiver_id = u.id
      WHERE e.sender_id = ?
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const [count] = await connection.execute(
      `
      SELECT COUNT(*) as count
      FROM emails
      WHERE sender_id = ?`,
      [userId]
    );

    const totalPages = Math.ceil(count[0].count / limit);

    res.render("outbox", { emails, totalPages, page, user: req.user });
  } catch (error) {
    console.error("Error fetching outbox emails:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});
// end get outbox

// post delete-emails
app.post("/delete-emails", isLogin, async (req, res) => {
  let { emailIds } = req.body;
  const userId = req.cookies.userId;
  const connection = await connectToDatabase();

  try {
    await connection.execute(
      "DELETE FROM emails WHERE id IN (?) AND (receiver_id = ? OR sender_id = ?)",
      [Array.isArray(emailIds) ? emailIds : [emailIds], userId, userId]
    );

    res.send({ message: "Emails deleted successfully" });
  } catch (error) {
    console.error("Error deleting emails:", error);
    res.status(500).send({ error: "Internal server error" });
  } finally {
    await connection.end();
  }
});
// end post delete-emails

// get compose
app.get("/compose", isLogin, async (req, res) => {
  const userId = req.cookies.userId;
  const connection = await connectToDatabase();

  try {
    const [users] = await connection.execute(
      "SELECT id, name, email FROM users WHERE id != ?",
      [userId]
    );

    res.render("compose", {
      users,
      user: req.user,
      error: null,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.render("compose", {
      users: [],
      user: req.user,
      error: "There was an issue loading users. Please try again later.",
      success: null,
    });
  } finally {
    await connection.end();
  }
});
// end get compose

// post compose
app.post("/compose", isLogin, upload.single("attachment"), async (req, res) => {
  const { recipient, subject, body } = req.body;
  const userId = req.cookies.userId;

  const isSpam = await classifyEmail(subject || "(no subject)", body, model);

  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;

  const connection = await connectToDatabase();
  try {
    await connection.execute(
      "INSERT INTO emails (sender_id, receiver_id, subject, body, attachment, is_spam) VALUES (?, ?, ?, ?, ?, ?)",
      [
        userId,
        recipient,
        subject || "(no subject)",
        body,
        attachmentPath,
        isSpam ? 1 : 0,
      ]
    );

    const [users] = await connection.execute(
      "SELECT id, name, email FROM users WHERE id != ?",
      [userId]
    );

    res.render("compose", {
      users,
      user: req.user,
      error: null,
      success: "Email sent successfully!",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});
// end get compose

// post compose
app.post("/compose", isLogin, upload.single("attachment"), async (req, res) => {
  const { recipient, subject, body } = req.body;
  const userId = req.cookies.userId;
  const isSpam = await classifyEmail(subject || "(no subject)", body); // classify email

  const connection = await connectToDatabase();
  try {
    const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;
    await connection.execute(
      "INSERT INTO emails (sender_id, receiver_id, subject, body, attachment, is_spam) VALUES (?, ?, ?, ?, ?, ?)",
      [
        userId,
        recipient,
        subject || "(no subject)",
        body,
        attachmentPath,
        isSpam ? 1 : 0,
      ]
    );
    const [users] = await connection.execute(
      "SELECT id, name, email FROM users WHERE id != ?",
      [userId]
    );
    res.render("compose", {
      users,
      user: req.user,
      error: null,
      success: "Email sent successfully!",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});
// end post compose

// get signout
app.get("/signout", (req, res) => {
  res.clearCookie("userId");
  res.redirect("/");
});
// end get signout

// get email detail
app.get("/emails/:id", isLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.cookies.userId;
  const connection = await connectToDatabase();

  try {
    const [emails] = await connection.execute(
      `SELECT e.subject, e.body, e.attachment, e.created_at, u.name as sender_name
       FROM emails e
       JOIN users u ON e.sender_id = u.id
       WHERE e.id = ? AND (e.receiver_id = ? OR e.sender_id = ?)`,
      [id, userId, userId]
    );

    if (emails.length === 0) {
      return res.status(403).send("Access denied");
    }

    res.render("email_detail", { email: emails[0], user: req.user });
  } catch (error) {
    console.error("Error fetching email details:", error);
    res.status(500).send("Internal Server Error");
  } finally {
    await connection.end();
  }
});
// end get email detail
// end index

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
