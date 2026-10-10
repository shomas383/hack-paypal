// Dev-only surfaces (/dev/states, the agent replay endpoint) exist only outside production. Production → 404, always.
export function devToolsEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production';
}
