export class HistoryManager {
  private history: string[] = [];
  private currentIndex: number = -1;

  public addPosition(fen: string) {
    // If we're not at the end of the history and we make a move, 
    // we truncate the future history
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    this.history.push(fen);
    this.currentIndex++;
  }

  public undo(): string | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return null;
  }

  public redo(): string | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return null;
  }

  public getCurrentFen(): string | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this.history[this.currentIndex];
    }
    return null;
  }
}
