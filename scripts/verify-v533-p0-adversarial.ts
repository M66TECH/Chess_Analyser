import { Chess } from 'chessops/chess';
import { parseSan, makeSan } from 'chessops/san';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSquare, parseSquare, squareFile, squareRank, type Role } from 'chessops/util';
import { bishopAttacks, rookAttacks, knightAttacks, kingAttacks, pawnAttacks, queenAttacks, between, ray } from 'chessops/attacks';

// ============================================================================
// 1. ENGINE SCORE & NORMALISATION PLAYER POV (P1.1)
// ============================================================================

export interface EngineScore {
  value: number; // centipawns or mate distance
  unit: 'centipawns' | 'mate';
  pov: 'white' | 'black'; // Perspective d'origine
}

export function getPlayerPovScore(score: EngineScore, playerColor: 'white' | 'black'): { normalizedCp: number; isMate: boolean; mateIn?: number } {
  // 1. Normaliser vers la perspective blanche
  let whitePovValue = score.pov === 'white' ? score.value : -score.value;

  // 2. Traitement des mats
  if (score.unit === 'mate') {
    const mateDistance = whitePovValue; // +3 = Blanc mate en 3, -3 = Noir mate en 3
    const playerMateDistance = playerColor === 'white' ? mateDistance : -mateDistance;
    const isPlayerWinningMate = playerMateDistance > 0;
    // Un mat en N équivaut à un score virtuel écrasant pondéré par la distance
    const virtualCp = isPlayerWinningMate ? (30000 - playerMateDistance * 100) : (-30000 - playerMateDistance * 100);
    return { normalizedCp: virtualCp, isMate: true, mateIn: playerMateDistance };
  }

  // 3. Normaliser vers la perspective du joueur étudié
  const playerPovCp = playerColor === 'white' ? whitePovValue : -whitePovValue;
  return { normalizedCp: playerPovCp, isMate: false };
}

// ============================================================================
// 2. PARSEUR SAN BILINGUE SÉCURISÉ & DÉTECTEUR D'AMBIGUÏTÉ (P0.1)
// ============================================================================

export interface SanParseResult {
  status: 'valid' | 'ambiguous' | 'illegal';
  move?: any;
  canonicalSanEn?: string;
  canonicalSanFr?: string;
  resolvedLang?: 'fr' | 'en' | 'auto';
  ambiguityCandidates?: Array<{
    lang: 'fr' | 'en';
    from: string;
    to: string;
    role: Role;
    sanEn: string;
    sanFr: string;
  }>;
  error?: string;
}

export function parseBilingualSan(
  pos: Chess,
  rawSan: string,
  preferredLang: 'fr' | 'en' | 'auto' = 'auto'
): SanParseResult {
  const cleanSan = rawSan.replace(/[!?]+$/, '').trim();
  const frMap: Record<string, string> = { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' };
  const frToEnSan = cleanSan.replace(/^[RDTFC]/, ch => frMap[ch] || ch)
                            .replace(/=([RDTFC])/, (_, ch) => '=' + (frMap[ch] || ch));
  const enToFrMap: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };

  if (preferredLang === 'fr') {
    const moveFr = parseSan(pos, frToEnSan);
    if (!moveFr) return { status: 'illegal', error: `Coup français illégal: "${rawSan}"` };
    const sanEn = makeSan(pos, moveFr);
    const sanFr = sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
    return { status: 'valid', move: moveFr, canonicalSanEn: sanEn, canonicalSanFr: sanFr, resolvedLang: 'fr' };
  }

  if (preferredLang === 'en') {
    const moveEn = parseSan(pos, cleanSan);
    if (!moveEn) return { status: 'illegal', error: `Coup international illégal: "${rawSan}"` };
    const sanEn = makeSan(pos, moveEn);
    const sanFr = sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
    return { status: 'valid', move: moveEn, canonicalSanEn: sanEn, canonicalSanFr: sanFr, resolvedLang: 'en' };
  }

  // Mode Auto : double test de légalité
  const moveEn = parseSan(pos, cleanSan);
  const moveFr = parseSan(pos, frToEnSan);

  if (moveFr && !moveEn) {
    const sanEn = makeSan(pos, moveFr);
    return { status: 'valid', move: moveFr, canonicalSanEn: sanEn, canonicalSanFr: sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch), resolvedLang: 'fr' };
  }
  if (moveEn && !moveFr) {
    const sanEn = makeSan(pos, moveEn);
    return { status: 'valid', move: moveEn, canonicalSanEn: sanEn, canonicalSanFr: sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch), resolvedLang: 'en' };
  }
  if (moveEn && moveFr) {
    // Si les deux parsings désignent exactement le même coup
    if (moveEn.from === moveFr.from && moveEn.to === moveFr.to && moveEn.promotion === moveFr.promotion) {
      const sanEn = makeSan(pos, moveEn);
      return { status: 'valid', move: moveEn, canonicalSanEn: sanEn, canonicalSanFr: sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch), resolvedLang: 'auto' };
    }
    // Ambiguïté réelle détectée (ex: "Rd1")
    const pieceEn = pos.board.get(moveEn.from);
    const pieceFr = pos.board.get(moveFr.from);
    return {
      status: 'ambiguous',
      ambiguityCandidates: [
        { lang: 'en', from: makeSquare(moveEn.from), to: makeSquare(moveEn.to), role: pieceEn!.role, sanEn: makeSan(pos, moveEn), sanFr: makeSan(pos, moveEn).replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch) },
        { lang: 'fr', from: makeSquare(moveFr.from), to: makeSquare(moveFr.to), role: pieceFr!.role, sanEn: makeSan(pos, moveFr), sanFr: makeSan(pos, moveFr).replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch) }
      ],
      error: `Ambiguïté critique: "${rawSan}" désigne deux coups légaux distincts selon la langue.`
    };
  }

  return { status: 'illegal', error: `Coup impossible à parser: "${rawSan}"` };
}

// ============================================================================
// 3. REGISTRE SCYLLÉ DES PREUVES DÉTERMINISTES (SealedEvidenceRegistry - P0.2 & P0.3)
// ============================================================================

export type PositionStage = 'before_move' | 'after_move';

export interface MoveExecutionFact {
  type: 'move_execution';
  fromSquare: string;
  toSquare: string;
  role: Role;
  color: 'white' | 'black';
  isCapture: boolean;
  capturedPiece?: Role;
  capturedSquare?: string;
  isCastling: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isPromotion: boolean;
  promotedRole?: Role;
}

export interface SquareControlEvidence {
  type: 'square_control';
  square: string;
  controllerSquare: string;
  controllerRole: Role;
  controllerColor: 'white' | 'black';
  isLegallyMovable: boolean; // Si la pièce est clouée absolument, elle peut ne pas pouvoir jouer légalement sur cette case
}

export interface PinEvidence {
  type: 'pin';
  attackerSquare: string;
  attackerRole: Role;
  pinnedSquare: string;
  pinnedRole: Role;
  pinnedColor: 'white' | 'black';
  shieldedSquare: string; // Roi pour clouage absolu, Dame pour clouage relatif
  isAbsolute: boolean;
}

export interface DefenseEvidence {
  type: 'defense';
  defenderSquare: string;
  defenderRole: Role;
  defendedSquare: string;
  defendedRole: Role;
  color: 'white' | 'black';
}

export interface SealedEvidenceRecord {
  id: string; // Identifiant scellé unique émis par L2, ex: "ev_pin_b5_d7_e8_after"
  stage: PositionStage;
  data: MoveExecutionFact | SquareControlEvidence | PinEvidence | DefenseEvidence;
}

export class SealedEvidenceRegistry {
  private records: Map<string, SealedEvidenceRecord> = new Map();

  addRecord(stage: PositionStage, data: MoveExecutionFact | SquareControlEvidence | PinEvidence | DefenseEvidence): string {
    let id = '';
    if (data.type === 'move_execution') {
      id = `ev_move_${data.fromSquare}_${data.toSquare}_${stage}`;
    } else if (data.type === 'square_control') {
      id = `ev_ctrl_${data.controllerSquare}_${data.square}_${stage}`;
    } else if (data.type === 'pin') {
      id = `ev_pin_${data.attackerSquare}_${data.pinnedSquare}_${data.shieldedSquare}_${stage}`;
    } else if (data.type === 'defense') {
      id = `ev_def_${data.defenderSquare}_${data.defendedSquare}_${stage}`;
    }

    const record: SealedEvidenceRecord = { id, stage, data };
    this.records.set(id, record);
    return id;
  }

  hasId(id: string): boolean {
    return this.records.has(id);
  }

  getRecord(id: string): SealedEvidenceRecord | undefined {
    return this.records.get(id);
  }

  getAllRecords(): SealedEvidenceRecord[] {
    return Array.from(this.records.values());
  }

  findRecords(predicate: (r: SealedEvidenceRecord) => boolean): SealedEvidenceRecord[] {
    return Array.from(this.records.values()).filter(predicate);
  }
}

export function buildSealedEvidenceRegistry(
  posBefore: Chess,
  move: any,
  posAfter: Chess
): SealedEvidenceRegistry {
  const registry = new SealedEvidenceRegistry();

  // 1. Move Execution Fact
  const fromPiece = posBefore.board.get(move.from)!;
  const isCastling = (fromPiece.role === 'king' && Math.abs(squareFile(move.from) - squareFile(move.to)) >= 2);
  const isEnPassant = Boolean(fromPiece.role === 'pawn' && move.to === posBefore.epSquare && !posBefore.board.has(move.to));
  const isCapture = !isCastling && (isEnPassant || posBefore.board.has(move.to));
  const capturedPiece = isCapture ? (isEnPassant ? 'pawn' : posBefore.board.get(move.to)?.role) : undefined;
  const capturedSquare = isCapture ? (isEnPassant ? makeSquare(posBefore.epSquare!) : makeSquare(move.to)) : undefined;

  const moveFact: MoveExecutionFact = {
    type: 'move_execution',
    fromSquare: makeSquare(move.from),
    toSquare: makeSquare(move.to),
    role: fromPiece.role,
    color: fromPiece.color,
    isCapture,
    capturedPiece,
    capturedSquare,
    isCastling,
    isCheck: posAfter.isCheck(),
    isCheckmate: posAfter.isCheckmate(),
    isStalemate: posAfter.isStalemate(),
    isPromotion: Boolean(move.promotion),
    promotedRole: move.promotion
  };
  registry.addRecord('after_move', moveFact);

  // 2. Extraire les relations spatiales sur posAfter
  const board = posAfter.board;
  const occupied = board.occupied;

  // Clouages absolus
  for (const color of ['white', 'black'] as const) {
    const enemyColor = color === 'white' ? 'black' : 'white';
    const kingSq = board.kingOf(color);
    if (kingSq === undefined) continue;

    for (let sq = 0; sq < 64; sq++) {
      const enemyPiece = board.get(sq);
      if (!enemyPiece || enemyPiece.color !== enemyColor) continue;
      if (enemyPiece.role !== 'bishop' && enemyPiece.role !== 'rook' && enemyPiece.role !== 'queen') continue;

      const bet = between(sq, kingSq);
      if (bet.isEmpty()) continue;

      const piecesBetween: number[] = [];
      for (const s of bet) {
        if (board.has(s)) piecesBetween.push(s);
      }

      if (piecesBetween.length === 1) {
        const pinnedSq = piecesBetween[0];
        const pinnedPiece = board.get(pinnedSq);
        if (pinnedPiece && pinnedPiece.color === color) {
          registry.addRecord('after_move', {
            type: 'pin',
            attackerSquare: makeSquare(sq),
            attackerRole: enemyPiece.role,
            pinnedSquare: makeSquare(pinnedSq),
            pinnedRole: pinnedPiece.role,
            pinnedColor: color,
            shieldedSquare: makeSquare(kingSq),
            isAbsolute: true
          });
        }
      }
    }
  }

  // Contrôles de cases et défenses
  for (let sq = 0; sq < 64; sq++) {
    const piece = board.get(sq);
    if (!piece) continue;

    let attackedSquares;
    switch (piece.role) {
      case 'pawn': attackedSquares = pawnAttacks(piece.color, sq); break;
      case 'knight': attackedSquares = knightAttacks(sq); break;
      case 'bishop': attackedSquares = bishopAttacks(sq, occupied); break;
      case 'rook': attackedSquares = rookAttacks(sq, occupied); break;
      case 'queen': attackedSquares = queenAttacks(sq, occupied); break;
      case 'king': attackedSquares = kingAttacks(sq); break;
    }

    for (const targetSq of attackedSquares) {
      // Contrôle de case
      registry.addRecord('after_move', {
        type: 'square_control',
        square: makeSquare(targetSq),
        controllerSquare: makeSquare(sq),
        controllerRole: piece.role,
        controllerColor: piece.color,
        isLegallyMovable: true
      });

      // Si case occupée par pièce amie -> Défense
      const targetPiece = board.get(targetSq);
      if (targetPiece && targetPiece.color === piece.color) {
        registry.addRecord('after_move', {
          type: 'defense',
          defenderSquare: makeSquare(sq),
          defenderRole: piece.role,
          defendedSquare: makeSquare(targetSq),
          defendedRole: targetPiece.role,
          color: piece.color
        });
      }
    }
  }

  return registry;
}

// ============================================================================
// 4. VALIDATEUR SÉMANTIQUE DE CHESSCLAIM ANTI-HALLUCINATION (P0.1, P0.3, P0.4)
// ============================================================================

export interface ChessClaim {
  id: string;
  action: 'moves_to' | 'captures' | 'attacks' | 'defends' | 'pins' | 'checks' | 'castles' | 'promotes' | 'controls_square';
  subjectRole?: Role;
  subjectSquare?: string;
  subjectColor?: 'white' | 'black';
  targetPiece?: Role;
  targetSquare?: string;
  suppliedEvidenceId?: string; // Si le LLM a tenté de fournir un ID (doit être vérifié !)
  claimText: string;
  status?: 'verified' | 'contradicted' | 'unverifiable';
  verifiedEvidenceIds?: string[];
  rejectionReason?: string;
}

export function evaluateSemanticClaimStrict(
  claim: ChessClaim,
  registry: SealedEvidenceRegistry
): ChessClaim {
  // P0.3 : Si le modèle fournit un faux identifiant de preuve non existant dans le registre
  if (claim.suppliedEvidenceId && !registry.hasId(claim.suppliedEvidenceId)) {
    return {
      ...claim,
      status: 'contradicted',
      rejectionReason: `Identifiant de preuve forgé ou invalide: "${claim.suppliedEvidenceId}" n'existe pas dans le registre L2.`
    };
  }

  const allRecords = registry.getAllRecords();
  const moveFactRecord = allRecords.find(r => r.data.type === 'move_execution');
  const mf = moveFactRecord ? (moveFactRecord.data as MoveExecutionFact) : undefined;

  // 1. ACTION : moves_to (Vérification P0.1 complète : role, fromSquare, toSquare, color)
  if (claim.action === 'moves_to') {
    if (!mf) return { ...claim, status: 'unverifiable', rejectionReason: 'Aucun fait de coup disponible' };

    if (claim.subjectRole && claim.subjectRole !== mf.role) {
      return { ...claim, status: 'contradicted', rejectionReason: `Rôle erroné: affirmé ${claim.subjectRole}, réel ${mf.role}` };
    }
    if (claim.subjectSquare && claim.subjectSquare !== mf.fromSquare) {
      return { ...claim, status: 'contradicted', rejectionReason: `Case de départ erronée: affirmé ${claim.subjectSquare}, réel ${mf.fromSquare}` };
    }
    if (claim.targetSquare && claim.targetSquare !== mf.toSquare) {
      return { ...claim, status: 'contradicted', rejectionReason: `Case d'arrivée erronée: affirmé ${claim.targetSquare}, réel ${mf.toSquare}` };
    }
    if (claim.subjectColor && claim.subjectColor !== mf.color) {
      return { ...claim, status: 'contradicted', rejectionReason: `Couleur erronée: affirmé ${claim.subjectColor}, réel ${mf.color}` };
    }
    return { ...claim, status: 'verified', verifiedEvidenceIds: [moveFactRecord!.id] };
  }

  // 2. ACTION : captures (Vérification P0.1 : isCapture, targetSquare, targetPiece)
  if (claim.action === 'captures') {
    if (!mf) return { ...claim, status: 'unverifiable', rejectionReason: 'Aucun fait de coup disponible' };

    if (!mf.isCapture) {
      return { ...claim, status: 'contradicted', rejectionReason: `Le coup joué n'est pas une capture` };
    }
    if (claim.targetSquare && claim.targetSquare !== mf.capturedSquare) {
      return { ...claim, status: 'contradicted', rejectionReason: `Case de capture erronée: affirmé ${claim.targetSquare}, réel ${mf.capturedSquare}` };
    }
    if (claim.targetPiece && mf.capturedPiece && claim.targetPiece !== mf.capturedPiece) {
      return { ...claim, status: 'contradicted', rejectionReason: `Pièce capturée erronée: affirmé ${claim.targetPiece}, réel ${mf.capturedPiece}` };
    }
    return { ...claim, status: 'verified', verifiedEvidenceIds: [moveFactRecord!.id] };
  }

  // 3. ACTION : promotes (Traitement réel P0.1)
  if (claim.action === 'promotes') {
    if (!mf) return { ...claim, status: 'unverifiable', rejectionReason: 'Aucun fait de coup disponible' };

    if (!mf.isPromotion) {
      return { ...claim, status: 'contradicted', rejectionReason: `Le coup joué n'est pas une promotion` };
    }
    if (claim.targetPiece && mf.promotedRole && claim.targetPiece !== mf.promotedRole) {
      return { ...claim, status: 'contradicted', rejectionReason: `Pièce promue erronée: affirmé ${claim.targetPiece}, réel ${mf.promotedRole}` };
    }
    return { ...claim, status: 'verified', verifiedEvidenceIds: [moveFactRecord!.id] };
  }

  // 4. ACTION : checks & castles
  if (claim.action === 'checks') {
    if (!mf) return { ...claim, status: 'unverifiable' };
    if (!mf.isCheck) return { ...claim, status: 'contradicted', rejectionReason: `Le coup ne met pas en échec` };
    return { ...claim, status: 'verified', verifiedEvidenceIds: [moveFactRecord!.id] };
  }

  if (claim.action === 'castles') {
    if (!mf) return { ...claim, status: 'unverifiable' };
    if (!mf.isCastling) return { ...claim, status: 'contradicted', rejectionReason: `Le coup n'est pas un roque` };
    return { ...claim, status: 'verified', verifiedEvidenceIds: [moveFactRecord!.id] };
  }

  // 5. ACTION : pins (Vérification dans le registre)
  if (claim.action === 'pins') {
    const matchingPins = registry.findRecords(r => {
      if (r.data.type !== 'pin') return false;
      const p = r.data as PinEvidence;
      if (claim.subjectSquare && p.attackerSquare !== claim.subjectSquare) return false;
      if (claim.subjectRole && p.attackerRole !== claim.subjectRole) return false;
      if (claim.targetSquare && p.pinnedSquare !== claim.targetSquare) return false;
      if (claim.targetPiece && p.pinnedRole !== claim.targetPiece) return false;
      return true;
    });

    if (matchingPins.length > 0) {
      return { ...claim, status: 'verified', verifiedEvidenceIds: matchingPins.map(p => p.id) };
    }

    // Distinguer contradiction d'absence de preuve (P0.1)
    // Si la pièce attaquante et la pièce cible existent mais ne sont pas alignées sur le roi -> contradicted
    if (claim.subjectSquare && claim.targetSquare) {
      return { ...claim, status: 'contradicted', rejectionReason: `Aucun clouage géométrique possible entre ces cases` };
    }
    return { ...claim, status: 'unverifiable', rejectionReason: `Preuve insuffisante pour conclure à un clouage` };
  }

  // 6. ACTION : defends
  if (claim.action === 'defends') {
    const matchingDefenses = registry.findRecords(r => {
      if (r.data.type !== 'defense') return false;
      const d = r.data as DefenseEvidence;
      if (claim.subjectSquare && d.defenderSquare !== claim.subjectSquare) return false;
      if (claim.subjectRole && d.defenderRole !== claim.subjectRole) return false;
      if (claim.targetSquare && d.defendedSquare !== claim.targetSquare) return false;
      if (claim.targetPiece && d.defendedRole !== claim.targetPiece) return false;
      return true;
    });

    if (matchingDefenses.length > 0) {
      return { ...claim, status: 'verified', verifiedEvidenceIds: matchingDefenses.map(d => d.id) };
    }
    if (claim.subjectSquare && claim.targetSquare) {
      return { ...claim, status: 'contradicted', rejectionReason: `La pièce en ${claim.subjectSquare} ne protège pas la case ${claim.targetSquare}` };
    }
    return { ...claim, status: 'unverifiable', rejectionReason: `Données insuffisantes pour prouver la défense` };
  }

  // 7. ACTION : controls_square
  if (claim.action === 'controls_square') {
    const matchingControls = registry.findRecords(r => {
      if (r.data.type !== 'square_control') return false;
      const c = r.data as SquareControlEvidence;
      if (claim.targetSquare && c.square !== claim.targetSquare) return false;
      if (claim.subjectSquare && c.controllerSquare !== claim.subjectSquare) return false;
      if (claim.subjectRole && c.controllerRole !== claim.subjectRole) return false;
      return true;
    });

    if (matchingControls.length > 0) {
      return { ...claim, status: 'verified', verifiedEvidenceIds: matchingControls.map(c => c.id) };
    }
    return { ...claim, status: 'contradicted', rejectionReason: `Aucun contrôle géométrique de la case spécifiée` };
  }

  return { ...claim, status: 'unverifiable', rejectionReason: 'Assertion non vérifiable géométriquement' };
}

// ============================================================================
// SUITE DE TESTS ADVERSARIAUX (12 CAS EXIGÉS DANS L'AUDIT)
// ============================================================================

console.log('================================================================');
console.log('SUITE DE TESTS ADVERSARIAUX P0 (12 TESTS ÉCHIQUÉENS RIGOUREUX)');
console.log('================================================================\n');

// Préparation de la position Morphy Opéra (13. Rxd7!)
// FEN: 3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13
const posMorphyBefore = Chess.fromSetup(parseFen('3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13').unwrap()).unwrap();
const moveMorphy = parseSan(posMorphyBefore, 'Rxd7')!;
const posMorphyAfter = posMorphyBefore.clone();
posMorphyAfter.play(moveMorphy);
const regMorphy = buildSealedEvidenceRegistry(posMorphyBefore, moveMorphy, posMorphyAfter);

// Test 1 : Déplacement correct (Tour d1 va en d7) -> verified
const t1 = evaluateSemanticClaimStrict({
  id: 't1', action: 'moves_to', subjectRole: 'rook', subjectSquare: 'd1', targetSquare: 'd7', claimText: 'La tour d1 va en d7'
}, regMorphy);
console.log('Test 1 (Déplacement correct) :', t1.status, t1.status === 'verified' ? 'PASS' : 'FAIL');
if (t1.status !== 'verified') throw new Error('Test 1 failed');

// Test 2 : Mauvaise origine (Tour h1 va en d7) -> contradicted (P0.1)
const t2 = evaluateSemanticClaimStrict({
  id: 't2', action: 'moves_to', subjectRole: 'rook', subjectSquare: 'h1', targetSquare: 'd7', claimText: 'La tour h1 va en d7'
}, regMorphy);
console.log('Test 2 (Mauvaise origine h1) :', t2.status, t2.status === 'contradicted' ? 'PASS' : 'FAIL', `("${t2.rejectionReason}")`);
if (t2.status !== 'contradicted') throw new Error('Test 2 failed');

// Test 3 : Mauvaise destination (Tour d1 va en e7) -> contradicted
const t3 = evaluateSemanticClaimStrict({
  id: 't3', action: 'moves_to', subjectRole: 'rook', subjectSquare: 'd1', targetSquare: 'e7', claimText: 'La tour d1 va en e7'
}, regMorphy);
console.log('Test 3 (Mauvaise destination e7) :', t3.status, t3.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t3.status !== 'contradicted') throw new Error('Test 3 failed');

// Test 4 : Mauvaise capture (Prend un fou au lieu d'un cavalier) -> contradicted
const t4 = evaluateSemanticClaimStrict({
  id: 't4', action: 'captures', targetPiece: 'bishop', targetSquare: 'd7', claimText: 'La tour capture un fou en d7'
}, regMorphy);
console.log('Test 4 (Mauvaise capture: fou vs cavalier) :', t4.status, t4.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t4.status !== 'contradicted') throw new Error('Test 4 failed');

// Test 5 & 6 : Promotion correcte & Promotion inventée
// Position avec pion blanc en e7 prêt à promouvoir en e8 (case e8 vide, rois en k3K3)
const posPromoBefore = Chess.fromSetup(parseFen('8/4P3/8/8/8/8/8/k3K3 w - - 0 1').unwrap()).unwrap();
const movePromo = parseSan(posPromoBefore, 'e8=Q')!;
const posPromoAfter = posPromoBefore.clone();
posPromoAfter.play(movePromo);
const regPromo = buildSealedEvidenceRegistry(posPromoBefore, movePromo, posPromoAfter);

const t5 = evaluateSemanticClaimStrict({
  id: 't5', action: 'promotes', targetPiece: 'queen', claimText: 'Le pion se transforme en dame'
}, regPromo);
console.log('Test 5 (Promotion correcte) :', t5.status, t5.status === 'verified' ? 'PASS' : 'FAIL');
if (t5.status !== 'verified') throw new Error('Test 5 failed');

const t6 = evaluateSemanticClaimStrict({
  id: 't6', action: 'promotes', targetPiece: 'queen', claimText: 'La tour se transforme en dame'
}, regMorphy); // Morphy 13. Rxd7 n'est pas une promotion
console.log('Test 6 (Promotion inventée sur Rxd7) :', t6.status, t6.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t6.status !== 'contradicted') throw new Error('Test 6 failed');

// Test 7 : Clouage non calculé / assertion sans preuve -> unverifiable
const t7 = evaluateSemanticClaimStrict({
  id: 't7', action: 'pins', claimText: 'Une pièce quelconque est clouée quelque part'
}, regMorphy);
console.log('Test 7 (Clouage sans cases spécifiées) :', t7.status, t7.status === 'unverifiable' ? 'PASS' : 'FAIL');
if (t7.status !== 'unverifiable') throw new Error('Test 7 failed');

// Test 8 : Attaque géométrique / contrôle de case (Fou b5 contrôle d7)
const t8 = evaluateSemanticClaimStrict({
  id: 't8', action: 'controls_square', subjectSquare: 'b5', subjectRole: 'bishop', targetSquare: 'd7', claimText: 'Le fou b5 contrôle la case d7'
}, regMorphy);
console.log('Test 8 (Contrôle de case d7 par fou b5) :', t8.status, t8.status === 'verified' ? 'PASS' : 'FAIL');
if (t8.status !== 'verified') throw new Error('Test 8 failed');

// Test 8b : Rayon bloqué (Fou b5 ne contrôle PAS e8 car la tour d7 bloque la diagonale)
const t8b = evaluateSemanticClaimStrict({
  id: 't8b', action: 'controls_square', subjectSquare: 'b5', subjectRole: 'bishop', targetSquare: 'e8', claimText: 'Le fou b5 contrôle la case e8 à travers la tour'
}, regMorphy);
console.log('Test 8b (Rayon bloqué par pièce intermédiaire -> contradicted) :', t8b.status, t8b.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t8b.status !== 'contradicted') throw new Error('Test 8b failed');

// Test 9a : Vraie défense (Le fou blanc b5 défend la tour blanche d7)
const t9a = evaluateSemanticClaimStrict({
  id: 't9a', action: 'defends', subjectSquare: 'b5', subjectRole: 'bishop', targetSquare: 'd7', targetPiece: 'rook', claimText: 'Le fou b5 défend la tour d7'
}, regMorphy);
console.log('Test 9a (Vraie défense de la tour d7 par le fou b5) :', t9a.status, t9a.status === 'verified' ? 'PASS' : 'FAIL');
if (t9a.status !== 'verified') throw new Error('Test 9a failed');

// Test 9b : Fausse défense par pièce adverse (La dame noire e7 défendrait la tour blanche d7) -> contradicted
const t9b = evaluateSemanticClaimStrict({
  id: 't9b', action: 'defends', subjectSquare: 'e7', subjectRole: 'queen', targetSquare: 'd7', targetPiece: 'rook', claimText: 'La dame noire e7 défend la tour blanche d7'
}, regMorphy);
console.log('Test 9b (Fausse défense par pièce ennemie -> contradicted) :', t9b.status, t9b.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t9b.status !== 'contradicted') throw new Error('Test 9b failed');

// Test 9c : Fausse défense géométrique (Le roi c1 défendrait la tour d7 hors de portée) -> contradicted
const t9c = evaluateSemanticClaimStrict({
  id: 't9c', action: 'defends', subjectSquare: 'c1', subjectRole: 'king', targetSquare: 'd7', targetPiece: 'rook', claimText: 'Le roi c1 défend la tour d7'
}, regMorphy);
console.log('Test 9c (Fausse défense géométrique hors de portée -> contradicted) :', t9c.status, t9c.status === 'contradicted' ? 'PASS' : 'FAIL');
if (t9c.status !== 'contradicted') throw new Error('Test 9c failed');

// Test 10 : Faux identifiant de preuve forgé par le modèle (P0.3)
const t10 = evaluateSemanticClaimStrict({
  id: 't10', action: 'moves_to', subjectRole: 'rook', subjectSquare: 'd1', targetSquare: 'd7', suppliedEvidenceId: 'ev_fake_hallucinated_proof_123', claimText: 'Coup avec preuve inventée'
}, regMorphy);
console.log('Test 10 (Preuve forgée rejetée) :', t10.status, t10.status === 'contradicted' ? 'PASS' : 'FAIL', `("${t10.rejectionReason}")`);
if (t10.status !== 'contradicted') throw new Error('Test 10 failed');

// Test 11 : SAN Ambigu (Rd1)
const posAmbiguous = Chess.fromSetup(parseFen('r3k2r/8/8/8/8/8/4PPPP/R3K2R w KQkq - 0 1').unwrap()).unwrap();
const t11 = parseBilingualSan(posAmbiguous, 'Rd1', 'auto');
console.log('Test 11 (Ambiguïté SAN Rd1) :', t11.status, t11.status === 'ambiguous' ? 'PASS' : 'FAIL');
if (t11.status !== 'ambiguous') throw new Error('Test 11 failed');

// Test 12 : Score Player POV normalisé (P1.1)
const scoreWhiteEval = getPlayerPovScore({ value: 150, unit: 'centipawns', pov: 'white' }, 'white');
const scoreBlackEval = getPlayerPovScore({ value: 150, unit: 'centipawns', pov: 'white' }, 'black');
const scoreMateWhite = getPlayerPovScore({ value: 2, unit: 'mate', pov: 'white' }, 'black'); // Blanc mate en 2, vu par les Noirs -> défaite imminente
console.log('Test 12 (Score Player POV) :',
  scoreWhiteEval.normalizedCp === 150 && scoreBlackEval.normalizedCp === -150 && scoreMateWhite.normalizedCp < -29000 ? 'PASS' : 'FAIL',
  `White POV: ${scoreWhiteEval.normalizedCp}, Black POV: ${scoreBlackEval.normalizedCp}, Black facing Mate: ${scoreMateWhite.normalizedCp}`);
if (scoreWhiteEval.normalizedCp !== 150 || scoreBlackEval.normalizedCp !== -150) throw new Error('Test 12 failed');

console.log('\n TOUS LES 12 TESTS ADVERSARIAUX P0 SONT PASSÉS AVEC SUCCÈS !');
