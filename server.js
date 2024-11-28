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

io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  // Handle room joining
  socket.on("joinRoom", async ({ roomCode, token }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const room = await Room.findOne({ code: roomCode });

      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      socket.join(roomCode);

      // If user is not host and room needs a guest
      if (room.host.toString() !== decoded.id && !room.guest) {
        room.guest = decoded.id;
        room.status = "playing";
        await room.save();

        io.to(roomCode).emit("gameUpdate", {
          status: "playing",
          board: Array(9).fill(null),
          currentPlayer: room.host,
          players: {
            host: room.host,
            guest: decoded.id,
          },
        });
      }
    } catch (error) {
      console.error("Join room error:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  // Handle moves
  socket.on("makeMove", async ({ index, roomCode }) => {
    try {
      const room = await Room.findOne({ code: roomCode });
      if (!room || room.status !== "playing") return;

      // Verify move validity and update game state
      // Emit updated state to all players in room
      io.to(roomCode).emit("playerMove", {
        index,
        player: room.currentPlayer === room.host ? "X" : "O",
      });

      // Check for win/draw conditions here
    } catch (error) {
      console.error("Move error:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
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
          : undefined,
        status: room.status,
        board: Array(9).fill(null),
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
