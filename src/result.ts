import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function jsonResult<T extends object>(data: T): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}
