import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY, cloneBoard, createPuzzle, isSolved, pour, pourAmount } from '../src/pour-logic.js';

test('only matching top colors or empty tubes can receive a pour', () => {
  const board = [[0, 1, 1], [1], [0], [], [2, 2, 2, 2]];
  assert.equal(pourAmount(board, 0, 1), 2);
  assert.equal(pourAmount(board, 0, 2), 0);
  assert.equal(pourAmount(board, 4, 3), 4);
  assert.equal(pour(board, 0, 1), 2);
  assert.deepEqual(board[0], [0]);
  assert.deepEqual(board[1], [1, 1, 1]);
});

test('every generated level has a legal route to completion', () => {
  for (let level = 1; level <= 80; level++) {
    const puzzle = createPuzzle(level);
    const board = cloneBoard(puzzle.board);
    assert.equal(isSolved(board), false, `level ${level} should begin mixed`);
    assert.equal(board.length, puzzle.colors + puzzle.empties);
    assert.equal(board.flat().length, puzzle.colors * CAPACITY);
    assert.ok(puzzle.par >= puzzle.solution.length, `level ${level} has an attainable three-star target`);
    for (const step of puzzle.solution) {
      assert.ok(pourAmount(board, step.from, step.to) > 0, `level ${level} has a legal solution move`);
      pour(board, step.from, step.to);
    }
    assert.ok(isSolved(board), `level ${level} can be solved`);
    assert.deepEqual(createPuzzle(level).board, puzzle.board, `level ${level} is reproducible`);
  }
});
