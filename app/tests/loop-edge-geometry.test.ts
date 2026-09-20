import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  attachPoint,
  boxCentre,
  nodeBox,
} from '../src/shared/loop-edge-geometry';

describe('attachPoint', () => {
  it('meets a node stacked below on the top side, on the box, not in the air', () => {
    const box = nodeBox({ x: 100, y: 200 });
    const from = { x: 100 + NODE_WIDTH / 2, y: 40 };
    const hit = attachPoint(from, box);
    assert.equal(hit.side, 'top');
    assert.equal(hit.y, box.y);
    assert.ok(hit.x >= box.x && hit.x <= box.x + box.width);
  });

  it('meets a node to the right on the left side', () => {
    const box = nodeBox({ x: 300, y: 80 });
    const from = { x: 40, y: 80 + NODE_HEIGHT / 2 };
    const hit = attachPoint(from, box);
    assert.equal(hit.side, 'left');
    assert.equal(hit.x, box.x);
    assert.ok(hit.y >= box.y && hit.y <= box.y + box.height);
  });

  it('puts the centre of a box at half width and height', () => {
    const box = nodeBox({ x: 10, y: 20 });
    assert.deepEqual(boxCentre(box), { x: 10 + NODE_WIDTH / 2, y: 20 + NODE_HEIGHT / 2 });
  });
});
