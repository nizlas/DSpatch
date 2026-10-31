import type { ModelChoice, ModelListing } from './bridge';

/**
 * What the dropdown shows, decided from the provider's own list (DSP-149).
 *
 * The provider's default row (`id: 'default'`, or marked `providerDefault`) means *follow the
 * provider's default*, and that is a choice of its own: it is the row's value, whatever the
 * row says the default is now, so a list that names another model later changes the words and
 * not the choice. Named by the provider it reads `Haiku 5.5 · default`, a default that is
 * routing reads Auto, and otherwise it says the default is not identified. The same model has
 * its own plain row, and that one is locked to the model. Which model served a reply is the
 * provider's to report afterwards. Nothing here is guessed or hard-coded.
 */
export function modelRows(
  listing: ModelListing,
  chosen: string,
): { readonly rows: readonly { value: string; label: string; title: string }[]; readonly value: string } {
  const alias = listing.models.find(isDefaultRow);
  const target = alias?.resolvedId ?? null;
  const real = listing.models.filter((model) => !isDefaultRow(model));
  const named = target === null ? undefined : (real.find((model) => model.id === target) ?? real.find((model) => model.resolvedId === target));
  const rows = real.map((model) => ({
    value: model.id,
    label: model.displayName,
    title: `${model.id}${model.resolvedId !== undefined && model.resolvedId !== model.id ? ` → ${model.resolvedId}` : ''}${model.description === undefined ? '' : ` · ${model.description}`}`,
  }));
  const explicit = isProviderDefaultId(chosen) ? '' : chosen;
  if (explicit !== '') {
    const follow = alias === undefined ? [] : [defaultRowOf(alias.id, target, named?.displayName)];
    return rows.some((row) => row.value === explicit)
      ? { rows: [...follow, ...rows], value: explicit }
      : {
          rows: [{ value: explicit, label: `${explicit} (not offered to this account)`, title: explicit }, ...follow, ...rows],
          value: explicit,
        };
  }
  const value = alias?.id ?? '';
  return { rows: [defaultRowOf(value, target, named?.displayName), ...rows], value };
}

/** The row that follows the provider's default; choosing it asks for no model. */
function defaultRowOf(value: string, target: string | null, name: string | undefined): { value: string; label: string; title: string } {
  if (target === null) {
    return { value, label: 'Default model (not identified by the provider)', title: 'No model is named; the provider decides.' };
  }
  const auto = target.toLowerCase() === 'auto';
  return {
    value,
    label: `${auto ? 'Auto' : (name ?? target)} · default`,
    title: auto ? "Follows the provider's default: it chooses a model for each request." : `Follows the provider's default, ${target} now.`,
  };
}

/** Whether a listed row stands for the provider's default rather than for a model. */
export function isDefaultRow(model: ModelChoice): boolean {
  return model.id === 'default' || model.providerDefault === true;
}

/** Whether a stored or chosen value means "follow the provider's default". */
export function isProviderDefaultId(id: string): boolean {
  return id === '' || id === 'default' || id === 'copilot-default';
}

/** The model a listing marks as the provider's default, or `''` when it names none. */
export function listedDefault(listing: ModelListing): string {
  return listing.error !== null || listing.models.length === 0 ? '' : modelRows(listing, '').value;
}
