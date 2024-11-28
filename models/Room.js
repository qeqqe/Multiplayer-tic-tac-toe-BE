const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  guest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  status: {
    type: String,
    enum: ["waiting", "playing", "finished"],
    default: "waiting",
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600,
  },
  cleanupDelay: {
    type: Date,
    default: null,
  },
  currentPlayer: {
    type: String,
    enum: ["host", "guest"],
    default: "host",
  },
  gameState: {
    board: {
      type: [String],
      default: Array(9).fill(null),
    },
  },
  isHostTurn: {
    type: Boolean,
    default: true,
  },
  board: {
    type: [String],
    default: Array(9).fill(null),
  },
});

// Add cleanup index
roomSchema.index({ cleanupDelay: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Room", roomSchema);
