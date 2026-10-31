import type { ModelChoice, ModelListing } from './bridge';

/**
 * What the dropdown shows, decided from the provider's own list (DSP-149).
 *
 * The provider's default row (`id: 'default'`, or marked `providerDefault`) is not a model
 * of its own: the model it resolves to is marked `· default`, and with no explicit choice
 * that model is what the control shows as chosen - by its name, never as "Provider's
 * default". A default that is routing says Auto, and which model served a reply is the
 * provider's to report afterwards. When the list does not say what the default is, the
 * control says the default is not identified rather than naming a model. Nothing here is
 * guessed or hard-coded.
 */
export function modelRows(
  listing: ModelListing,
  chosen: string,
): { readonly rows: readonly { value: string; label: string; title: string }[]; readonly value: string } {
  const alias = listing.models.find(isDefaultRow);
  const defaultTarget = alias?.resolvedId ?? null;
  const real = listing.models.filter((model) => !isDefaultRow(model));
  const defaultRow =
    defaultTarget === null
      ? undefined
      : (real.find((model) => model.id === defaultTarget) ?? real.find((model) => model.resolvedId === defaultTarget));
  const rows = real.map((model) => ({
    value: model.id,
    label: model.id === defaultRow?.id ? `${model.displayName} · default` : model.displayName,
    title: `${model.id}${model.resolvedId !== undefined && model.resolvedId !== model.id ? ` → ${model.resolvedId}` : ''}${model.description === undefined ? '' : ` · ${model.description}`}`,
  }));
  const explicit = chosen === 'default' || chosen === alias?.id ? '' : chosen;
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
  // The row keeps the provider's own value where it has one: choosing it asks for no model.
  const value = alias?.id ?? '';
  if (defaultTarget !== null) {
    const auto = defaultTarget.toLowerCase() === 'auto';
    return {
      rows: [
        {
          value,
          label: `${auto ? 'Auto' : defaultTarget} · default`,
          title: auto ? 'The provider chooses a model for each request.' : `The provider's default: ${defaultTarget}.`,
        },
        ...rows,
      ],
      value,
    };
  }
  return {
    rows: [{ value, label: 'Default model (not identified by the provider)', title: 'No model is named; the provider decides.' }, ...rows],
    value,
  };
}

/** Whether a listed row stands for the provider's default rather than for a model. */
export function isDefaultRow(model: ModelChoice): boolean {
  return model.id === 'default' || model.providerDefault === true;
}

/** The model a listing marks as the provider's default, or `''` when it names none. */
export function listedDefault(listing: ModelListing): string {
  return listing.error !== null || listing.models.length === 0 ? '' : modelRows(listing, '').value;
}
