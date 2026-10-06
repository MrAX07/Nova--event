import type { Level } from '../shared/constants';

export interface Actor {
  id: string;
  level: Level;
  source: 'discord' | 'dashboard' | 'system';
}
