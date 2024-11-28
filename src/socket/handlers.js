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

    // let a new player join as guest
    if (room.host._id.toString() !== user._id.toString() && !room.guest) {
      room.guest = user._id;
      room.status = "playing";
      room.isHostTurn = true;
      room.board = Array(9).fill(null);
      await room.save();
    }

    // let everyone know the game state
    io.to(roomCode).emit("gameState", {
      status: room.status,
      board: room.board,
      xIsNext: room.isHostTurn,
      winner: room.winner?.toString(),
      gameResult: room.gameResult,
      players: {
        host: { id: room.host._id.toString(), name: room.host.username },
        guest: room.guest
          ? { id: room.guest._id.toString(), name: room.guest.username }
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

    if (hasWon) {
      room.status = "finished";
      room.winner = isHost ? room.host._id : room.guest._id;
      room.gameResult = "win";
    } else if (isDraw) {
      room.status = "finished";
      room.winner = null;
      room.gameResult = "draw";
    } else {
      room.isHostTurn = !room.isHostTurn;
    }

    await room.save();

    io.to(roomCode).emit("gameState", {
      status: room.status,
      board: room.board,
      xIsNext: room.isHostTurn,
      winner: room.winner?.toString(),
      gameResult: room.gameResult,
      players: {
        host: { id: room.host._id.toString(), name: room.host.username },
        guest: room.guest
          ? { id: room.guest._id.toString(), name: room.guest.username }
          : null,
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
