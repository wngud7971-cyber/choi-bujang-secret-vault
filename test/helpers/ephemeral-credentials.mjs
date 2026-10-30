import {randomBytes} from 'node:crypto';

// Isolated test inputs are generated in memory, never persisted credentials.
export const ephemeralTestValue = () => randomBytes(24).toString('base64url');
