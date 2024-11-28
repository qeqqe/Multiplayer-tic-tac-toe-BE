const { checkWinner, checkDraw, validateMove } = require("./gameLogic");
const Room = require("../../models/Room");

const handleJoinRoom = async (io, socket, { roomCode, user }) => {
  try {
    const room = await Room.findOne({ code: roomCode }).populate("host guest");
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    socket.join(roomCode);

    // New guest joining
    if (room.host._id.toString() !== user._id.toString() && !room.guest) {
      room.guest = user._id;
      room.status = "playing";
      room.isHostTurn = true;
      room.board = Array(9).fill(null);
      await room.save();
    }

    // Broadcast game state
    io.to(roomCode).emit("gameUpdate", {
      status: room.status,
      board: room.board,
      currentPlayer: room.isHostTurn ? room.host._id : room.guest?._id,
      players: {
        host: { username: room.host.username, id: room.host._id },
        guest: room.guest
          ? { username: room.guest.username, id: room.guest._id }
          : null,
      },
    });
  } catch (error) {
    socket.emit("error", "Failed to join room");
  }
};

const handleMove = async (io, socket, { index, roomCode, userId }) => {
  try {
    const room = await Room.findOne({ code: roomCode }).populate("host guest");
    if (!validateMove(room, userId, index)) return;

    const isHost = room.host._id.toString() === userId;
    const symbol = isHost ? "X" : "O";

    room.board[index] = symbol;
    const hasWon = checkWinner(room.board);
    const isDraw = !hasWon && checkDraw(room.board);

    if (hasWon || isDraw) {
      room.status = "finished";
      room.winner = hasWon ? (isHost ? room.host._id : room.guest._id) : null;
    } else {
      room.isHostTurn = !room.isHostTurn;
    }

    await room.save();

    io.to(roomCode).emit("gameUpdate", {
      status: room.status,
      board: room.board,
      currentPlayer: room.isHostTurn ? room.host._id : room.guest._id,
      winner: room.winner
        ? room.winner.equals(room.host._id)
          ? room.host.username
          : room.guest.username
        : null,
      isDraw: isDraw,
      players: {
        host: { username: room.host.username, id: room.host._id },
        guest: { username: room.guest.username, id: room.guest._id },
      },
    });
  } catch (error) {
    socket.emit("error", "Failed to make move");
  }
};

module.exports = {
  handleJoinRoom,
  handleMove,
};
