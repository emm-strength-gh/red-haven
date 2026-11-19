import test from 'node:test';
import assert from 'node:assert/strict';
import { numberToWords, capitalize } from '../src/arrange-words.js';

test('spells small numbers and teens', () => {
  assert.equal(numberToWords(0), 'zero');
  assert.equal(numberToWords(1), 'one');
  assert.equal(numberToWords(13), 'thirteen');
  assert.equal(numberToWords(19), 'nineteen');
});

test('hyphenates compound tens', () => {
  assert.equal(numberToWords(20), 'twenty');
  assert.equal(numberToWords(42), 'forty-two');
  assert.equal(numberToWords(99), 'ninety-nine');
});

test('spells hundreds and thousands without "and"', () => {
  assert.equal(numberToWords(100), 'one hundred');
  assert.equal(numberToWords(105), 'one hundred five');
  assert.equal(numberToWords(717), 'seven hundred seventeen');
  assert.equal(numberToWords(1000), 'one thousand');
  assert.equal(numberToWords(2024), 'two thousand twenty-four');
  assert.equal(numberToWords(9999), 'nine thousand nine hundred ninety-nine');
});

test('rejects numbers outside the game range', () => {
  assert.throws(() => numberToWords(-1), RangeError);
  assert.throws(() => numberToWords(10000), RangeError);
  assert.throws(() => numberToWords(1.5), RangeError);
});

test('capitalizes card labels', () => {
  assert.equal(capitalize(numberToWords(7)), 'Seven');
});
