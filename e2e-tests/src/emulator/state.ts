// The emulator's memory: which scenario a ticket was minted under, and what has happened to an
// order since. All of it lives for one `playwright test` run and none of it is persisted.

import { randomUUID } from 'node:crypto';
import { DEFAULT_SCENARIO, type Scenario } from './scenarios.ts';

export interface Order {
  orderId: string;
  clientOrderId: string;
  scenario: Scenario;
  /** Where the Sale said to send the payer back after a 3DS challenge. */
  redirectUrl: string;
  amount: string;
  currency: string;
  cardholderName: string;
  /** Set once the payer has come back through the ACS page. */
  challengeDone: boolean;
}

/** The scenario the next page load will be pinned to. */
let pending: Scenario = DEFAULT_SCENARIO;

const ticketScenarios = new Map<string, Scenario>();
const tokenScenarios = new Map<string, Scenario>();
const orders = new Map<string, Order>();

export function setPendingScenario(scenario: Scenario): void {
  pending = scenario;
}

export function reset(): void {
  pending = DEFAULT_SCENARIO;
  ticketScenarios.clear();
  tokenScenarios.clear();
  orders.clear();
}

export function mintTicket(): string {
  // The scenario is readable in the ticket on purpose: when a test fails, the ticket is in the
  // page source and says which flow was supposed to be running.
  const ticket = `tkt_${pending}_${randomUUID()}`;
  ticketScenarios.set(ticket, pending);
  return ticket;
}

export function mintToken(ticket: string): string | null {
  const scenario = ticketScenarios.get(ticket);
  if (!scenario) {
    return null;
  }
  // One tokenization per ephemeral ticket, the same rule the real SDK enforces.
  ticketScenarios.delete(ticket);
  const token = `hf_tok_${scenario}_${randomUUID()}`;
  tokenScenarios.set(token, scenario);
  return token;
}

export function scenarioForToken(token: string): Scenario | null {
  return tokenScenarios.get(token) ?? null;
}

export function createOrder(order: Omit<Order, 'orderId' | 'challengeDone'>): Order {
  // A number in the sale reply and a string everywhere else: that asymmetry is real, it broke
  // the Go logger once (commit bbd6ef1), and reproducing it keeps the fix covered.
  const orderId = String(Math.floor(1_000_000 + Math.random() * 9_000_000));
  const record: Order = { ...order, orderId, challengeDone: false };
  orders.set(orderId, record);
  return record;
}

export function findOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}
