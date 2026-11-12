import { Chess } from 'chessops/chess';
import { parseSan, makeSan } from 'chessops/san';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSquare, makeSquare, squareFile, squareRank, type Role } from 'chessops/util';
import { bishopAttacks, rookAttacks, knightAttacks, kingAttacks, pawnAttacks, queenAttacks, between, ray } from 'chessops/attacks';

// ============================================================================
// 1. PARSEUR SAN BILINGUE SÉCURISÉ & DÉTECTEUR D'AMBIGUÏTÉ
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

  // Mode Auto : double tentative
  const moveEn = parseSan(pos, cleanSan);
  const moveFr = parseSan(pos, frToEnSan);

  if (moveFr && !moveEn) {
    const sanEn = makeSan(pos, moveFr);
    const sanFr = sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
    return { status: 'valid', move: moveFr, canonicalSanEn: sanEn, canonicalSanFr: sanFr, resolvedLang: 'fr' };
  }

  if (moveEn && !moveFr) {
    const sanEn = makeSan(pos, moveEn);
    const sanFr = sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
    return { status: 'valid', move: moveEn, canonicalSanEn: sanEn, canonicalSanFr: sanFr, resolvedLang: 'en' };
  }

  if (moveEn && moveFr) {
    // Les deux parsings réussissent. Désignent-ils le même coup ?
    if (moveEn.from === moveFr.from && moveEn.to === moveFr.to && moveEn.promotion === moveFr.promotion) {
      const sanEn = makeSan(pos, moveEn);
      const sanFr = sanEn.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
      return { status: 'valid', move: moveEn, canonicalSanEn: sanEn, canonicalSanFr: sanFr, resolvedLang: 'auto' };
    }

    // AMBIGUÏTÉ CRITIQUE DÉTECTÉE (ex: "Rd1" désignant Tour d1 en EN ou Roi d1 en FR)
    const pieceEn = pos.board.get(moveEn.from);
    const pieceFr = pos.board.get(moveFr.from);
    const sanEn1 = makeSan(pos, moveEn);
    const sanFr1 = sanEn1.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);
    const sanEn2 = makeSan(pos, moveFr);
    const sanFr2 = sanEn2.replace(/^[KQRBN]/, ch => enToFrMap[ch] || ch);

    return {
      status: 'ambiguous',
      ambiguityCandidates: [
        {
          lang: 'en',
          from: makeSquare(moveEn.from),
          to: makeSquare(moveEn.to),
          role: pieceEn!.role,
          sanEn: sanEn1,
          sanFr: sanFr1
        },
        {
          lang: 'fr',
          from: makeSquare(moveFr.from),
          to: makeSquare(moveFr.to),
          role: pieceFr!.role,
          sanEn: sanEn2,
          sanFr: sanFr2
        }
      ],
      error: `Ambiguïté de notation: "${rawSan}" désigne deux coups légaux distincts (ex: Tour en notation internationale vs Roi en français).`
    };
  }

  return { status: 'illegal', error: `Coup impossible à parser en français ou international: "${rawSan}"` };
}

// ============================================================================
// 2. REGISTRE DÉTERMINISTE DES PREUVES ÉCHIQUÉENNES (PositionEvidenceRegistry)
// ============================================================================

export interface MoveFact {
  fromSquare: string;
  toSquare: string;
  role: Role;
  color: 'white' | 'black';
  isCapture: boolean;
  capturedPiece?: Role;
  isCastling: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isPromotion: boolean;
  promotedRole?: Role;
}

export interface AttackEvidence {
  id: string;
  fromSquare: string;
  fromRole: Role;
  fromColor: 'white' | 'black';
  toSquare: string;
  targetRole: Role;
  targetColor: 'white' | 'black';
}

export interface DefenseEvidence {
  id: string;
  fromSquare: string;
  fromRole: Role;
  toSquare: string;
  targetRole: Role;
  color: 'white' | 'black';
}

export interface PinEvidence {
  id: string;
  attackerSquare: string;
  attackerRole: Role;
  pinnedSquare: string;
  pinnedRole: Role;
  pinnedColor: 'white' | 'black';
  kingSquare: string;
  isAbsolute: boolean;
}

export interface PositionEvidenceRegistry {
  moveFact?: MoveFact;
  attacks: AttackEvidence[];
  defenses: DefenseEvidence[];
  pins: PinEvidence[];
}

export function buildPositionEvidenceRegistry(pos: Chess, moveFact?: MoveFact): PositionEvidenceRegistry {
  const board = pos.board;
  const occupied = board.occupied;

  const attacks: AttackEvidence[] = [];
  const defenses: DefenseEvidence[] = [];
  const pins: PinEvidence[] = [];

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
      const targetPiece = board.get(targetSq);
      if (targetPiece) {
        if (targetPiece.color !== piece.color) {
          attacks.push({
            id: `atk_${makeSquare(sq)}_${makeSquare(targetSq)}`,
            fromSquare: makeSquare(sq),
            fromRole: piece.role,
            fromColor: piece.color,
            toSquare: makeSquare(targetSq),
            targetRole: targetPiece.role,
            targetColor: targetPiece.color
          });
        } else {
          defenses.push({
            id: `def_${makeSquare(sq)}_${makeSquare(targetSq)}`,
            fromSquare: makeSquare(sq),
            fromRole: piece.role,
            toSquare: makeSquare(targetSq),
            targetRole: targetPiece.role,
            color: piece.color
          });
        }
      }
    }
  }

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
          pins.push({
            id: `pin_${makeSquare(sq)}_${makeSquare(pinnedSq)}_${makeSquare(kingSq)}`,
            attackerSquare: makeSquare(sq),
            attackerRole: enemyPiece.role,
            pinnedSquare: makeSquare(pinnedSq),
            pinnedRole: pinnedPiece.role,
            pinnedColor: color,
            kingSquare: makeSquare(kingSq),
            isAbsolute: true
          });
        }
      }
    }
  }

  return { moveFact, attacks, defenses, pins };
}

// ============================================================================
// 3. VALIDATEUR SÉMANTIQUE À 3 ÉTATS (ChessClaim)
// ============================================================================

export interface ChessClaim {
  id: string;
  action: 'moves_to' | 'captures' | 'attacks' | 'defends' | 'pins' | 'checks' | 'castles' | 'promotes' | 'general_claim';
  subjectRole?: Role;
  subjectSquare?: string;
  targetPiece?: Role;
  targetSquare?: string;
  claimText: string;
  status?: 'verified' | 'contradicted' | 'unverifiable';
  evidenceIds?: string[];
  rejectionReason?: string;
}

export function evaluateSemanticClaim(claim: ChessClaim, registry: PositionEvidenceRegistry): ChessClaim {
  // 1. Actions du dernier coup
  if (['moves_to', 'captures', 'checks', 'castles', 'promotes'].includes(claim.action)) {
    const mf = registry.moveFact;
    if (!mf) {
      return { ...claim, status: 'unverifiable', rejectionReason: 'Aucun fait de coup disponible' };
    }

    if (claim.action === 'moves_to') {
      if (claim.subjectRole && claim.subjectRole !== mf.role) {
        return { ...claim, status: 'contradicted', rejectionReason: `Rôle erroné: affirmé ${claim.subjectRole}, réel ${mf.role}` };
      }
      if (claim.targetSquare && claim.targetSquare !== mf.toSquare) {
        return { ...claim, status: 'contradicted', rejectionReason: `Case erronée: affirmé ${claim.targetSquare}, réel ${mf.toSquare}` };
      }
      return { ...claim, status: 'verified', evidenceIds: [`fact_move_${mf.fromSquare}_${mf.toSquare}`] };
    }

    if (claim.action === 'captures') {
      if (!mf.isCapture) {
        return { ...claim, status: 'contradicted', rejectionReason: `Le coup n'est pas une capture` };
      }
      if (claim.targetPiece && mf.capturedPiece && claim.targetPiece !== mf.capturedPiece) {
        return { ...claim, status: 'contradicted', rejectionReason: `Cible capturée erronée: affirmé ${claim.targetPiece}, réel ${mf.capturedPiece}` };
      }
      return { ...claim, status: 'verified', evidenceIds: [`fact_capture_${mf.toSquare}`] };
    }

    if (claim.action === 'checks') {
      if (!mf.isCheck) {
        return { ...claim, status: 'contradicted', rejectionReason: `Le coup ne met pas le roi adverse en échec` };
      }
      return { ...claim, status: 'verified', evidenceIds: [`fact_check`] };
    }

    if (claim.action === 'castles') {
      if (!mf.isCastling) {
        return { ...claim, status: 'contradicted', rejectionReason: `Le coup n'est pas un roque` };
      }
      return { ...claim, status: 'verified', evidenceIds: [`fact_castling`] };
    }

    if (claim.action === 'promotes') {
      if (!mf.isPromotion) {
        return { ...claim, status: 'contradicted', rejectionReason: `Le coup n'est pas une promotion` };
      }
      if (claim.targetPiece && mf.promotedRole && claim.targetPiece !== mf.promotedRole) {
        return { ...claim, status: 'contradicted', rejectionReason: `Promotion erronée: affirmé ${claim.targetPiece}, réel ${mf.promotedRole}` };
      }
      return { ...claim, status: 'verified', evidenceIds: [`fact_promotion_${mf.toSquare}`] };
    }
  }

  // 2. Affirmations de Clouage
  if (claim.action === 'pins') {
    const pin = registry.pins.find(p =>
      (!claim.subjectSquare || p.attackerSquare === claim.subjectSquare) &&
      (!claim.subjectRole || p.attackerRole === claim.subjectRole) &&
      (!claim.targetSquare || p.pinnedSquare === claim.targetSquare) &&
      (!claim.targetPiece || p.pinnedRole === claim.targetPiece)
    );
    if (pin) {
      return { ...claim, status: 'verified', evidenceIds: [pin.id] };
    } else {
      return { ...claim, status: 'contradicted', rejectionReason: `Aucun clouage détecté correspondant aux paramètres spécifiés` };
    }
  }

  // 3. Affirmations de Défense
  if (claim.action === 'defends') {
    const defense = registry.defenses.find(d =>
      (!claim.subjectSquare || d.fromSquare === claim.subjectSquare) &&
      (!claim.subjectRole || d.fromRole === claim.subjectRole) &&
      (!claim.targetSquare || d.toSquare === claim.targetSquare) &&
      (!claim.targetPiece || d.targetRole === claim.targetPiece)
    );
    if (defense) {
      return { ...claim, status: 'verified', evidenceIds: [defense.id] };
    } else {
      return { ...claim, status: 'contradicted', rejectionReason: `La pièce spécifiée ne défend pas la cible indiquée` };
    }
  }

  // 4. Affirmations d'Attaque
  if (claim.action === 'attacks') {
    const atk = registry.attacks.find(a =>
      (!claim.subjectSquare || a.fromSquare === claim.subjectSquare) &&
      (!claim.subjectRole || a.fromRole === claim.subjectRole) &&
      (!claim.targetSquare || a.toSquare === claim.targetSquare) &&
      (!claim.targetPiece || a.targetRole === claim.targetPiece)
    );
    if (atk) {
      return { ...claim, status: 'verified', evidenceIds: [atk.id] };
    } else {
      return { ...claim, status: 'contradicted', rejectionReason: `La pièce spécifiée n'attaque pas la cible indiquée` };
    }
  }

  // 5. Toute autre affirmation non vérifiable géométriquement
  return {
    ...claim,
    status: 'unverifiable',
    rejectionReason: 'Affirmation non vérifiable par la géométrie déterministe'
  };
}

export function validateClaimsBatch(claims: ChessClaim[], registry: PositionEvidenceRegistry) {
  const evaluated = claims.map(c => evaluateSemanticClaim(c, registry));
  const contradicted = evaluated.filter(c => c.status === 'contradicted');
  const unverifiable = evaluated.filter(c => c.status === 'unverifiable');
  const verified = evaluated.filter(c => c.status === 'verified');

  // RÈGLE D'OR : Rejet si au moins 1 contradiction
  const isValid = contradicted.length === 0;

  return {
    isValid,
    verifiedClaims: verified,
    contradictedClaims: contradicted,
    unverifiableClaims: unverifiable,
    allClaims: evaluated
  };
}

// ============================================================================
// EXÉCUTION DU PROTOCOLE DE TEST
// ============================================================================

console.log('=== TEST 1 : AMBIGUÏTÉ SAN (Rd1 en EN vs FR) ===');
const posAmbiguous = Chess.fromSetup(parseFen('r3k2r/8/8/8/8/8/4PPPP/R3K2R w KQkq - 0 1').unwrap()).unwrap();
const resAmbiguous = parseBilingualSan(posAmbiguous, 'Rd1', 'auto');
console.log('Parse result for Rd1 in auto:', resAmbiguous.status, resAmbiguous.error);
if (resAmbiguous.status !== 'ambiguous') throw new Error('Échec test ambiguïté');

console.log('\n=== TEST 2 : MORPHY OPERA 1858 (Preuves Déterministes) ===');
const posOperaAfterDe6 = Chess.fromSetup(parseFen('4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R b k - 5 14').unwrap()).unwrap();
const regOpera = buildPositionEvidenceRegistry(posOperaAfterDe6);

// Vrai clouage: Fou b5 cloue Tour d7
const claimTruePin: ChessClaim = {
  id: 'c1',
  action: 'pins',
  subjectRole: 'bishop',
  subjectSquare: 'b5',
  targetPiece: 'rook',
  targetSquare: 'd7',
  claimText: 'Le fou b5 cloue la tour d7 sur le roi e8'
};
// Faux clouage: Cavalier f6 cloue Tour d7
const claimFalsePin: ChessClaim = {
  id: 'c2',
  action: 'pins',
  subjectRole: 'knight',
  subjectSquare: 'f6',
  targetPiece: 'rook',
  targetSquare: 'd7',
  claimText: 'Le cavalier f6 cloue la tour d7'
};
// Vraie défense: Dame e7 défend Tour d7
const claimTrueDef: ChessClaim = {
  id: 'c3',
  action: 'defends',
  subjectRole: 'queen',
  subjectSquare: 'e7',
  targetPiece: 'rook',
  targetSquare: 'd7',
  claimText: 'La dame défend la tour d7'
};
// Fausse défense: Fou b5 défend Tour d7
const claimFalseDef: ChessClaim = {
  id: 'c4',
  action: 'defends',
  subjectRole: 'bishop',
  subjectSquare: 'b5',
  targetPiece: 'rook',
  targetSquare: 'd7',
  claimText: 'Le fou b5 défend la tour d7'
};
// Affirmation non vérifiable
const claimUnverifiable: ChessClaim = {
  id: 'c5',
  action: 'general_claim',
  claimText: 'Les Noirs ressentent un grand inconfort psychologique'
};

const batch = validateClaimsBatch([claimTruePin, claimFalsePin, claimTrueDef, claimFalseDef, claimUnverifiable], regOpera);
console.log('Batch validation isValid:', batch.isValid);
console.log('Verified count:', batch.verifiedClaims.length, batch.verifiedClaims.map(c => c.id));
console.log('Contradicted count:', batch.contradictedClaims.length, batch.contradictedClaims.map(c => ({ id: c.id, reason: c.rejectionReason })));
console.log('Unverifiable count:', batch.unverifiableClaims.length, batch.unverifiableClaims.map(c => ({ id: c.id, reason: c.rejectionReason })));

if (batch.verifiedClaims.length !== 2 || batch.contradictedClaims.length !== 2 || batch.unverifiableClaims.length !== 1) {
  throw new Error('Échec des comptes de validation sémantique');
}
console.log('\n TOUS LES TESTS DE FONDATION SÉMANTIQUE ONT RÉUSSI AVEC SUCCÈS !');
