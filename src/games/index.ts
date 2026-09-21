import type { AnyGame } from './types';
import { g2048 } from './g2048';
import { snake } from './snake';
import { blocks } from './blocks';
import { hillclimb } from './hillclimb';
import { jevbros } from './jevbros';

export const GAMES: AnyGame[] = [g2048, snake, blocks, hillclimb, jevbros];
export const gameById = (id: string) => GAMES.find((g) => g.id === id);
