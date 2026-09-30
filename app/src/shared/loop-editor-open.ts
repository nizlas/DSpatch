/**
 * How the editor says what it has open.
 *
 * Three things can be on the canvas and they are three different claims. A loop
 * reached through its declaration has a **name** a person chose it by; a graph file
 * opened directly has only a path, and saying nothing about which it was would present
 * it as a loop whose name went missing. DSP-82 #3 and #6 are both about that
 * distinction being visible rather than inferable.
 *
 * Pure, and separate from the component, because "the window names the loop" is
 * otherwise only checkable by looking at a window.
 */

import type { OpenedLoopDefinition } from './bridge';

export interface OpenedGraphDescription {
  /** What follows the graph's own name in the header. */
  readonly title: string;
  /** How the status line introduces what was just opened, ending in a full stop. */
  readonly opened: string;
}

export function describeOpenedGraph(input: {
  readonly displayPath: string;
  /** `null` when a `.graph.json` was opened directly. */
  readonly definition: OpenedLoopDefinition | null;
}): OpenedGraphDescription {
  const definition = input.definition;
  if (definition === null) {
    return {
      title: `${input.displayPath} \u00b7 graph opened directly`,
      opened: `Opened ${input.displayPath} as a graph file, with no loop definition behind it.`,
    };
  }
  return {
    title: `${definition.name} \u00b7 ${input.displayPath}`,
    // The declaration's own path is in the sentence because a name is not a location,
    // and two folders may declare loops called the same thing.
    opened: `Opened the loop "${definition.name}", declared in ${definition.path}, and its graph ${input.displayPath}.`,
  };
}
