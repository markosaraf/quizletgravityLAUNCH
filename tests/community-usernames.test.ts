import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayPlayerName,normalizePlayerName,validPlayerName} from '../src/lib/community/usernames.ts';
test('player names support real names and existing handles',()=>{
 for(const name of ['Emilia Dürig','Marko Šarafijanović','Anne-Marie','O’Connor','player_23','user.name','李明华'])assert(validPlayerName(name),name);
 for(const name of ['name\nother','name\tother','<script>','user/name','hidden\u200bname'])assert(!validPlayerName(name),name);
});
test('canonical names preserve accents and unify case, spacing and composed spelling',()=>{
 assert.equal(normalizePlayerName(' Emilia  Du\u0308rig '),'emilia dürig');
 assert.equal(normalizePlayerName('EMILIA DÜRIG'),'emilia dürig');
 assert.equal(displayPlayerName(' Emilia  Du\u0308rig '),'Emilia Dürig');
});
