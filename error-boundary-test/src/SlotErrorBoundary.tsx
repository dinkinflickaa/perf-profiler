import React, { Component, ErrorInfo, ReactNode } from 'react';

/**
 * Simplified reproduction of the Teams SlotErrorBoundary pattern.
 *
 * The bug: render() calls this.reloadCallback() (a setState) when
 * state.correlationId !== props.correlationId.  If an Apollo-like async
 * data source keeps changing the correlationId on the parent, each cycle is:
 *
 *   [sync]  reloadCallback() clears error -> children render -> child throws -> catch -> set error
 *   [async] Apollo observable fires -> parent re-renders with new correlationId
 *   [sync]  render() sees mismatch -> reloadCallback() -> clears error -> children render -> throw ...
 *
 * Because the async gap (Apollo/microtask) resets React's nestedUpdateCount,
 * the "Maximum update depth exceeded" guard never fires.  The loop runs forever.
 */

interface Props {
  correlationId: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  correlationId: string | undefined;
}

let cycleCount = 0;

export class SlotErrorBoundary extends Component<Props, State> {
  state: State = { error: null, correlationId: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    cycleCount++;
    const corrId = this.props.correlationId;
    console.log(
      `[SlotErrorBoundary] componentDidCatch #${cycleCount} — ` +
      `saving correlationId="${corrId}", error="${error.message}"`
    );
    // Mirrors the real code: save the correlationId at time of catch
    this.setState({ error, correlationId: corrId });
  }

  render() {
    const { error, correlationId } = this.state;

    if (error) {
      // --- THIS IS THE BUG ---
      // If correlationId changed since we caught the error, reset the boundary.
      // reloadCallback() is a setState call *inside render()*, and the async
      // correlationId change means React's nested-update guard never triggers.
      if (correlationId && correlationId !== this.props.correlationId) {
        console.log(
          `[SlotErrorBoundary] render — correlationId mismatch ` +
          `(state="${correlationId}" vs prop="${this.props.correlationId}") ` +
          `-> reloadCallback()`
        );
        this.reloadCallback();
        return null;
      }

      // Default: re-throw to parent (like the real SlotErrorBoundary)
      console.log(`[SlotErrorBoundary] render — re-throwing error`);
      throw error;
    }

    return this.props.children;
  }

  private reloadCallback = (): void => {
    this.setState({ error: null, correlationId: undefined });
  };
}
