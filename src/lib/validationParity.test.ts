import { expect, it } from 'vitest';
import cases from '../../tests/fixtures/validation-parity.json';
import { sanitizeLedger } from './ledger';

it.each(cases)('$name (shared native/frontend fixture)', test => {
  let accepted = false;
  try { accepted = !!sanitizeLedger(test.data['portfolio-ledger-v1']); } catch { /* expected rejection */ }
  expect(accepted).toBe(test.frontendAccepted);
});
