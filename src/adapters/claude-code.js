// Claude Code adapter — wraps the existing transcript-reader.

import { listTranscripts } from "../paths.js";
import { readTurns } from "../transcript-reader.js";

export const claudeCodeAdapter = {
  describe() {
    return {
      id: "claude-code",
      name: "Claude Code",
      version: "1",
      available: true,
    };
  },
  listTranscripts,
  readTurns,
};
