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
    [6, 7, 8], // rows
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8], // columns
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
  console.log("User connected", socket.id);
  let currentRoom = null;
  let currentUser = null;

  socket.on("joinRoom", async ({ roomCode, token }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id);
      const room = await Room.findOne({ code: roomCode }).populate(
        "host guest"
      );

      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      socket.join(roomCode);

      // If joining as guest
      if (room.host._id.toString() !== user._id.toString() && !room.guest) {
        room.guest = user._id;
        room.status = "playing";
        room.isHostTurn = true; // Host goes first
        room.board = Array(9).fill(null);
        await room.save();
      }

      // Broadcast current game state
      io.to(roomCode).emit("gameUpdate", {
        status: room.status,
        board: room.board,
        currentPlayer: room.isHostTurn
          ? room.host._id.toString()
          : room.guest?._id.toString(),
        players: {
          host: { username: room.host.username, id: room.host._id },
          guest: room.guest
            ? { username: room.guest.username, id: room.guest._id }
            : null,
        },
      });
    } catch (error) {
      console.error("Join room error:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  socket.on("makeMove", async ({ index, roomCode, userId }) => {
    try {
      const room = await Room.findOne({ code: roomCode }).populate(
        "host guest"
      );
      if (!room || room.status !== "playing") return;

      const isHost = room.host._id.toString() === userId;
      const isGuest = room.guest?._id.toString() === userId;

      // Validate turn
      if ((isHost && !room.isHostTurn) || (isGuest && room.isHostTurn)) {
        return;
      }

      // Validate move
      if (room.board[index] !== null) {
        return;
      }

      // Make move
      const symbol = isHost ? "X" : "O";
      room.board[index] = symbol;
      room.isHostTurn = !room.isHostTurn;

      // Check win condition
      const winner = checkWinner(room.board);
      const isDraw = !winner && checkDraw(room.board);

      if (winner || isDraw) {
        room.status = "finished";
        await room.save();

        io.to(roomCode).emit("gameUpdate", {
          status: "finished",
          board: room.board,
          currentPlayer: null,
          winner: winner
            ? isHost
              ? room.host.username
              : room.guest.username
            : null,
          isDraw: isDraw,
          players: {
            host: { username: room.host.username, id: room.host._id },
            guest: { username: room.guest.username, id: room.guest._id },
          },
        });
      } else {
        await room.save();
        io.to(roomCode).emit("gameUpdate", {
          status: "playing",
          board: room.board,
          currentPlayer: room.isHostTurn
            ? room.host._id.toString()
            : room.guest._id.toString(),
          players: {
            host: { username: room.host.username, id: room.host._id },
            guest: { username: room.guest.username, id: room.guest._id },
          },
        });
      }
    } catch (error) {
      console.error("Move error:", error);
    }
  });

  socket.on("disconnect", async () => {
    console.log("User disconnected", socket.id);

    const playerData = connectedPlayers.get(socket.id);
    if (playerData) {
      const { roomCode, userId } = playerData;
      connectedPlayers.delete(socket.id);

      try {
        const gameRoom = await Room.findOne({ code: roomCode }).populate(
          "host guest",
          "username"
        );
        if (gameRoom && gameRoom.status === "playing") {
          // winner (the player who didn't disconnect)
          const isHost = gameRoom.host._id.toString() === userId.toString();
          const winner = isHost ? gameRoom.guest : gameRoom.host;

          gameRoom.status = "finished";
          await gameRoom.save();

          io.to(roomCode).emit("gameUpdate", {
            status: "finished",
            board: gameRoom.gameState?.board || Array(9).fill(null),
            currentPlayer: null,
            winner: winner.username,
            disconnected: true,
            players: {
              host: { username: gameRoom.host.username, id: gameRoom.host._id },
              guest: gameRoom.guest
                ? { username: gameRoom.guest.username, id: gameRoom.guest._id }
                : null,
            },
          });
        }
        const room = await Room.findOne({ code: roomCode });
        if (room) {
          // if any players are still in the room
          const roomSockets = await io.in(roomCode).fetchSockets();

          if (roomSockets.length === 0) {
            // cleanup delay if room is empty
            room.cleanupDelay = new Date();
            await room.save();
          } else {
            // player disconnection
            if (room.guest && room.guest.toString() === userId.toString()) {
              room.guest = null;
              room.status = "waiting";
              await room.save();

              io.to(roomCode).emit("gameUpdate", {
                status: "waiting",
                board: Array(9).fill(null),
                currentPlayer: null,
                players: {
                  host: { username: room.host.username, id: room.host },
                  guest: null,
                  s,
                },
              });
            }
          }
        }
      } catch (error) {
        console.error("Disconnect handling error:", error);
      }
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

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
