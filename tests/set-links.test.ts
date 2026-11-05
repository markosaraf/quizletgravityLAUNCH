import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedSetPath} from '../src/lib/community/set-links.ts';
test('imported shared links preserve Quizlet ID, locale and slug, dropping tracking',()=>{
 assert.equal(sharedSetPath({public_id:'1181229873',title:'Voci Mission 6',source_url:'https://quizlet.com/ch/1181229873/voci-mission-6-flash-cards/?i=share'}),'/ch/1181229873/voci-mission-6-flash-cards');
});
test('custom links have a stable numeric ID and safe title slug',()=>{
 assert.equal(sharedSetPath({public_id:'1000000000000000',title:'Français: été / déjà vu?'}),'/1000000000000000/francais-ete-deja-vu-flash-cards');
 assert.equal(sharedSetPath({public_id:'1000000000000001',title:'汉语'}),'/1000000000000001/汉语-flash-cards');
});
test('missing slugs and wrong source IDs fall back to the actual set title',()=>{
 assert.equal(sharedSetPath({public_id:'123',title:'My set',source_url:'https://quizlet.com/456/other-flash-cards/'}),'/123/my-set-flash-cards');
 assert.equal(sharedSetPath({public_id:'123',title:'My set',source_url:'https://quizlet.com/123/'}),'/123/my-set-flash-cards');
});
