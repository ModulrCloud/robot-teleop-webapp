import { randomUUID } from 'crypto';

const PROTOCOL_VERSION = '0.0';

/**
 * Builds an agent.ping message per Modulr Agent Interface Specification.
 * @see interface-spec/modulr-agent-interface-spec-main/schemas/agent/v0/ping.json
 */
export function buildAgentPingMessage(): { type: string; version: string; id: string; timestamp: string } {
  return {
    type: 'agent.ping',
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
