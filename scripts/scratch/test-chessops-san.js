const { parseFen } = require('chessops/fen');
const { Chess } = require('chessops/chess');
const { parseSan } = require('chessops/san');

const setup = parseFen('rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2').unwrap();
const pos = Chess.fromSetup(setup).unwrap();
const move = parseSan(pos, 'dxe5');
console.log(move);
const fromPiece = pos.board.get(move.from);
const toPiece = pos.board.get(move.to);
console.log(fromPiece, toPiece);
