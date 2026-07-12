import { Connector } from './types';
import { TelegramConnector } from './telegramConnector';
import { InMemoryConnector } from './inMemoryConnector';

const connectors = new Map<string, Connector>();

export function registerConnector(connector: Connector) {
  connectors.set(connector.id, connector);
}

export function getConnector(id: string): Connector {
  const connector = connectors.get(id);
  if (!connector) {
    throw new Error(`Connector with id '${id}' not found`);
  }
  return connector;
}

// Register default connectors
registerConnector(new TelegramConnector());
registerConnector(new InMemoryConnector());
