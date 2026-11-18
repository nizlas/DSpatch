# Notes from the data imports

- 2023-11: customers were imported from the old customer register; ids were renumbered to the `C-` form.
- 2023-12: order ids from the web shop keep their `A-` numbers.
- 2024-04: orders rung up on the old till were imported with `"source": "till-v1"`. The old till recorded whole kronor, and the import kept its amounts as they were: a till-v1 amount is in kronor, not öre. They were not converted.
- 2024-05: the `placed` date is the day the order was placed, in the shop's time zone.
