/**
 * Progressive drawing: views show the first entries and add more as the end
 * scrolls into sight. Thousands of tiles at once would block the interface.
 */
export const STEP = 300;

export class Shown {
  limit = $state(STEP);

  /** Back to the first page (another folder, other filters). */
  reset() {
    this.limit = STEP;
  }

  /** Attach to an element after the last entry: reaching it shows the next page. */
  sentinel = (node: HTMLElement) => {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) this.limit += STEP;
      },
      { rootMargin: '600px' }
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  };
}
