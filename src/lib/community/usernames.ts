// Keep display spelling while using a consistent, case-insensitive login name.
export function displayPlayerName(value:string) {
 return value.normalize('NFC').replace(/^ +| +$/g,'').replace(/ +/g,' ');
}
export function normalizePlayerName(value:string) {
 return displayPlayerName(value).toLowerCase().normalize('NFC');
}
const allowedName = new RegExp("^[\\p{L}\\p{M}\\p{N} ._'’\\-]+$",'u');
export function validPlayerName(value:string) {
 return allowedName.test(value);
}
