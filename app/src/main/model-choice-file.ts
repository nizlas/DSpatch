import fs from 'node:fs';
import path from 'node:path';

import type { StoredSessionProvider } from '../shared/bridge';
import { MODEL_CLASSES, parseModelClasses, type ModelClass, type ModelClassMap } from '../shared/loop-graph';

/**
 * DSP-149 and DSP-222: `dspatch-model-choice.json`, the model chosen in the chat for each agent
 * and, under `modelClasses`, the model each agent runs for a model class. One file, read whole
 * and written whole, so a write of one part keeps the other. No file, or an unreadable one,
 * reads as no choice at all.
 */
export interface ModelChoiceFile {
  readonly models: Partial<Record<StoredSessionProvider, string>>;
  readonly modelClasses: Partial<Record<StoredSessionProvider, ModelClassMap>>;
}

const PROVIDERS = ['cursor', 'claude', 'copilot'] as const;

export function readModelChoiceFile(file: string): ModelChoiceFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { models?: Record<string, unknown>; modelClasses?: unknown };
    const models: Partial<Record<StoredSessionProvider, string>> = {};
    for (const provider of PROVIDERS) {
      const value = parsed.models?.[provider];
      if (typeof value === 'string' && value !== '') {
        models[provider] = value;
      }
    }
    return { models, modelClasses: parseModelClasses(parsed.modelClasses) };
  } catch {
    return { models: {}, modelClasses: {} };
  }
}

export function writeModelChoiceFile(file: string, content: ModelChoiceFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const classes = Object.keys(content.modelClasses).length === 0 ? {} : { modelClasses: content.modelClasses };
  fs.writeFileSync(file, `${JSON.stringify({ formatVersion: 1, models: content.models, ...classes }, null, 2)}\n`, 'utf8');
}

/**
 * DSP-223: one class of one provider set to a model, or to `null` for "use the chat's model",
 * which removes the entry. The rest of the file is kept. Returns the mapping now in force.
 */
export function writeModelClass(
  file: string,
  provider: StoredSessionProvider,
  modelClass: ModelClass,
  model: string | null,
): Partial<Record<StoredSessionProvider, ModelClassMap>> {
  const current = readModelChoiceFile(file);
  const forProvider: Partial<Record<ModelClass, string>> = { ...(current.modelClasses[provider] ?? {}) };
  const trimmed = model?.trim() ?? '';
  if (trimmed === '') {
    delete forProvider[modelClass];
  } else {
    forProvider[modelClass] = trimmed;
  }
  const modelClasses: Partial<Record<StoredSessionProvider, ModelClassMap>> = { ...current.modelClasses };
  if (Object.keys(forProvider).length === 0) {
    delete modelClasses[provider];
  } else {
    // Written in class order, so the file reads small, medium, large.
    modelClasses[provider] = Object.fromEntries(MODEL_CLASSES.filter((name) => forProvider[name] !== undefined).map((name) => [name, forProvider[name]]));
  }
  writeModelChoiceFile(file, { models: current.models, modelClasses });
  return readModelChoiceFile(file).modelClasses;
}
