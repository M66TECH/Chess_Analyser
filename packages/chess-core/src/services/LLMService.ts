import { MoveClassification } from '../pedagogy/types';
import { EngineEvaluation } from '../events/GameEventBus';

export interface LLMAnalyzeRequest {
  fen: string;
  move: string;
  san: string;
  classification: MoveClassification | string;
  evaluation?: EngineEvaluation;
  pv?: string[];
  languageLevel?: 'beginner' | 'intermediate' | 'advanced';
  theory?: import('../pedagogy/types').OpeningTheory;
  color?: 'white' | 'black';
  moveNumber?: number;
  bestMove?: string;
  expectedReply?: string;
}

export interface LLMAnalyzeResponse {
  explanation: string;
  themes: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'warning';
}

export class LLMService {
  private cache: Map<string, LLMAnalyzeResponse> = new Map();

  public async analyzeMove(request: LLMAnalyzeRequest): Promise<LLMAnalyzeResponse | null> {
    // Generate a unique cache key based on the position and move
    const cacheKey = `${request.fen}_${request.move}_${request.languageLevel || 'intermediate'}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // In a real browser environment, this fetches from the Next.js API
      // If we are testing in Node, this might fail unless mocked
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        console.error('[LLMService] API returned error:', response.statusText);
        return null;
      }

      const data = await response.json() as LLMAnalyzeResponse;
      
      this.cache.set(cacheKey, data);
      
      return data;
    } catch (error) {
      console.error('[LLMService] Network or parsing error:', error);
      return null;
    }
  }

  public clearCache() {
    this.cache.clear();
  }
}
