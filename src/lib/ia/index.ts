import { adaptateurAnthropic } from './anthropic';
import { adaptateurGoogle } from './google';
import { adaptateurMock } from './mock';
import { adaptateurOpenAI } from './openai';
import type { AdaptateurLLM, FournisseurLLM } from './types';

/** Registre des adaptateurs. Point d'entrée unique : rien d'autre dans
 *  l'application n'importe un fournisseur nommément. */
const REGISTRE: Readonly<Record<FournisseurLLM, AdaptateurLLM>> = {
  anthropic: adaptateurAnthropic,
  openai: adaptateurOpenAI,
  google: adaptateurGoogle,
  mock: adaptateurMock,
};

export function adaptateur(code: FournisseurLLM): AdaptateurLLM {
  return REGISTRE[code];
}

export const FOURNISSEURS_LLM: readonly FournisseurLLM[] = ['mock', 'anthropic', 'openai', 'google'];

export function estFournisseurLLM(valeur: string): valeur is FournisseurLLM {
  return (FOURNISSEURS_LLM as readonly string[]).includes(valeur);
}

export const ADAPTATEURS: readonly AdaptateurLLM[] = FOURNISSEURS_LLM.map(adaptateur);
