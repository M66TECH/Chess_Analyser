export interface HoverShape {
  orig: string;
  dest?: string;
  brush: string;
}

type Listener = () => void;

let currentShapes: HoverShape[] | null = null;
const listeners = new Set<Listener>();

export const hoverStore = {
  getShapes(): HoverShape[] | null {
    return currentShapes;
  },

  setShapes(shapes: HoverShape[] | null): void {
    currentShapes = shapes;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('[hoverStore] listener error:', err);
      }
    });
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
