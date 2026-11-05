/**
 * Where on the map a place's focus must be to become active while panning: the map's
 * centre, except near either end, where it slides to that edge as the map reaches it.
 * With the centre alone the first and last places could never win: at the end of
 * travel two panes share the view, one either side of the centre, and the active one
 * kept its place (DSP-175). The slide spans half the view, or half of all the travel
 * the map has when that is less, so it is continuous and reaches each edge exactly.
 */
export function activationLine(x: number, maxX: number, viewLeft: number, viewWidth: number): number {
  const half = viewWidth / 2;
  const middle = viewLeft + half;
  const ramp = Math.min(half, maxX / 2);
  if (ramp <= 0) {
    return middle;
  }
  if (x < ramp) {
    return middle - half * (1 - Math.max(0, x) / ramp);
  }
  if (x > maxX - ramp) {
    return middle + half * (1 - Math.max(0, maxX - x) / ramp);
  }
  return middle;
}
