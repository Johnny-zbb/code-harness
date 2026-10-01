import type { HarnessEvent } from '../types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

/**
 * SSE connection to the local control-plane server.
 *
 * The server replays the whole run on every (re)connect, so the client simply
 * resets its state on open and re-folds the stream. Returns a cancel function.
 */
export function connectHarnessEvents(
  onReset: () => void,
  onEvent: (event: HarnessEvent) => void,
  onConnection?: (status: ConnectionStatus) => void,
): () => void {
  onConnection?.('connecting');
  const source = new EventSource('/api/events');
  source.onopen = () => {
    onReset();
    onConnection?.('connected');
  };
  source.onerror = () => onConnection?.('reconnecting');
  source.onmessage = (message: MessageEvent) => {
    try {
      onEvent(JSON.parse(message.data) as HarnessEvent);
    } catch {
      // Ignore malformed frames; the stream is append-only telemetry.
    }
  };
  return () => source.close();
}
