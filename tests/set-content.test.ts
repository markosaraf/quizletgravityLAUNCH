import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCards} from '../src/lib/community/set-content.ts';
const cards=[{term:'été',definition:'summer'},{term:'chat',definition:'cat'}];
test('ordering, outer whitespace and Unicode encoding do not create an edited set',()=>{
 assert.equal(canonicalCards(cards),canonicalCards([{term:' chat ',definition:'cat '},{term:'e\u0301te\u0301',definition:'summer'}]));
});
test('changed answers, added cards and removed cards are genuine content edits',()=>{
 assert.notEqual(canonicalCards(cards),canonicalCards([{...cards[0],definition:'summertime'},cards[1]]));
 assert.notEqual(canonicalCards(cards),canonicalCards([...cards,cards[0]]));
 assert.notEqual(canonicalCards(cards),canonicalCards(cards.slice(1)));
});
