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
      return true;
    }
  }
  return false;
};

const checkDraw = (board) => board.every((cell) => cell !== null);

const validateMove = (room, userId, index) => {
  const isHost = room.host._id.toString() === userId;
  const isGuest = room.guest?._id.toString() === userId;

  if (!isHost && !isGuest) return false;
  if (room.status !== "playing") return false;
  if (room.board[index] !== null) return false;
  if ((isHost && !room.isHostTurn) || (isGuest && room.isHostTurn))
    return false;

  return true;
};

module.exports = {
  checkWinner,
  checkDraw,
  validateMove,
};
