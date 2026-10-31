import type { ModelListing } from './bridge';

/**
 * What the dropdown shows, decided from the provider's own list (DSP-149).
 *
 * The provider's `default` alias is not a row of its own: the model it resolves to is
 * marked `· default`, and with no explicit choice that model is what the control shows
 * as chosen - by its name, never as "Provider's default". When the list does not say
 * what the default is, the control says the default is not identified rather than
 * naming a model. Nothing here is guessed or hard-coded.
 */
export function modelRows(
  listing: ModelListing,
  chosen: string,
): { readonly rows: readonly { value: string; label: string; title: string }[]; readonly value: string } {
  const alias = listing.models.find((model) => model.id === 'default');
  const defaultTarget = alias?.resolvedId ?? null;
  const real = listing.models.filter((model) => model.id !== 'default');
  const defaultRow =
    defaultTarget === null
      ? undefined
      : (real.find((model) => model.id === defaultTarget) ?? real.find((model) => model.resolvedId === defaultTarget));
  const rows = real.map((model) => ({
    value: model.id,
    label: model.id === defaultRow?.id ? `${model.displayName} · default` : model.displayName,
    title: `${model.id}${model.resolvedId !== undefined && model.resolvedId !== model.id ? ` → ${model.resolvedId}` : ''}${model.description === undefined ? '' : ` · ${model.description}`}`,
  }));
  const explicit = chosen === 'default' ? '' : chosen;
  if (explicit !== '') {
    return rows.some((row) => row.value === explicit)
      ? { rows, value: explicit }
      : {
          rows: [{ value: explicit, label: `${explicit} (not offered to this account)`, title: explicit }, ...rows],
          value: explicit,
        };
  }
  if (defaultRow !== undefined) {
    return { rows, value: defaultRow.id };
  }
  return {
    rows: [{ value: '', label: 'Default model (not identified by the provider)', title: 'No model is named; the provider decides.' }, ...rows],
    value: '',
  };
}

/** The model a listing marks as the provider's default, or `''` when it names none. */
export function listedDefault(listing: ModelListing): string {
  return listing.error !== null || listing.models.length === 0 ? '' : modelRows(listing, '').value;
}
