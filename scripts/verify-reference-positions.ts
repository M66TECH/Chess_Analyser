import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';

console.log('=== VERIFICATION RIGOUREUSE DES 3 POSITIONS HISTORIQUES ===');

// 1. Paul Morphy vs Duc de Brunswick & Comte Isouard (Paris, Opéra 1858)
// Après 12... Td8 (12... Rd8). Coup joué par Morphy : 13. Txd7! (13. Rxd7!)
const pos1 = Chess.default();
const moves1 = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8'];
for (const m of moves1) pos1.play(parseSan(pos1, m)!);

const fen1Before = makeFen(pos1.toSetup());
console.log('\n[Position 1 : Déviation & Sacrifice de Tour]');
console.log('Partie : Morphy vs Opéra (1858), coup 13 Blancs');
console.log('FEN avant 13. Txd7! : ', fen1Before);
pos1.play(parseSan(pos1, 'Rxd7')!);
console.log('FEN après 13. Txd7! : ', makeFen(pos1.toSetup()));
const finish1 = ['Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'];
for (const m of finish1) pos1.play(parseSan(pos1, m)!);
console.log('Mat de l Opera validé :', pos1.isCheckmate());

// 2. Anatoly Karpov vs Garry Kasparov (Moscou 1985, 16e partie)
// Après 16. Tad1 (16. Rad1). Coup joué par Kasparov : 16... Cd3! (16... Nd3!)
const pos2 = Chess.default();
const moves2 = ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nb5', 'd6', 'c4', 'Nf6', 'N1c3', 'a6', 'Na3', 'd5', 'cxd5', 'exd5', 'exd5', 'Nb4', 'Be2', 'Bc5', 'O-O', 'O-O', 'Bf3', 'Bf5', 'Bg5', 'Re8', 'Qd2', 'b5', 'Rad1'];
for (const m of moves2) pos2.play(parseSan(pos2, m)!);

const fen2Before = makeFen(pos2.toSetup());
console.log('\n[Position 2 : Avant-Poste & Domination du Poulpe]');
console.log('Partie : Karpov vs Kasparov (1985, m16), coup 16 Noirs');
console.log('FEN avant 16... Cd3! : ', fen2Before);
pos2.play(parseSan(pos2, 'Nd3')!);
console.log('FEN après 16... Cd3! : ', makeFen(pos2.toSetup()));

// 3. Anatoly Karpov vs Boris Spassky (Match des Candidats 1974, 9e partie)
// Après 3... b6. Coup prophylactique de Karpov : 4. a3! (Empêche Fb4+ et prépare le contrôle d espace)
const pos3 = Chess.default();
const moves3 = ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'];
for (const m of moves3) pos3.play(parseSan(pos3, m)!);

const fen3Before = makeFen(pos3.toSetup());
console.log('\n[Position 3 : Prophylaxie Stratégique Majeure]');
console.log('Partie : Karpov vs Spassky (1974, m9), coup 4 Blancs');
console.log('FEN avant 4. a3! : ', fen3Before);
pos3.play(parseSan(pos3, 'a3')!);
console.log('FEN après 4. a3! : ', makeFen(pos3.toSetup()));
console.log('\n=== TOUTES LES POSITIONS SONT 100% VALIDES SUR L ECHIQUIER ===');
