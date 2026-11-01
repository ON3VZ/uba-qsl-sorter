import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadList, classify, sortCalls, extractCalls, parseCall, expandRange } from '../js/sorter.js';

const idx = loadList(readFileSync(new URL('../data/sorteerlijst.csv', import.meta.url), 'utf8'));
const pk = c => { const r = classify(idx, c); return r.status === 'ok' ? r.packet : r.status; };

test('ranges', () => {
  assert.deepEqual(expandRange('B0', 'B2'), ['B0', 'B1', 'B2']);
  assert.equal(expandRange('U', 'UQ').length, 10 + 17);
  assert.deepEqual(expandRange('KL7', 'KL8'), ['KL7', 'KL8']);
});

test('ordinary packets', () => {
  const cases = { DL1ABC: 'DL', DK0XX: 'DL', G4ABC: 'G', M0XYZ: 'G', '2E0ABC': 'G', ON4UB: 'ON', OT6A: 'ON',
    PA3ABC: 'PA', F5XYZ: 'F', I2ABC: 'I', IK2ABC: 'I', JA1ABC: 'JA', '7K1ABC': 'JA', VK2ABC: 'VK', ZL1ABC: 'ZL',
    UA3ABC: 'UA', R1ABC: 'UA', RA3A: 'UA', UR5ABC: 'UR', OH2ABC: 'OH', SP9ABC: 'SP', '3Z9A': 'SP', OK1ABC: 'OK' };
  for (const [c, p] of Object.entries(cases)) assert.equal(pk(c), p, c);
});

test('bijgevoegd bij ander pakje', () => {
  const cases = { '1A0KM': 'I', C31XX: 'EA', C4A: '5B', H2X: '5B', P33W: '5B', JW5E: 'LA', JX7DFA: 'LA',
    OX3XR: 'OZ', XP1A: 'OZ', '7R7A': '7X', UK8ABC: 'UK', AH6X: 'KH6', NH6Y: 'KH6', WH6Z: 'KH6', KH6ABC: 'KH6',
    CU3A: 'CT', TK5X: 'F', IS0ABC: 'I', T77C: 'T7', E21ABC: 'HS', '8O1A': 'A2', S41A: 'ZS', HB0X: 'HB0', HB9ABC: 'HB9',
    XX9ABC: 'XX9', XX1A: 'CT', VR2XAN: 'VR2', VS6A: 'VR2', '3D2AG': '3D', TS7N: '3V', AM8A: 'EA', AO9A: 'EA' };
  for (const [c, p] of Object.entries(cases)) assert.equal(pk(c), p, c);
});

test('USA per call area', () => {
  const cases = { W1AW: 'W1', K2ABC: 'W2', N0AX: 'W0', AA9A: 'W9', AI6V: 'W6', KC4AAA: 'W4', WA2XYZ: 'W2', KL7ABC: 'KL7', NL7X: 'KL7', KP4ABC: 'KP4' };
  for (const [c, p] of Object.entries(cases)) assert.equal(pk(c), p, c);
});

test('geen bureau / ongeldig / onbekend', () => {
  for (const c of ['4U1ITU', '4U1UN', '9V1ABC', 'A61A', 'KH2X'.replace('2', '0'), '3D2CR', 'KG4AB', 'VP2EA', 'ZK2A', '3B8CF', 'HZ1A', '7Z1A', 'KG6ABC'])
    assert.equal(pk(c), 'none', c);
  assert.equal(pk('C0ABC'), 'invalid');
  assert.equal(pk('QA1ABC'), 'invalid');
  for (const c of ['HF0POL', 'E6AA', 'C7A']) assert.equal(pk(c), 'unknown', c);
  for (const c of ['FT8', 'HELLO', '599', '']) assert.equal(classify(idx, c).status, 'badcall', c);
});

test('overlap U-UQ en twijfelgevallen', () => {
  assert.equal(pk('UN7ABC'), 'UN');
  assert.equal(pk('UM8ABC'), 'UK');
  assert.equal(pk('UI8A'), 'UA');
  assert.equal(pk('8Z4A'), 'HZ');
  assert.equal(pk('HE9ABC'), 'HB9');
  assert.equal(pk('HE0A'), 'HB0');
});

test('portabel: altijd onder de eigen call, met via', () => {
  assert.deepEqual([parseCall('F/ON4BB').home, parseCall('F/ON4BB').opPrefix], ['ON4BB', 'F']);
  assert.equal(pk('F/ON4BB'), 'ON');
  assert.equal(classify(idx, 'F/ON4BB').via, 'ON4BB');
  assert.equal(classify(idx, 'ON4BB').via, null);
  assert.equal(classify(idx, 'ON3VZ/P').via, null);
  assert.equal(pk('ON3VZ/P'), 'ON');
  assert.equal(pk('DL/ON3VZ/P'), 'ON');
  assert.equal(pk('W1AW/7'), 'W1');
  assert.equal(pk('KH6/W1AW'), 'W1');
  assert.equal(pk('VP2E/W1AW'), 'W1');
  assert.equal(pk('ON/DL1ABC'), 'DL');
  assert.equal(pk('on3vz'), 'ON');
  assert.equal(pk('ONØABC'), 'ON');
});

test('volgorde van de pakjes (optie A) en dubbels', () => {
  const r = sortCalls(idx, ['ZS6A', 'DL1A', 'G4A', 'M0B', '2E0C', 'W1AW', 'N0AX', 'K5ZZ', '3D2AG', '4X4A', 'DL1A', 'OX3A', '9V1A', 'HF1X']);
  assert.deepEqual(r.packets.map(p => p.code), ['3D', '4X', 'DL', 'G', 'OZ', 'W1', 'W5', 'W0', 'ZS']);
  assert.equal(r.packets.find(p => p.code === 'DL').cards, 2);
  assert.deepEqual(r.packets.find(p => p.code === 'G').items.map(i => i.call), ['2E0C', 'G4A', 'M0B']);
  assert.equal(r.none.length, 1);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.total, 14);
});

test('vrije tekst', () => {
  const t = 'TNX QSO 14.074 FT8 599\nON3VZ, dl1abc; F/ON4UB\tW1AW/7 2026-11-01 20M jw5e';
  assert.deepEqual(extractCalls(t), ['ON3VZ', 'DL1ABC', 'F/ON4UB', 'W1AW/7', 'JW5E']);
});

test('elke rij is bereikbaar en geen stille conflicten', () => {
  assert.equal(idx.conflicts.length, 0, JSON.stringify(idx.conflicts.map(c => c.prefix)));
});
