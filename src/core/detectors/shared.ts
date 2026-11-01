import type { MutationInfo } from './types';

/** What a detector returns; position, source text and ignore state are filled by the analyzer. */
export type PartialMutation = Omit<MutationInfo, 'range' | 'sourceText' | 'ignored'>;
