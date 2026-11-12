import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeSquare } from 'chessops/util';

function verifyPosition(name: string, fen: string, keyMoveSan: string, pv: string[]) {
  console.log(`\n========================================`);
  console.log(`POSITION DE REFERENCE : ${name}`);
  console.log(`FEN initial : ${fen}`);
  
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  
  let legalMoveCount = 0;
  const sampleMoves: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      legalMoveCount++;
      if (sampleMoves.length < 5) sampleMoves.push(`${makeSquare(from)}${makeSquare(to)}`);
    }
  }
  console.log(`Nombre total de coups légaux : ${legalMoveCount}`);
  console.log(`Exemples de coups légaux UCI : ${sampleMoves.join(', ')}...`);
  
  const move = parseSan(pos, keyMoveSan);
  if (!move) throw new Error(`Coup clé invalide : ${keyMoveSan}`);
  console.log(`Validation du coup clé [${keyMoveSan}] : VALIDE`);
  
  pos.play(move);
  console.log(`FEN après le coup clé : ${makeFen(pos.toSetup())}`);
  
  for (let i = 0; i < pv.length; i++) {
    const san = pv[i];
    const parsed = parseSan(pos, san);
    if (!parsed) throw new Error(`Echec PV au coup ${i + 1} : ${san}`);
    pos.play(parsed);
  }
  console.log(`Variante principale (PV) vérifiée : ${pv.join(' ')}`);
  console.log(`État final : isCheckmate=${pos.isCheckmate()}`);
}

// 1. Morphy Opera
verifyPosition(
  'Paul Morphy vs Opéra (1858)',
  '3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13',
  'Rxd7',
  ['Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#']
);

// 2. Karpov vs Kasparov 1985
verifyPosition(
  'Karpov vs Kasparov (1985, m16)',
  'r2qr1k1/5ppp/p4n2/1pbP1bB1/1n6/N1N2B2/PP1Q1PPP/3R1RK1 b - - 1 16',
  'Nd3',
  ['Be2', 'h6', 'Bh4', 'b4', 'Nab1', 'g5', 'Bg3', 'Rc8']
);

// 3. Karpov vs Spassky 1974
verifyPosition(
  'Karpov vs Spassky (1974, m9)',
  'rnbqkb1r/p1pp1ppp/1p2pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4',
  'a3',
  ['Bb7', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e3', 'Be7']
);
