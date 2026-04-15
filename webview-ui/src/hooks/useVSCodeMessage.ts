import { useState, useEffect } from 'react';
import { WebviewMessage, ExtensionMessage } from '../types/shared';

// Access VS Code API
const vscode = ('acquireVsCodeApi' in window) 
  ? (window as unknown as { acquireVsCodeApi: () => { postMessage: (msg: unknown) => void } }).acquireVsCodeApi() 
  : null;

export function useVSCodeMessage() {
  const [lastMessage, setLastMessage] = useState<WebviewMessage | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message: WebviewMessage = event.data;
      setLastMessage(message);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const postMessage = (message: ExtensionMessage) => {
    if (vscode) {
      vscode.postMessage(message);
    }
  };

  return { lastMessage, postMessage };
}
