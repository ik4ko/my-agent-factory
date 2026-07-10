// node --test omnigent/wrapper/telegram-gate.test.mjs
// Checkpoint proof for the operator allowlist gate: allowed chat passes,
// everything else (wrong chat, missing chat, malformed, unset allowlist)
// silently fails closed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { passesOperatorGate, chatIdOf, operatorChatId, droppedUpdates } from './telegram-gate.mjs';

const OP = '5551234567';
const msg = (chatId) => ({ update_id: 1, message: { message_id: 9, chat: { id: chatId }, text: 'hi' } });

beforeEach(() => {
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OP;
});

test('operator chat passes', () => {
  assert.equal(passesOperatorGate(msg(5551234567)), true);
  assert.equal(passesOperatorGate(msg(OP)), true); // string id form too
});

test('any other chat is dropped', () => {
  const before = droppedUpdates();
  assert.equal(passesOperatorGate(msg(999)), false);
  assert.equal(passesOperatorGate(msg(-100123456)), false); // group chat
  assert.equal(droppedUpdates(), before + 2);
});

test('callback_query and edited_message shapes are gated too', () => {
  assert.equal(passesOperatorGate({ callback_query: { message: { chat: { id: Number(OP) } } } }), true);
  assert.equal(passesOperatorGate({ callback_query: { message: { chat: { id: 42 } } } }), false);
  assert.equal(passesOperatorGate({ edited_message: { chat: { id: Number(OP) } } }), true);
});

test('malformed updates fail closed, never throw', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { message: {} }, { message: { chat: {} } }]) {
    assert.equal(passesOperatorGate(bad), false);
  }
});

test('unset allowlist fails closed — nothing passes', () => {
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID;
  assert.equal(operatorChatId(), null);
  assert.equal(passesOperatorGate(msg(5551234567)), false);
});

test('whitespace-only allowlist fails closed', () => {
  process.env.TELEGRAM_OPERATOR_CHAT_ID = '   ';
  assert.equal(passesOperatorGate(msg(5551234567)), false);
});

test('chatIdOf extraction', () => {
  assert.equal(chatIdOf(msg(77)), '77');
  assert.equal(chatIdOf({}), null);
});
