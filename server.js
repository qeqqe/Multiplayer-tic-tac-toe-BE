const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const User = require("./models/User");
const { CgAttachment } = require("react-icons/cg");
const Room = require("./models/Room");
const { generateRoomCode } = require("./utils/roomCode");
const { handleJoinRoom, handleMove } = require("./src/socket/handlers");

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    meathods: ["GET", "POST"],
  })
);

const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const ConnectDB = async () =>
  await mongoose.connect(MONGO_URI).then(() => {
    console.log(`Connected to MongoDB`);
  });

ConnectDB();

// connected players
const connectedPlayers = new Map();

const checkWinner = (board) => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8], // horizontal rows
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8], // vertical columns
    [0, 4, 8],
    [2, 4, 6], // diagonals
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
};

const checkDraw = (board) => {
  return board.every((cell) => cell !== null);
};

io.on("connection", (socket) => {
  socket.on("joinRoom", async ({ roomCode, token }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id);
      const room = await Room.findOne({ code: roomCode }).populate(
        "host guest"
      );

      if (!room) return socket.emit("error", "Room not found");

      socket.join(roomCode);

      // Join as guest if possible
      if (!room.guest && room.host.id !== user.id) {
        room.guest = user.id;
        room.status = "playing";
        await room.save();
      }

      // Send state to everyone
      io.to(roomCode).emit("gameState", {
        board: room.board,
        xIsNext: room.xIsNext,
        status: room.status,
        players: {
          host: { id: room.host.id, name: room.host.username },
          guest: room.guest
            ? { id: room.guest.id, name: room.guest.username }
            : null,
        },
      });
    } catch (error) {
      socket.emit("error", "Failed to join");
    }
  });

  socket.on("move", async ({ roomCode, index, token }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const room = await Room.findOne({ code: roomCode }).populate(
        "host guest"
      );

      if (!room || room.status !== "playing") return;
      if (room.board[index]) return; // Spot taken

      const isHost = room.host.id === decoded.id;
      const isGuest = room.guest?.id === decoded.id;
      const isXTurn = room.xIsNext;

      // Validate turn
      if ((isHost && !isXTurn) || (isGuest && isXTurn)) return;

      // Make move
      room.board[index] = isXTurn ? "X" : "O";
      room.xIsNext = !room.xIsNext;

      // Check win
      const wins = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
      ];
      const hasWon = wins.some(
        ([a, b, c]) =>
          room.board[a] &&
          room.board[a] === room.board[b] &&
          room.board[a] === room.board[c]
      );

      if (hasWon) {
        room.status = "finished";
        room.winner = isHost ? room.host.id : room.guest.id;

        // Update stats
        const winner = isHost ? room.host : room.guest;
        const loser = isHost ? room.guest : room.host;

        await User.findByIdAndUpdate(winner.id, { $inc: { "stats.wins": 1 } });
        await User.findByIdAndUpdate(loser.id, { $inc: { "stats.losses": 1 } });
      } else if (room.board.every((cell) => cell)) {
        room.status = "finished";

        // Update draw stats for both players
        await User.findByIdAndUpdate(room.host.id, {
          $inc: { "stats.draws": 1 },
        });
        await User.findByIdAndUpdate(room.guest.id, {
          $inc: { "stats.draws": 1 },
        });
      }

      await room.save();

      // Broadcast new state
      io.to(roomCode).emit("gameState", {
        board: room.board,
        xIsNext: room.xIsNext,
        status: room.status,
        winner: room.winner,
        players: {
          host: { id: room.host.id, name: room.host.username },
          guest: { id: room.guest.id, name: room.guest.username },
        },
      });
    } catch (error) {
      socket.emit("error", "Move failed");
    }
  });
});

const authenticateJWT = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: "Invalid token" });
      }
      req.user = decoded;
      next();
    });
  } catch (error) {
    return res.status(500).json({ error: "Authentication error" });
  }
};

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      {
        username: user.username,
        id: user._id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "96h" }
    );
    return res
      .status(200)
      .json({ token, user: { username: user.username, email: user.email } });
  } catch (error) {
    return res.status(500).json({ error: "Login failed" });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.get("/user", authenticateJWT, async (req, res) => {
  try {
    console.log("User ID from token:", req.user.id);
    const user = await User.findById(req.user.id)
      .select("username email -_id")
      .lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log("Found user:", user);
    return res.status(200).json({ user });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ error: "Error fetching user" });
  }
});

app.post("/create-room", authenticateJWT, async (req, res) => {
  try {
    let code;
    let existingRoom;
    do {
      code = generateRoomCode();
      existingRoom = await Room.findOne({ code });
    } while (existingRoom);

    const room = new Room({
      code,
      host: req.user.id,
      status: "waiting",
    });

    await room.save();

    return res.status(201).json({
      code: room.code,
      message: "Room created successfully",
    });
  } catch (error) {
    console.error("Room creation error:", error);
    return res.status(500).json({ error: "Failed to create room" });
  }
});

app.get("/room/:code", authenticateJWT, async (req, res) => {
  try {
    const { code } = req.params;
    const room = await Room.findOne({ code }).populate("host", "username");

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    return res.status(200).json({
      room: {
        code: room.code,
        host: {
          username: room.host.username,
          id: room.host._id,
        },
        guest: room.guest
          ? {
              username: room.guest.username,
              id: room.guest._id,
            }
          : null,
        status: room.status,
        board: room.board || Array(9).fill(null), // Ensure board is sent
        isHostTurn: room.isHostTurn,
      },
    });
  } catch (error) {
    console.error("Error fetching room:", error);
    return res.status(500).json({ error: "Failed to fetch room" });
  }
});

// Add new endpoint to fetch user stats
app.get("/user/stats", authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("stats -_id");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json({ stats: user.stats });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
