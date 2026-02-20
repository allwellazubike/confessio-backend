const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== "production") {
  const cors = require("cors");
  app.use(cors());
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const ADMIN_PASSWORD = "admin123";

const db = require("./db");

// Run cleanup every 10 minutes: Delete boards inactive for 24 hours
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
      console.log("Cleanup job ran");
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

app.post("/api/get-confess", (req, res) => {});

// API: Generate unique Board ID
app.get("/api/generate-id", (req, res) => {
  const uniqueId = Math.random().toString(36).substring(2, 9);
  // No need to initialize in DB, it's created on first post
  res.json({ id: uniqueId });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Client joins a specific board
  socket.on("join_board", async (boardId) => {
    socket.join(boardId);
    try {
      const result = await db.query(
        "SELECT * FROM confessions WHERE board_id = $1 ORDER BY created_at DESC LIMIT 200",
        [boardId],
      );
      // Map DB rows to match client expectations if necessary (though columns match well)
      // DB: id, board_id, text, gradient, identity, created_at
      // Client expects: id, text, gradient, identity, timestamp (mapped from created_at)
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
      // 1. Insert new note
      await db.query(
        "INSERT INTO confessions (board_id, text, gradient, identity) VALUES ($1, $2, $3, $4)",
        [boardId, text.trim(), gradient, identity],
      );

      // 2. Enforce 200 limit: Delete anything beyond the newest 200
      // We can do this safely by keeping the latest 200 IDs
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

      // 3. Fetch updated list to broadcast
      const result = await db.query(
        "SELECT * FROM confessions WHERE board_id = $1 ORDER BY created_at DESC LIMIT 200",
        [boardId],
      );

      const notes = result.rows.map((row) => ({
        ...row,
        timestamp: row.created_at,
      }));

      // Broadcast only to this board's room
      io.to(boardId).emit("update_wall", notes);
    } catch (err) {
      console.error("Error saving confession:", err);
    }
  });

  socket.on("disconnect", () => {
    // standard disconnect
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "client/dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client/dist", "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
