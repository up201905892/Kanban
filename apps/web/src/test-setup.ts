import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import { FakeWebSocket } from './test-utils/websocket';

// No test touches the network: the board's live connection is a fake that tests can drive.
beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
