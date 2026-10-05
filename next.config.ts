import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 otherwise appends an "agent rules" block to CLAUDE.md on every `next dev`.
  agentRules: false,
};

export default nextConfig;
