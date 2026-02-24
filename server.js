require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(express.json());

const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

// ─── CORS ──────────────────────────────────────────────────────────────────
// Allow the specific frontend origin in production; allow everything locally.
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ["*"];

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: !allowedOrigins.includes("*"),
  }),
);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST"],
    credentials: !allowedOrigins.includes("*"),
  },
});

const db = require("./db");

async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS confessions (
        id         SERIAL PRIMARY KEY,
        board_id   VARCHAR(20)  NOT NULL,
        text       TEXT         NOT NULL,
        gradient   VARCHAR(100),
        identity   VARCHAR(100),
        created_at TIMESTAMP    DEFAULT NOW()
      )
    `);
    console.log("✅ Database table ready");
  } catch (err) {
    console.error("❌ Failed to initialise DB:", err);
  }
}
initDB();

// Delete boards that have had no activity for 24 hours
setInterval(
  async () => {
    try {
      await db.query(`
        DELETE FROM confessions 
        WHERE board_id IN (
            SELECT board_id 
            FROM confessions 
            GROUP BY board_id 
            HAVING MAX(created_at) < NOW() - INTERVAL '24 hours'
        )
      `);
      console.log("🧹 Cleanup job ran");
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  },
  10 * 60 * 1000,
);

const headerGradients = [
  "from-[#4ACDF5] to-[#BC4AF8]",
  "from-[#F472B6] to-[#db2777]",
  "from-[#34D399] to-[#059669]",
  "from-[#FBBF24] to-[#D97706]",
  "from-[#818CF8] to-[#4F46E5]",
  "from-[#F87171] to-[#DC2626]",
];

const adjectives = [
  "Secret",
  "Silent",
  "Hidden",
  "Mystery",
  "Ghostly",
  "Quiet",
  "Masked",
  "Unknown",
  "Shadow",
];
const animals = [
  "Badger",
  "Fox",
  "Owl",
  "Squirrel",
  "Panda",
  "Cat",
  "Wolf",
  "Rabbit",
  "Koala",
  "Tiger",
];

function generateIdentity() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const ani = animals[Math.floor(Math.random() * animals.length)];
  return `${adj} ${ani}`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "ConfessIO API is running 🚀",
    env: process.env.NODE_ENV || "development",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
app.get("/api/generate-id", (req, res) => {
  const uniqueId = Math.random().toString(36).substring(2, 9);
  res.json({ id: uniqueId });
});
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins a specific board
  socket.on("join_board", async (boardId) => {
    socket.join(boardId);
    try {
      const result = await db.query(
        "SELECT * FROM confessions WHERE board_id = $1 ORDER BY created_at DESC LIMIT 200",
        [boardId],
      );
      const notes = result.rows.map((row) => ({
        ...row,
        timestamp: row.created_at,
      }));
      socket.emit("init_wall", notes);
    } catch (err) {
      console.error("Error fetching notes:", err);
    }
  });

  socket.on("new_confession", async ({ boardId, text }) => {
    if (!text || !text.trim()) return;
    if (!boardId) return;

    const identity = generateIdentity();
    const gradient =
      headerGradients[Math.floor(Math.random() * headerGradients.length)];

    try {
      // Insert new note
      await db.query(
        "INSERT INTO confessions (board_id, text, gradient, identity) VALUES ($1, $2, $3, $4)",
        [boardId, text.trim(), gradient, identity],
      );

      // Keep only the 200 most recent per board
      await db.query(
        `
        DELETE FROM confessions
        WHERE id IN (
          SELECT id FROM confessions 
          WHERE board_id = $1 
          ORDER BY created_at DESC 
          OFFSET 200
        )
        `,
        [boardId],
      );

      // Fetch updated list and broadcast to everyone in the board room
      const result = await db.query(
        "SELECT * FROM confessions WHERE board_id = $1 ORDER BY created_at DESC LIMIT 200",
        [boardId],
      );

      const notes = result.rows.map((row) => ({
        ...row,
        timestamp: row.created_at,
      }));

      io.to(boardId).emit("update_wall", notes);
    } catch (err) {
      console.error("Error saving confession:", err);
    }
  });

  socket.on("disconnect", () => {
    // standard disconnect
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(
    `   FRONTEND_URL: ${process.env.FRONTEND_URL || "(not set — CORS open)"}`,
  );
});
