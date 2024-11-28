const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  code: String,
  host: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  guest: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  board: { type: [String], default: Array(9).fill(null) },
  xIsNext: { type: Boolean, default: true },
  status: { type: String, default: "waiting" },
});

module.exports = mongoose.model("Room", roomSchema);
